import { createClient } from 'jsr:@supabase/supabase-js@2'
import { PROVIDERS, isProvider } from '../_shared/providers.ts'
import { meterStream } from '../_shared/meter.ts'
import { decryptKey } from '../_shared/crypto.ts'
import { costUsd } from '../_shared/pricing.ts'

/**
 * The model proxy.
 *
 * This exists so that an admin's spend cap is a cap. Enforcement here — before the upstream
 * call — is the only place it cannot be edited by the person it applies to, and the org's
 * API key never leaves the server.
 *
 * What it deliberately does NOT do: read, log or store the request body. Page content passes
 * through this function and is never written anywhere.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function fail(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail(405, 'POST only')

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) return fail(401, 'Sign in to use atElbow.')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (userErr || !user) return fail(401, 'Your session has expired. Sign in again.')

  let body: { provider?: unknown; model?: unknown; payload?: unknown; appHost?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'Malformed request.')
  }

  const { provider, model, payload } = body
  if (!isProvider(provider)) return fail(400, 'Unknown provider.')
  if (typeof model !== 'string' || !model) return fail(400, 'Missing model.')
  if (!payload || typeof payload !== 'object') return fail(400, 'Missing payload.')

  // --- membership, role and caps -------------------------------------------------------

  const { data: member } = await admin
    .from('org_members')
    .select('org_id, disabled, daily_limit_usd, monthly_limit_usd')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!member) return fail(403, 'Your account is not part of an organisation yet.')
  if (member.disabled) {
    return fail(403, 'Your access has been turned off. Contact your atElbow admin.')
  }

  const orgId = member.org_id as string

  // A zero cap means blocked, and saying so plainly beats letting them discover it as a
  // budget error on every request.
  if (Number(member.daily_limit_usd) === 0 || Number(member.monthly_limit_usd) === 0) {
    return fail(403, 'Your admin has set your allowance to zero.')
  }

  const [{ data: spentToday }, { data: spentMonth }] = await Promise.all([
    admin.rpc('spend_today', { target_org: orgId, target_user: user.id }),
    admin.rpc('spend_this_month', { target_org: orgId, target_user: user.id })
  ])

  const day = member.daily_limit_usd === null ? null : Number(member.daily_limit_usd)
  const month = member.monthly_limit_usd === null ? null : Number(member.monthly_limit_usd)

  if (day !== null && Number(spentToday ?? 0) >= day) {
    return fail(429, "You've used your allowance for today. It resets at midnight UTC.", {
      limit: 'daily'
    })
  }
  if (month !== null && Number(spentMonth ?? 0) >= month) {
    return fail(429, "You've used your allowance for this month.", { limit: 'monthly' })
  }

  // --- the org's key -------------------------------------------------------------------

  const { data: keyRow } = await admin
    .from('provider_keys')
    .select('ciphertext, iv')
    .eq('org_id', orgId)
    .eq('provider', provider)
    .maybeSingle()

  if (!keyRow) {
    return fail(409, `Your admin hasn't added a ${provider} key yet.`)
  }

  let apiKey: string
  try {
    apiKey = await decryptKey(keyRow.ciphertext, keyRow.iv)
  } catch {
    return fail(500, 'The stored key could not be read. Ask your admin to re-enter it.')
  }

  // --- upstream ------------------------------------------------------------------------

  // OpenAI-compatible providers report usage only when asked, and without usage there is no
  // enforcement — so this is injected rather than trusted to the client.
  const upstreamBody: Record<string, unknown> = { ...(payload as Record<string, unknown>) }
  if (provider !== 'anthropic' && provider !== 'gemini') {
    upstreamBody.stream_options = { include_usage: true }
  }

  const spec = PROVIDERS[provider]
  let upstream: Response
  try {
    upstream = await fetch(spec.url(model), {
      method: 'POST',
      headers: spec.headers(apiKey),
      body: JSON.stringify(upstreamBody)
    })
  } catch {
    return fail(502, `Couldn't reach ${provider}.`)
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    // Record the failed attempt so an admin investigating "it stopped working" can see that
    // calls were made and rejected, rather than seeing nothing at all.
    await admin.from('usage_events').insert({
      org_id: orgId,
      user_id: user.id,
      provider,
      model,
      cost_usd: 0,
      app_host: hostOf(body.appHost),
      ok: false
    })
    if (upstream.status === 401 || upstream.status === 403) {
      return fail(502, "The organisation's API key was rejected by the provider.")
    }
    return fail(502, `${provider} returned ${upstream.status}. ${detail.slice(0, 200)}`)
  }

  const metered = upstream.body.pipeThrough(
    meterStream(provider, async (tokens) => {
      // Metering runs as the stream drains. A failure to record must not break the answer
      // already delivered, so this swallows its own errors.
      try {
        await admin.from('usage_events').insert({
          org_id: orgId,
          user_id: user.id,
          provider,
          model,
          input_tokens: tokens.input,
          output_tokens: tokens.output,
          cost_usd: costUsd(model, tokens.input, tokens.output),
          app_host: hostOf(body.appHost),
          ok: true
        })
      } catch (e) {
        console.error('usage insert failed', e)
      }
    })
  )

  return new Response(metered, {
    headers: {
      ...CORS,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache'
    }
  })
})

/**
 * Hostname only, never a full URL — a path can carry a record id, a customer name or a search
 * term, and none of that belongs in an analytics table.
 */
function hostOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return value.replace(/^www\./, '').slice(0, 120)
}
