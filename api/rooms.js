// Room management: create, join, ready-toggle, start-match
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function auth(request) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user || null;
}

export async function POST(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  const user = await auth(request);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  // ---- CREATE ----
  if (action === 'create') {
    const maxPlayers = Math.min(4, Math.max(2, Number(body.maxPlayers) || 4));

    // Attempt a unique code up to 10 times
    let code;
    for (let i = 0; i < 10; i++) {
      const candidate = genCode();
      const { data: clash } = await supabase
        .from('rooms').select('id').eq('code', candidate).eq('status', 'waiting').maybeSingle();
      if (!clash) { code = candidate; break; }
    }
    if (!code) return Response.json({ error: 'could not generate code' }, { status: 500 });

    const { data: room, error } = await supabase
      .from('rooms')
      .insert({ code, host_id: user.id, campaign: 0, sector: 0, seed: 0, status: 'waiting', max_players: maxPlayers })
      .select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    await supabase.from('room_players').insert({ room_id: room.id, player_id: user.id, ready: false });
    return Response.json({ ok: true, code: room.code, roomId: room.id, maxPlayers });
  }

  // ---- JOIN ----
  if (action === 'join') {
    const code = (body.code || '').toUpperCase().trim();
    if (code.length !== 4) return Response.json({ error: 'invalid code' }, { status: 400 });

    const { data: room } = await supabase
      .from('rooms').select('id, status, max_players').eq('code', code).eq('status', 'waiting').maybeSingle();
    if (!room) return Response.json({ error: 'room not found' }, { status: 404 });

    const { count } = await supabase
      .from('room_players').select('id', { count: 'exact', head: true }).eq('room_id', room.id);
    if (count >= (room.max_players || 4)) return Response.json({ error: 'room full' }, { status: 409 });

    // Idempotent — re-joining is fine
    const { data: existing } = await supabase
      .from('room_players').select('id').eq('room_id', room.id).eq('player_id', user.id).maybeSingle();
    if (!existing) {
      await supabase.from('room_players').insert({ room_id: room.id, player_id: user.id, ready: false });
    }
    return Response.json({ ok: true, roomId: room.id, code, maxPlayers: room.max_players || 4 });
  }

  // ---- READY ----
  if (action === 'ready') {
    const { roomId, ready } = body;
    if (!roomId) return Response.json({ error: 'missing roomId' }, { status: 400 });
    await supabase.from('room_players')
      .update({ ready: !!ready }).eq('room_id', roomId).eq('player_id', user.id);
    return Response.json({ ok: true });
  }

  // ---- START ----
  if (action === 'start') {
    const { roomId } = body;
    if (!roomId) return Response.json({ error: 'missing roomId' }, { status: 400 });

    const { data: room } = await supabase
      .from('rooms').select('id, host_id, status, max_players').eq('id', roomId).maybeSingle();
    if (!room)               return Response.json({ error: 'room not found' }, { status: 404 });
    if (room.host_id !== user.id) return Response.json({ error: 'not host' }, { status: 403 });
    if (room.status !== 'waiting') return Response.json({ error: 'already started' }, { status: 409 });

    const { data: players } = await supabase
      .from('room_players').select('ready').eq('room_id', roomId);
    if (!players || players.length < 2) return Response.json({ error: 'need at least 2 players' }, { status: 400 });
    if (players.some(p => !p.ready))    return Response.json({ error: 'not all ready' }, { status: 400 });

    // Pick a random level (1-20); night op only if all players could plausibly have it
    const levelId = Math.floor(Math.random() * 20) + 1;
    const campaign = levelId > 10 ? 1 : 0;
    const sector   = (levelId - 1) % 10;
    const seed     = Math.floor(Math.random() * 0xFFFFFFFF);

    // Create match record first so we have matchId before updating room
    const { data: match } = await supabase
      .from('matches').insert({ room_id: roomId }).select().single();

    await supabase.from('rooms')
      .update({ status: 'playing', campaign, sector, seed }).eq('id', roomId);

    return Response.json({ ok: true, levelId, campaign, sector, seed, matchId: match.id });
  }

  return Response.json({ error: 'unknown action' }, { status: 400 });
}
