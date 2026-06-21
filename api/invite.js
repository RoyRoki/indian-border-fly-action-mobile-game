// Server-side room invite: broadcasts ROOM_INVITE to a specific user's notification channel
// via Supabase Realtime HTTP broadcast API (no WebSocket needed, works across clients).
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
  try { body = await request.json(); } catch {}

  const toPlayerId = String(body.toPlayerId || '').trim();
  const fromName   = String(body.fromName   || 'PILOT').slice(0, 20);
  const code       = String(body.code       || '').slice(0, 4).toUpperCase();
  if (!toPlayerId || !code) return Response.json({ error: 'missing params' }, { status: 400 });

  // Verify target player exists (basic sanity check)
  const { data: targetPlayer } = await supabase
    .from('players').select('id').eq('id', toPlayerId).maybeSingle();
  if (!targetPlayer) return Response.json({ error: 'player not found' }, { status: 404 });

  // Supabase Realtime HTTP broadcast — no WebSocket required
  // Channel topic is the bare channel name (no "realtime:" prefix in the REST payload)
  const res = await fetch(`${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      messages: [{
        topic:   `user:${toPlayerId}`,
        event:   'broadcast',
        payload: {
          type:    'broadcast',
          event:   'ROOM_INVITE',
          payload: { fromName, code },
        },
      }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('Realtime broadcast error:', res.status, txt);
    return Response.json({ error: 'broadcast failed', detail: txt }, { status: 502 });
  }

  return Response.json({ ok: true });
}
