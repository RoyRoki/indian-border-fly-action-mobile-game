// Match result submission with statistical anti-cheat
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const { matchId, score, kills, wavesCleared, survived, playTimeSec } = body;
  if (!matchId) return Response.json({ error: 'missing matchId' }, { status: 400 });

  // Verify match exists and this player is in the room
  const { data: match } = await supabase
    .from('matches').select('id, room_id, started_at').eq('id', matchId).maybeSingle();
  if (!match) return Response.json({ error: 'match not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('room_players').select('id').eq('room_id', match.room_id).eq('player_id', user.id).maybeSingle();
  if (!membership) return Response.json({ error: 'not in match' }, { status: 403 });

  // Statistical anti-cheat: rate-limit score per elapsed second
  const elapsed = Math.max(1, (Date.now() - new Date(match.started_at).getTime()) / 1000);
  const s = Math.min(Math.max(Number(score) | 0, 0), 2_000_000);
  const k = Math.min(Math.max(Number(kills) | 0, 0), 500);
  const w = Math.min(Math.max(Number(wavesCleared) | 0, 0), 5);
  const t = Math.min(Math.max(Number(playTimeSec) | 0, 0), 1800);

  if (s / elapsed > 1200) {
    console.warn('mp anti-cheat: score/sec', s, elapsed, user.id);
    return Response.json({ error: 'score rejected' }, { status: 400 });
  }
  // Must survive at least 12s per wave claimed
  if (survived && elapsed < w * 12) {
    console.warn('mp anti-cheat: time too short', elapsed, w, user.id);
    return Response.json({ error: 'play time too short' }, { status: 400 });
  }

  // Idempotency guard
  const { data: already } = await supabase
    .from('match_results').select('id').eq('match_id', matchId).eq('player_id', user.id).maybeSingle();
  if (already) return Response.json({ error: 'already submitted' }, { status: 409 });

  // Insert this player's result
  await supabase.from('match_results').insert({
    match_id: matchId,
    player_id: user.id,
    score: s, kills: k, waves_cleared: w, survived: !!survived, play_time_s: t,
  });

  // Rank all submitted results so far, highest score first
  const { data: allRows } = await supabase
    .from('match_results')
    .select('id, player_id, score')
    .eq('match_id', matchId)
    .order('score', { ascending: false });

  if (allRows?.length) {
    await Promise.all(allRows.map((r, i) =>
      supabase.from('match_results').update({ rank: i + 1 }).eq('id', r.id)
    ));
  }

  // Close match if every room participant has submitted
  const { count: roomSize } = await supabase
    .from('room_players').select('id', { count: 'exact', head: true }).eq('room_id', match.room_id);
  if (allRows?.length >= roomSize) {
    await supabase.from('matches').update({ ended_at: new Date().toISOString() }).eq('id', matchId);
    await supabase.from('rooms').update({ status: 'done' }).eq('id', match.room_id);
  }

  // Return full ranked results with player names for the results screen
  const { data: results } = await supabase
    .from('match_results')
    .select('player_id, score, kills, waves_cleared, survived, play_time_s, rank, players(name, city)')
    .eq('match_id', matchId)
    .order('score', { ascending: false });

  const myRank = allRows?.findIndex(r => r.player_id === user.id) + 1 || null;
  return Response.json({ ok: true, myRank, results: results || [] });
}
