// Friend system: list friends, send/accept/decline requests, search players by name
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function authUser(request) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user || null;
}

// GET /api/friends — list accepted friends + pending requests
export async function GET(request) {
  const user = await authUser(request);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: rows } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at, requester:requester_id(name, city), addressee:addressee_id(name, city)')
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .order('created_at', { ascending: false });

  const friends = [], incoming = [], outgoing = [];
  for (const r of rows || []) {
    const me = r.requester_id === user.id;
    const other = me ? r.addressee : r.requester;
    const otherId = me ? r.addressee_id : r.requester_id;
    const entry = { id: r.id, playerId: otherId, name: other?.name, city: other?.city, status: r.status };
    if (r.status === 'accepted')          friends.push(entry);
    else if (!me && r.status === 'pending') incoming.push(entry);
    else if (me  && r.status === 'pending') outgoing.push(entry);
  }
  return Response.json({ friends, incoming, outgoing });
}

export async function POST(request) {
  const user = await authUser(request);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  let body = {};
  try { body = await request.json(); } catch {}

  // ---- SEARCH player by call sign (case-insensitive prefix) ----
  if (action === 'search') {
    const q = (body.q || '').trim().slice(0, 14);
    if (!q) return Response.json({ results: [] });
    const { data } = await supabase
      .from('players')
      .select('id, name, city')
      .ilike('name', `${q}%`)
      .neq('id', user.id)
      .limit(10);
    return Response.json({ results: data || [] });
  }

  // ---- SEND friend request ----
  if (action === 'request') {
    const { toPlayerId } = body;
    if (!toPlayerId) return Response.json({ error: 'missing toPlayerId' }, { status: 400 });
    if (toPlayerId === user.id) return Response.json({ error: 'cannot friend yourself' }, { status: 400 });

    // Check reverse: maybe the other person already sent us one
    const { data: reverse } = await supabase
      .from('friendships')
      .select('id, status')
      .eq('requester_id', toPlayerId)
      .eq('addressee_id', user.id)
      .maybeSingle();
    if (reverse?.status === 'pending') {
      // Auto-accept the reverse request
      await supabase.from('friendships').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', reverse.id);
      return Response.json({ ok: true, autoAccepted: true });
    }

    const { error } = await supabase.from('friendships').insert({
      requester_id: user.id, addressee_id: toPlayerId, status: 'pending',
    });
    if (error?.code === '23505') return Response.json({ error: 'already sent' }, { status: 409 });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // ---- ACCEPT / DECLINE ----
  if (action === 'respond') {
    const { friendshipId, accept } = body;
    if (!friendshipId) return Response.json({ error: 'missing friendshipId' }, { status: 400 });
    const newStatus = accept ? 'accepted' : 'declined';
    await supabase.from('friendships')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', friendshipId)
      .eq('addressee_id', user.id); // only addressee can respond
    return Response.json({ ok: true });
  }

  // ---- REMOVE ----
  if (action === 'remove') {
    const { friendshipId } = body;
    if (!friendshipId) return Response.json({ error: 'missing friendshipId' }, { status: 400 });
    await supabase.from('friendships').delete().eq('id', friendshipId)
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'unknown action' }, { status: 400 });
}
