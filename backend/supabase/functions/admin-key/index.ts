import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isProvider } from '../_shared/providers.ts'
import { encryptKey } from '../_shared/crypto.ts'

/**
 * Key management for admins.
 *
 * Keys go in and never come out. The console can list which providers are configured and see
 * the last four characters, which is enough to answer "is the right key installed?" — the only
 * question an admin actually needs the key itself to answer.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' }
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) return json(401, { error: 'Not signed in.' })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  const { data: userData } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (!user) return json(401, { error: 'Session expired.' })

  const { data: member } = await admin
    .from('org_members')
    .select('org_id, role, disabled')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!member || member.disabled || member.role !== 'admin') {
    return json(403, { error: 'Admins only.' })
  }
  const orgId = member.org_id as string

  if (req.method === 'GET') {
    const { data } = await admin
      .from('provider_keys')
      .select('provider, hint, updated_at')
      .eq('org_id', orgId)
    return json(200, { keys: data ?? [] })
  }

  let body: { provider?: unknown; apiKey?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Malformed request.' })
  }
  if (!isProvider(body.provider)) return json(400, { error: 'Unknown provider.' })

  if (req.method === 'DELETE') {
    await admin.from('provider_keys').delete().eq('org_id', orgId).eq('provider', body.provider)
    return json(200, { ok: true })
  }

  if (req.method !== 'POST') return json(405, { error: 'Unsupported method.' })

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (apiKey.length < 16) return json(400, { error: "That doesn't look like an API key." })

  const { ciphertext, iv } = await encryptKey(apiKey)

  const { error } = await admin.from('provider_keys').upsert({
    org_id: orgId,
    provider: body.provider,
    ciphertext,
    iv,
    hint: apiKey.slice(-4),
    updated_by: user.id,
    updated_at: new Date().toISOString()
  })

  if (error) return json(500, { error: 'Could not save the key.' })
  return json(200, { ok: true, provider: body.provider, hint: apiKey.slice(-4) })
})
