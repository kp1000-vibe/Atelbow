/**
 * Envelope encryption for provider API keys.
 *
 * The database stores ciphertext only. PROVIDER_KEY_SECRET lives in the function's
 * environment, so a database dump — the realistic breach — yields nothing usable without a
 * second, separately held secret.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

async function keyMaterial(): Promise<CryptoKey> {
  const secret = Deno.env.get('PROVIDER_KEY_SECRET')
  if (!secret || secret.length < 32) {
    throw new Error('PROVIDER_KEY_SECRET missing or shorter than 32 characters')
  }
  // A single SHA-256 over a high-entropy secret, not a password KDF: this input is a
  // generated secret, not something a human chose, so stretching buys nothing.
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt'
  ])
}

export async function encryptKey(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await keyMaterial()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return { ciphertext: b64(new Uint8Array(buf)), iv: b64(iv) }
}

export async function decryptKey(ciphertext: string, iv: string): Promise<string> {
  const key = await keyMaterial()
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) },
    key,
    unb64(ciphertext)
  )
  return dec.decode(buf)
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}
