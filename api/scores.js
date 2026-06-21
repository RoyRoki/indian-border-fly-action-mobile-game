import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const score = Math.floor(Number(body?.score))
  if (!Number.isFinite(score) || score <= 0 || score > 2_000_000) {
    return Response.json({ error: 'invalid score' }, { status: 400 })
  }
  const sector = Math.min(20, Math.max(0, Number(body?.sector) | 0))

  // Ensure player row exists (handles first submission before profile is saved)
  await supabase.from('players').upsert({ id: user.id }, { onConflict: 'id', ignoreDuplicates: true })

  const { error } = await supabase.from('scores').insert({ player_id: user.id, score, sector })
  if (error) return Response.json({ error: 'db error' }, { status: 500 })
  return Response.json({ ok: true })
}
