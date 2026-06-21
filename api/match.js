// Match result submission with statistical anti-cheat
// GET  /api/match?matchId=xxx  — poll current results while waiting for others
// POST /api/match              — submit own result and get ranked standings
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getUser(request) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user || null;
}

// Attach W/L record to each result row (extra select by player_id IN [...])
async function attachWL(results) {
  if (!results?.length) return results;
  const ids = results.map(r => r.player_id);
  const { data: rows } = await supabase
    .from('match_results')
    .select('player_id, rank')
    .in('player_id', ids);
  const wl = {};
  for (const r of rows || []) {
    if (!wl[r.player_id]) wl[r.player_id] = { w: 0, l: 0 };
    if (r.rank === 1) wl[r.player_id].w++;
    else              wl[r.player_id].l++;
  }
  return results.map(r => ({ ...r, mpWins: wl[r.player_id]?.w || 0, mpLosses: wl[r.player_id]?.l || 0 }));
}

// GET — used by clients waiting for other players to finish
export async function GET(request) {
  const user = await getUser(request);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const matchId = url.searchParams.get('matchId');
  if (!matchId) return Response.json({ error: 'missing matchId' }, { status: 400 });

  const { data: match } = await supabase
    .from('matches').select('id, room_id').eq('id', matchId).maybeSingle();
  if (!match) return Response.json({ error: 'match not found' }, { status: 404 });

  const [{ data: rawResults }, { count: roomSize }] = await Promise.all([
    supabase.from('match_results')
      .select('player_id, score, kills, waves_cleared, survived, play_time_s, rank, players(name, city)')
      .eq('match_id', matchId)
      .order('score', { ascending: false }),
    supabase.from('room_players').select('id', { count: 'exact', head: true }).eq('room_id', match.room_id),
  ]);

  const results = await attachWL(rawResults || []);
  const allSubmitted = results.length >= (roomSize || 0);
  return Response.json({ results, allSubmitted, totalPlayers: roomSize || 0 });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const { matchId, score, kills, wavesCleared, survived, playTimeSec } = body;
  if (!matchId) return Response.json({ error: 'missing matchId' }, { status: 400 });

  const { data: match } = await supabase
    .from('matches').select('id, room_id, started_at').eq('id', matchId).maybeSingle();
  if (!match) return Response.json({ error: 'match not found' }, { status: 404 });

  // Membership + idempotency in parallel
  const [{ data: membership }, { data: already }] = await Promise.all([
    supabase.from('room_players').select('id').eq('room_id', match.room_id).eq('player_id', user.id).maybeSingle(),
    supabase.from('match_results').select('id').eq('match_id', matchId).eq('player_id', user.id).maybeSingle(),
  ]);
  if (!membership) return Response.json({ error: 'not in match' }, { status: 403 });
  if (already)     return Response.json({ error: 'already submitted' }, { status: 409 });

  // Statistical anti-cheat
  const elapsed = Math.max(1, (Date.now() - new Date(match.started_at).getTime()) / 1000);
  const s = Math.min(Math.max(Number(score)       | 0, 0), 2_000_000);
  const k = Math.min(Math.max(Number(kills)       | 0, 0), 500);
  const w = Math.min(Math.max(Number(wavesCleared)| 0, 0), 5);
  const t = Math.min(Math.max(Number(playTimeSec) | 0, 0), 1800);

  if (s / elapsed > 1200)          return Response.json({ error: 'score rejected'      }, { status: 400 });
  if (survived && elapsed < w * 12) return Response.json({ error: 'play time too short' }, { status: 400 });

  // Insert this player's result
  await supabase.from('match_results').insert({
    match_id: matchId, player_id: user.id,
    score: s, kills: k, waves_cleared: w, survived: !!survived, play_time_s: t,
  });

  // Fetch all results + room size in parallel; rank by score order (no serial row-by-row updates)
  const [{ data: rawRows }, { count: roomSize }] = await Promise.all([
    supabase.from('match_results')
      .select('player_id, score, kills, waves_cleared, survived, play_time_s, players(name, city)')
      .eq('match_id', matchId)
      .order('score', { ascending: false }),
    supabase.from('room_players').select('id', { count: 'exact', head: true }).eq('room_id', match.room_id),
  ]);

  const allSubmitted = (rawRows?.length || 0) >= (roomSize || 0);

  // Close match when everyone has submitted — fire-and-forget so it doesn't delay response
  if (allSubmitted) {
    Promise.all([
      supabase.from('matches').update({ ended_at: new Date().toISOString() }).eq('id', matchId),
      supabase.from('rooms').update({ status: 'done' }).eq('id', match.room_id),
    ]).catch(() => {});
  }

  // Rank is position in score-ordered array
  const rankedRows = (rawRows || []).map((r, i) => ({ ...r, rank: i + 1 }));
  const results = await attachWL(rankedRows);
  const myRank = results.findIndex(r => r.player_id === user.id) + 1 || null;

  return Response.json({ ok: true, myRank, results, allSubmitted, totalPlayers: roomSize || 0 });
}
