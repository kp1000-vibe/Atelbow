import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Adding someone to the org.
 *
 * Admins think in email addresses; the schema thinks in user ids. This bridges the two — and
 * handles the common case where the person has no account yet, by inviting them and creating
 * the membership in one step, so an admin never has to chase someone to sign up first.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' }
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) return json(401, { error: 'Not signed in.' })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  const { data: userData } = await admin.auth.getUser(jwt)
  const caller = userData?.user
  if (!caller) return json(401, { error: 'Session expired.' })

  const { data: member } = await admin
    .from('org_members')
    .select('org_id, role, disabled')
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!member || member.disabled || member.role !== 'admin') {
    return json(403, { error: 'Admins only.' })
  }

  let body: { email?: unknown; dailyLimitUsd?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Malformed request.' })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: "That doesn't look like an email address." })
  }

  const dailyLimit =
    body.dailyLimitUsd === null || body.dailyLimitUsd === undefined
      ? null
      : Number(body.dailyLimitUsd)
  if (dailyLimit !== null && (!Number.isFinite(dailyLimit) || dailyLimit < 0)) {
    return json(400, { error: 'The daily limit must be a positive number.' })
  }

  // auth.users isn't exposed through PostgREST, so the lookup goes through a security-definer
  // function rather than a table read.
  const { data: existingId } = await admin.rpc('user_id_by_email', { target_email: email })

  let targetId: string
  if (existingId) {
    targetId = existingId as string
  } else {
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email)
    if (inviteErr || !invited?.user) {
      return json(500, { error: inviteErr?.message ?? 'Could not send the invitation.' })
    }
    targetId = invited.user.id
  }

  const { error } = await admin.from('org_members').upsert({
    org_id: member.org_id,
    user_id: targetId,
    role: 'member',
    daily_limit_usd: dailyLimit,
    invited_by: caller.id
  })

  if (error) return json(500, { error: 'Could not add them to the organisation.' })
  return json(200, { ok: true, email })
})
