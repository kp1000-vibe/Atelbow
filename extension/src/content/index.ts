import { collectPageContext } from './extract'
import { runDemo } from './demo'
import { applyFills } from './fill'
import { clearAnnotations, isWalkthroughActive, renderAnnotations, setBadge } from './overlay'
import type { ContentRequest, ContentResponse, PageElement } from '../shared/types'

/**
 * Elements from the most recent collection, kept so annotations resolve against exactly the
 * geometry the model was shown. Re-scraping at render time would risk the page having
 * shifted underneath us.
 */
let lastElements: PageElement[] = []

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse: (r: ContentResponse) => void) => {
    try {
      switch (message.type) {
        case 'collect-context': {
          const context = collectPageContext()
          lastElements = context.elements
          sendResponse({ ok: true, context })
          break
        }
        case 'render-annotations': {
          // Report what was actually drawn, not what was asked for. Ids the model invented
          // resolve to nothing, and reporting the requested count made that failure invisible:
          // the panel said "Marked 3 items" over a page with no marks on it.
          const result = renderAnnotations(message.annotations, lastElements)
          sendResponse({ ok: true, drawn: result.drawn, traces: result.traces })
          break
        }
        case 'clear-annotations': {
          clearAnnotations()
          sendResponse({ ok: true })
          break
        }
        case 'set-badge': {
          setBadge(message.state, message.count)
          sendResponse({ ok: true })
          break
        }
        case 'run-demo': {
          const result = runDemo()
          sendResponse(result.ok ? { ok: true } : { ok: false, error: result.reason ?? 'Demo failed.' })
          break
        }
        case 'apply-fills': {
          // Verification waits for the page to settle, so this one is genuinely async.
          // Returning true below keeps the message channel open for the late response.
          void applyFills(message.fills).then((outcomes) => sendResponse({ ok: true, outcomes }))
          return true
        }
        default:
          sendResponse({ ok: false, error: 'Unknown request.' })
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message })
    }
    // Every other branch answered synchronously; returning true for those would leave the
    // message channel open forever.
    return false
  }
)

// Show the pill as soon as the extension is live on this page, so the user can tell at a
// glance that atElbow is watching — and, just as importantly, when it isn't.
setBadge('idle')

/**
 * Lets the page settle before auto-analysing. Firing at document_idle catches skeletons and
 * spinners rather than real content, and on a metered API a wasted call is a wasted call.
 */
const AUTO_SETTLE_MS = 1800

/**
 * Mid-walkthrough the user has just clicked something and is waiting for the next step, so
 * the long settle is dead air. Shorter is safe here because they drove the navigation —
 * the page is already rendering what they asked for.
 */
const TASK_SETTLE_MS = 550

function requestAutoAnnotate(): void {
  chrome.runtime.sendMessage({ type: 'auto-annotate', url: location.href }).catch(() => {
    // Extension reloaded or worker asleep; the user can still ask manually.
  })
}

setTimeout(requestAutoAnnotate, AUTO_SETTLE_MS)

// Markers describe a specific layout; a client-side route change invalidates them.
let lastUrl = location.href
let routeTimer: ReturnType<typeof setTimeout> | undefined

new MutationObserver(() => {
  if (location.href === lastUrl) return
  lastUrl = location.href
  // Read this before clearing — clearing is what turns the walkthrough flag off.
  const midTask = isWalkthroughActive()
  clearAnnotations()

  // SPAs can fire several route updates per navigation; only the settled one is worth paying
  // for, so restart the timer on each change rather than queueing a call per event.
  clearTimeout(routeTimer)
  routeTimer = setTimeout(requestAutoAnnotate, midTask ? TASK_SETTLE_MS : AUTO_SETTLE_MS)
}).observe(document, { subtree: true, childList: true })
