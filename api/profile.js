import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const clean = (s, fallback) =>
  String(s ?? '').replace(/[<>]/g, '').trim().slice(0, 14) || fallback

async function getUser(request) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return null
  const { data: { user } } = await supabase.auth.getUser(token)
  return user || null
}

export async function GET(request) {
  const user = await getUser(request)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('players')
    .select('name, city, wins, dia, checkpoint_day, checkpoint_night')
    .eq('id', user.id)
    .maybeSingle()

  return Response.json(data)
}

export async function POST(request) {
  const user = await getUser(request)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const { error } = await supabase.from('players').upsert({
    id:   user.id,
    name: clean(body?.name, 'PILOT'),
    city: clean(body?.city, '—'),
    wins: Math.min(5, Math.max(0, Number(body?.wins) | 0)),
    dia:  Math.min(5, Math.max(0, Number(body?.dia)  | 0)),
    checkpoint_day:   Math.min(10, Math.max(0, Number(body?.checkpoint_day)   | 0)),
    checkpoint_night: Math.min(10, Math.max(0, Number(body?.checkpoint_night) | 0)),
  })

  if (error) return Response.json({ error: 'db error' }, { status: 500 })
  return Response.json({ ok: true })
}
