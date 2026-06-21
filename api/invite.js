// Server-side room invite: subscribes to the friend's notification channel using
// the admin JS client then sends a typed broadcast — more reliable than the REST
// broadcast API whose payload envelope differs from what the JS SDK client expects.
import { createClient } from '@supabase/supabase-js';

const authSb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user } } = await authSb.auth.getUser(token);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  const toPlayerId = String(body.toPlayerId || '').trim();
  const fromName   = String(body.fromName   || 'PILOT').slice(0, 20);
  const code       = String(body.code       || '').slice(0, 4).toUpperCase();
  if (!toPlayerId || !code) return Response.json({ error: 'missing params' }, { status: 400 });

  // Each function invocation needs its own Supabase client + channel so
  // the WebSocket is isolated and can be cleanly closed after the send.
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    realtime: { params: { eventsPerSecond: 10 } },
  });

  await new Promise((resolve, reject) => {
    const ch = sb.channel(`user:${toPlayerId}`);
    const guard = setTimeout(() => { sb.removeChannel(ch); reject(new Error('subscribe timeout')); }, 6000);

    ch.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      clearTimeout(guard);
      try {
        await ch.send({
          type:    'broadcast',
          event:   'ROOM_INVITE',
          payload: { fromName, code },
        });
        // Brief pause so Phoenix can dispatch the message before the socket closes
        await new Promise(r => setTimeout(r, 400));
      } finally {
        sb.removeChannel(ch);
        resolve();
      }
    });
  });

  return Response.json({ ok: true });
}
