import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in console/.env.local — see backend/README.md'
  )
}

export const supabase = createClient(url, anonKey)
export const functionsBase = `${url.replace(/\/$/, '')}/functions/v1`

/** Calls an edge function with the signed-in user's JWT attached. */
export async function callFunction(
  name: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; body: any }> {
  const {
    data: { session }
  } = await supabase.auth.getSession()

  const res = await fetch(`${functionsBase}/${name}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'content-type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`
    }
  })

  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export const money = (n: number | null | undefined): string =>
  n == null ? '—' : `$${Number(n).toFixed(2)}`
