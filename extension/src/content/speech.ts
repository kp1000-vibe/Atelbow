/**
 * Reads each step aloud as it is spotlit.
 *
 * Built on the browser's own speech synthesis rather than a cloud voice: it costs nothing per
 * use, needs no extra permission, works offline — and the text never leaves the machine, which
 * a hosted voice could not honestly claim.
 *
 * Off unless the user turns it on. Software that starts talking unbidden on a page you just
 * opened is the kind of thing people uninstall over.
 */

const SETTING = 'speakSteps'

let enabled = false
let voice: SpeechSynthesisVoice | null = null

/** Slightly under natural pace: this is instruction, and the listener is looking elsewhere. */
const RATE = 0.95

export function initSpeech(): void {
  if (typeof speechSynthesis === 'undefined') return

  chrome.storage.local.get(SETTING).then(
    (v) => {
      enabled = v[SETTING] === true
    },
    () => {
      /* storage unavailable — stays off, which is the safe default */
    }
  )

  // Keep in step with the panel's toggle without needing a message round trip.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTING]) return
    enabled = changes[SETTING].newValue === true
    if (!enabled) stopSpeaking()
  })

  pickVoice()
  // getVoices() is empty until the list loads, and the event may have fired already — so this
  // runs both now and on the event rather than trusting either alone.
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice)
}

function pickVoice(): void {
  const voices = speechSynthesis.getVoices?.() ?? []
  if (voices.length === 0) return

  // A local voice avoids a network round trip mid-walkthrough, and keeps the promise that
  // nothing is sent anywhere.
  voice =
    voices.find((v) => v.localService && /^en[-_]/i.test(v.lang)) ??
    voices.find((v) => /^en[-_]/i.test(v.lang)) ??
    voices[0] ??
    null
}

export function isSpeechOn(): boolean {
  return enabled
}

/**
 * Speaks one step. Any previous utterance is cancelled first — a walkthrough that queues up
 * three steps and reads them over each other is worse than silence.
 */
export function speakStep(
  index: number,
  total: number,
  label: string,
  note?: string
): void {
  if (!enabled || typeof speechSynthesis === 'undefined') return

  stopSpeaking()

  const position = total > 1 ? `Step ${index + 1} of ${total}. ` : ''
  const text = `${position}${label}${note ? `. ${note}` : ''}`

  try {
    const utterance = new SpeechSynthesisUtterance(text)
    if (voice) utterance.voice = voice
    utterance.rate = RATE
    speechSynthesis.speak(utterance)
  } catch {
    // Some pages and policies block synthesis. Losing the audio must never break the visual
    // walkthrough, which is the part that actually matters.
  }
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis === 'undefined') return
  try {
    speechSynthesis.cancel()
  } catch {
    /* nothing to cancel */
  }
}
