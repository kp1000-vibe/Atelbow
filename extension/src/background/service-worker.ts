import { AUTO_PROMPT, buildSystemPrompt, wantsAction, wantsFill } from './prompt'
import { PROVIDERS, getProvider } from './providers'
import * as usage from './usage'
import * as telemetry from './telemetry'
import * as diag from './diagnostics'
import * as recall from './recall'
import { startHotReload } from '../dev/hot-reload'
import type {
  ChatMessage,
  ContentResponse,
  FillProposal,
  PageContext,
  PageElement,
  PanelEvent,
  PanelRequest,
  ProviderId
} from '../shared/types'

/** Nothing about this flow should ever leave the panel spinning indefinitely. */
const REQUEST_TIMEOUT_MS = 60_000

telemetry.scheduleFlush()

// Compile-time constant: this whole branch, and the module it calls, are absent from a
// production build.
if (__DEV__) startHotReload()

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Older Chrome builds lack this; the panel still opens from the action menu.
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id

  /** Opens the side panel when the in-page badge is clicked. */
  if (msg?.type === 'open-panel') {
    if (tabId === undefined) return
    // Must be called synchronously in the handler to stay within the user gesture.
    void chrome.sidePanel.open({ tabId }).catch((err) => {
      console.warn('[atelbow] could not open side panel:', err)
    })
    return
  }

  if (msg?.type === 'forget-recall') {
    void recall.forget().then(() => sendResponse({ ok: true }))
    return true
  }

  if (msg?.type === 'step-signal') {
    if (tabId === undefined) return
    const key = lastRecallKey.get(tabId)
    if (key) void recall.score(key, msg.clicked === true)
    return
  }

  if (msg?.type === 'auto-annotate') {
    if (tabId === undefined || typeof msg.url !== 'string') return
    void runAutoAnnotate(tabId, msg.url)
    return
  }

  /** No key, no account — runs the on-page demonstration in the active tab. */
  if (msg?.type === 'run-demo') {
    void (async () => {
      try {
        const id = await activeTabId()
        const res = await askContent(id, { type: 'run-demo' })
        sendResponse(res)
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message })
      }
    })()
    return true
  }

  if (msg?.type === 'set-diagnostics') {
    void diag.setOn(msg.enabled === true).then(() => sendResponse({ ok: true }))
    return true
  }

  if (msg?.type === 'get-diagnostics') {
    void (async () => {
      sendResponse({ on: await diag.isOn(), text: diag.format(await diag.readAll()) })
    })()
    return true
  }

  if (msg?.type === 'list-providers') {
    sendResponse(PROVIDERS)
    return
  }

  /**
   * Verifies a key against the provider before storing it. Nothing is saved unless the check
   * passes, so a mistyped key can't sit there and fail confusingly mid-answer later.
   */
  if (msg?.type === 'validate-key') {
    void (async () => {
      try {
        const result = await getProvider(msg.providerId).validateKey(msg.apiKey)
        if (result.ok) {
          const { apiKeys } = await chrome.storage.local.get('apiKeys')
          const map = { ...((apiKeys ?? {}) as Record<string, string>), [msg.providerId]: msg.apiKey }
          await chrome.storage.local.set({ apiKeys: map, providerId: msg.providerId })
        }
        sendResponse(result)
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message })
      }
    })()
    return true // async response
  }
})

/**
 * Analyses a page without being asked. Every guard here exists because this spends money on
 * its own: it must never fire twice for the same page, never run when switched off, and
 * never run on a page with too little on it to be worth reading.
 */
async function runAutoAnnotate(tabId: number, url: string): Promise<void> {
  const task = activeTasks.get(tabId)

  // A task in progress takes precedence over auto-reading, and runs even when auto is off:
  // the user explicitly asked for this, so continuing it is not an uninvited read.
  if (task) {
    if (task.hops >= MAX_TASK_HOPS) {
      activeTasks.delete(tabId)
    } else {
      task.hops += 1
      autoAnalysed.set(tabId, url)
      try {
        await handleAsk(continuationPrompt(task.goal), [], broadcast, {
          tabId,
          continuingGoal: task.goal
        })
      } catch (err) {
        console.warn('[atelbow] task continuation failed:', (err as Error).message)
      }
      return
    }
  }

  if (!(await isAutoEnabled())) return
  if (autoAnalysed.get(tabId) === url) return
  autoAnalysed.set(tabId, url)

  try {
    await handleAsk(AUTO_PROMPT, [], broadcast, { tabId, auto: true })
  } catch (err) {
    // Unattended failures stay quiet — a background run shouldn't interrupt the user.
    console.warn('[atelbow] auto-annotate failed:', (err as Error).message)
    void chrome.tabs.sendMessage(tabId, { type: 'set-badge', state: 'idle' }).catch(() => {})
  }
}

/** Hostname only — a path can carry a record id or a customer name. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

function continuationPrompt(goal: string): string {
  return (
    `CONTINUING A TASK. The user originally asked: "${goal}". They have followed your ` +
    'earlier steps and the page has changed. Look at where they are now and give the next ' +
    'steps toward that same goal — do not start over or re-explain what they have already ' +
    'done. If the goal now looks complete, say so in one line and do not annotate.'
  )
}

/**
 * Carries a task into a tab the user was sent to.
 *
 * Booking, search and SSO flows routinely open their next screen in a new tab, which gets a
 * fresh tabId and inherits nothing — so the walkthrough died exactly where multi-page tasks
 * most need it. The hop count comes along too, so a chain of new tabs can't outrun the cap.
 */
chrome.tabs.onCreated.addListener((tab) => {
  const opener = tab.openerTabId
  if (opener === undefined || tab.id === undefined) return
  const task = activeTasks.get(opener)
  if (task) activeTasks.set(tab.id, { goal: task.goal, hops: task.hops })
})

// Don't let the per-tab maps grow for the life of the browser session.
chrome.tabs.onRemoved.addListener((tabId) => {
  autoAnalysed.delete(tabId)
  pendingFills.delete(tabId)
  activeTasks.delete(tabId)
  lastRecallKey.delete(tabId)
})

/** Keys are stored per provider, so switching vendors doesn't wipe the previous one. */
async function getSelectedProvider(): Promise<ProviderId> {
  const { providerId } = await chrome.storage.local.get('providerId')
  return (typeof providerId === 'string' ? providerId : 'gemini') as ProviderId
}

async function getApiKey(id: ProviderId): Promise<string> {
  const { apiKeys } = await chrome.storage.local.get('apiKeys')
  const map = (apiKeys ?? {}) as Record<string, string>
  return map[id] ?? ''
}

/**
 * The panel, when it's open. Auto-annotation runs whether or not anyone is looking, so its
 * output is broadcast here rather than returned through a request/response pair.
 */
let activePort: chrome.runtime.Port | null = null

function broadcast(event: PanelEvent): void {
  try {
    activePort?.postMessage(event)
  } catch {
    activePort = null
  }
}

/** Last URL auto-analysed per tab — the guard against paying twice for the same page. */
const autoAnalysed = new Map<number, string>()

/**
 * The remembered walkthrough currently on screen, per tab, so the click signal can be scored
 * against the entry that produced it.
 */
const lastRecallKey = new Map<number, string>()

/**
 * What the user is in the middle of doing, per tab.
 *
 * A walkthrough used to end at the page boundary: "click Services" was correct, and then the
 * navigation wiped everything and left the user stranded on a new page with no guidance. Real
 * tasks span pages, so the goal has to outlive the page.
 */
interface ActiveTask {
  goal: string
  /** Continuations so far — a bounded number, since each one costs a request. */
  hops: number
}
const activeTasks = new Map<number, ActiveTask>()

/**
 * Enough for a multi-page flow, few enough that a wandering user can't run up a bill.
 * Enterprise setup flows are the deep case — a Workday scheduled job or a Salesforce
 * calculated field runs to six or seven screens, and cutting off at four strands the user
 * mid-task, which is worse than the extra calls.
 */
const MAX_TASK_HOPS = 7

/**
 * Bumped whenever the user starts a new conversation. A run that began before the bump is
 * stale: its answer belongs to a conversation that no longer exists, and letting it through
 * repopulates the fresh chat with the previous page's analysis.
 */
let generation = 0

/** Auto-annotation runs unattended, so it needs a floor on what's worth a paid call. */
const MIN_ELEMENTS_FOR_AUTO = 8

async function isAutoEnabled(): Promise<boolean> {
  const { autoAnnotate } = await chrome.storage.local.get('autoAnnotate')
  return autoAnnotate !== false // default on
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab.')
  if (tab.url && !/^https?:/.test(tab.url)) {
    throw new Error("atElbow can't read browser pages like this one. Open a normal website and try again.")
  }
  return tab.id
}

async function askContent<T extends ContentResponse>(tabId: number, message: unknown): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch {
    throw new Error('Cannot reach this page. Reload the tab, then try again.')
  }
}

/** Fill proposals awaiting approval, per tab. Cleared once approved or superseded. */
const pendingFills = new Map<number, FillProposal[]>()

/**
 * Maps model-proposed fills onto real fillable fields, dropping anything it shouldn't touch.
 * This is the enforcement point: the model can only ever *suggest*, and only for fields the
 * extractor already classified as safe text inputs.
 */
function toFillProposals(
  raw: { elementId: number; value: string }[],
  elements: PageElement[]
): FillProposal[] {
  const byId = new Map(elements.map((el) => [el.id, el]))
  return raw.flatMap((fill) => {
    const el = byId.get(fill.elementId)
    if (!el?.fillable) return []
    if (typeof fill.value !== 'string' || !fill.value) return []
    return [{ elementId: el.id, fieldName: el.text.slice(0, 60), value: fill.value }]
  })
}

/**
 * Runs one question end-to-end: read the page, ask Claude, stream text back to the panel,
 * then draw whatever it annotated.
 */
async function handleAsk(
  prompt: string,
  history: ChatMessage[],
  rawEmit: (e: PanelEvent) => void,
  options: { tabId?: number; auto?: boolean; continuingGoal?: string } = {}
): Promise<void> {
  // Anything produced after a reset belongs to an abandoned conversation and is dropped —
  // both the streamed text and the marks it would have drawn on the page.
  const startedAt = generation
  const isCurrent = (): boolean => generation === startedAt
  const emit = (e: PanelEvent): void => {
    if (isCurrent()) rawEmit(e)
  }

  const providerId = await getSelectedProvider()
  const apiKey = await getApiKey(providerId)
  if (!apiKey) {
    // Silent when unattended — an auto-run shouldn't nag about setup the user hasn't reached.
    if (!options.auto) {
      emit({ type: 'error', message: 'Add an API key in settings to get started.' })
    }
    return
  }

  // Checked before the call, not after — the point of a budget is not spending past it.
  if (await usage.isOverLimit()) {
    const s = await usage.summary()
    if (!options.auto) {
      emit({
        type: 'error',
        message: `Daily limit reached (${s.todayRequests}/${s.dailyLimit} today). Resets at midnight, or raise the limit in the panel.`
      })
    }
    return
  }

  const tabId = options.tabId ?? (await activeTabId())
  emit({ type: 'status', stage: 'reading' })
  void chrome.tabs.sendMessage(tabId, { type: 'set-badge', state: 'working' }).catch(() => {})

  const tRead = Date.now()
  const res = await askContent(tabId, { type: 'collect-context' })
  const readMs = Date.now() - tRead
  if (!res.ok || !res.context) {
    emit({ type: 'error', message: res.ok ? 'Could not read the page.' : res.error })
    return
  }

  const context: PageContext = res.context

  // Never read a banking, health or login page unattended. Redaction catches structured
  // identifiers, but the substance of a medical record or a statement is ordinary prose that
  // no pattern can recognise — so the only real protection is not reading it uninvited.
  if (context.sensitive) {
    if (options.auto) {
      // Unattended reading is off here. Asking still works — the user is welcome to get help
      // resetting a password; what's ruled out is reading the page uninvited.
      void chrome.tabs.sendMessage(tabId, { type: 'set-badge', state: 'idle' }).catch(() => {})
      return
    }
    emit({
      type: 'page-note',
      text: 'Sensitive site — auto-read is off here, and card, account and contact details are stripped before anything is sent.'
    })
  }

  const floor = options.auto ? MIN_ELEMENTS_FOR_AUTO : 1
  if (context.elements.length < floor) {
    if (!options.auto) {
      emit({ type: 'error', message: "I couldn't find anything readable on this page." })
    } else {
      void chrome.tabs.sendMessage(tabId, { type: 'set-badge', state: 'idle' }).catch(() => {})
    }
    return
  }

  // --- remembered walkthrough -------------------------------------------------------
  //
  // Checked after the page is read, never before: a remembered step is only shown once it has
  // been re-found among the elements actually on screen this turn. That is what keeps a cache
  // from reintroducing the staleness this product exists to avoid.
  if (!options.auto && !wantsFill(prompt) && !options.continuingGoal) {
    const host = safeHost(context.url)
    const hit = await recall.lookup(host, prompt, context.elements)
    if (hit) {
      emit({ type: 'chunk', text: hit.entry.answer })
      const render = await askContent(tabId, {
        type: 'render-annotations',
        annotations: hit.annotations
      })
      const drawn = render.ok ? (render.drawn ?? 0) : 0
      if (drawn > 0) {
        lastRecallKey.set(tabId, hit.key)
        emit({ type: 'annotated', count: drawn })
        void chrome.tabs
          .sendMessage(tabId, { type: 'set-badge', state: 'marked', count: drawn })
          .catch(() => {})
        emit({ type: 'done' })
        void telemetry.count('recallHits')
        return
      }
      // Resolved against the element list but refused to draw — fall through and pay for a
      // fresh answer rather than leaving the user with nothing.
    }
  }

  // When the user has plainly asked to fill something in, don't leave it to the model to
  // decide whether to use the tool — that judgement call is exactly what was misfiring.
  // Forcing it is safe here because the result is only ever a *proposal*: every value is
  // shown, editable and skippable before a single character is typed.
  const requireAction =
    !options.auto &&
    (wantsAction(prompt) || history.slice(-2).some((m) => m.role === 'user' && wantsAction(m.text)))

  const provider = getProvider(providerId)
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)

  // Diagnostics for this turn. Collected unconditionally (it is a handful of numbers) but
  // only persisted when recording is switched on.
  const trace: {
    requested: { id: number; label: string }[]
    steps: diag.StepTrace[]
    drawn: number
    modelMs?: number
    drawMs?: number
    error?: string
  } = { requested: [], steps: [], drawn: 0 }
  const tModel = Date.now()

  let sawText = false
  let textLength = 0
  // Kept for the recall store: what was marked, and the words that explained it.
  let lastAnnotations: import('../shared/types').Annotation[] = []
  let visibleAnswer = ''
  let annotated = false
  let proposedFill = false
  let namedUnfillable = false

  try {
    emit({ type: 'status', stage: 'writing' })

    for await (const ev of provider.send({
      apiKey,
      system: buildSystemPrompt(context, { action: requireAction, fill: wantsFill(prompt) }),
      history,
      prompt,
      requireAction,
      signal: abort.signal
    })) {
      if (ev.type === 'text') {
        if (ev.text.trim()) sawText = true
        textLength += ev.text.length
        visibleAnswer += ev.text
        emit({ type: 'chunk', text: ev.text })
        continue
      }

      if (ev.type === 'fills') {
        const proposals = toFillProposals(ev.fills, context.elements)
        if (proposals.length > 0) {
          // Proposals only — the panel gates these behind approval before any typing.
          pendingFills.set(tabId, proposals)
          proposedFill = true
          emit({ type: 'fill-proposed', proposals })
        } else if (ev.fills.length > 0) {
          namedUnfillable = true
        }
        continue
      }

      if (ev.type === 'annotations' && isCurrent()) {
        emit({ type: 'status', stage: 'marking' })
        trace.modelMs = Date.now() - tModel
        trace.requested = ev.annotations.map((a) => ({ id: a.elementId, label: a.label }))
        lastAnnotations = ev.annotations
        const tDraw = Date.now()
        const render = await askContent(tabId, {
          type: 'render-annotations',
          annotations: ev.annotations
        })
        trace.drawMs = Date.now() - tDraw
        if (render.ok && render.traces) {
          trace.steps = render.traces.map((r) => ({
            id: r.id,
            resolved: r.resolved,
            control: r.control,
            storedY: r.storedY,
            liveY: r.liveY,
            driftY:
              r.storedY !== undefined && r.liveY !== undefined ? r.liveY - r.storedY : undefined
          }))
        }
        // `drawn` is what landed on the page. It falls short of what was asked for whenever
        // the model cites an element that isn't in the list, and treating the request as the
        // result is what let a page with nothing on it report "Marked 3 items".
        const drawn = render.ok ? (render.drawn ?? 0) : 0
        trace.drawn = drawn
        if (drawn > 0) {
          annotated = true
          emit({ type: 'annotated', count: drawn })
          void chrome.tabs
            .sendMessage(tabId, { type: 'set-badge', state: 'marked', count: drawn })
            .catch(() => {})
        } else if (render.ok && ev.annotations.length > 0) {
          emit({
            type: 'chunk',
            text:
              "\n\n(I couldn't mark those on the page — the controls I picked aren't ones I " +
              'can see from here. The written steps above still hold.)'
          })
        }
      }
    }
    // Set unconditionally: previously this was only recorded inside the annotations branch,
    // so the turns that failed to annotate — the ones worth diagnosing — showed no model time
    // at all.
    if (trace.modelMs === undefined) trace.modelMs = Date.now() - tModel
  } finally {
    clearTimeout(timeout)
  }

  // Silence here is indistinguishable from the model ignoring the request, so say which
  // of the three things actually happened.
  if (namedUnfillable) {
    emit({
      type: 'chunk',
      text: `\n\n(I tried to fill fields this page doesn't expose as text inputs — they may be pickers that need clicking.)`
    })
  } else if (requireAction && !proposedFill && !annotated) {
    emit({ type: 'chunk', text: `\n\n(I couldn't work out which fields to fill from that.)` })
  }

  // Remember what they're trying to do, so the next page can pick the thread back up.
  //
  // Registered on intent, not on success: a turn that explained the steps but failed to
  // annotate is still a user pursuing a goal, and tying the thread to annotation meant one
  // missed tool call silently ended continuity for the rest of the task.
  if (!options.auto && (annotated || wantsAction(prompt))) {
    const goal = options.continuingGoal ?? prompt
    const existing = activeTasks.get(tabId)
    activeTasks.set(tabId, { goal, hops: existing?.hops ?? 0 })
  }

  if (annotated && !sawText) {
    emit({ type: 'chunk', text: "I've marked the steps on the page — follow the highlights." })
  }
  if (!annotated) {
    void chrome.tabs.sendMessage(tabId, { type: 'set-badge', state: 'idle' }).catch(() => {})
  }

  // Token counts aren't uniform across six providers, so usage is tracked per request
  // rather than per token. See usage.ts.
  // Store only what actually drew, and only for a question the user asked directly —
  // continuations are keyed to a goal, not to a repeatable phrasing.
  if (annotated && !options.auto && !options.continuingGoal && lastAnnotations.length > 0) {
    const key = await recall.remember(
      safeHost(context.url),
      prompt,
      visibleAnswer,
      lastAnnotations,
      context.elements
    )
    if (key) lastRecallKey.set(tabId, key)
  }

  void diag.record({
    at: new Date().toISOString(),
    host: safeHost(context.url),
    provider: providerId,
    prompt,
    kind: options.auto ? 'auto' : options.continuingGoal ? 'continuation' : 'ask',
    page: {
      kept: context.elements.length,
      interactive: context.stats?.interactive ?? 0,
      candidates: context.stats?.candidates ?? 0,
      scanned: context.stats?.scanned ?? 0,
      sensitive: context.sensitive
    },
    textChars: textLength,
    requested: trace.requested,
    drawn: trace.drawn,
    steps: trace.steps,
    ms: { read: readMs, model: trace.modelMs, draw: trace.drawMs },
    error: trace.error
  })

  await usage.recordRequest(providerId)
  void telemetry.count(options.auto ? 'autoReads' : 'asks')
  if (annotated) void telemetry.count('annotations')
  if (proposedFill) void telemetry.count('fillsProposed')
  void chrome.storage.local.set({ telemetryProvider: providerId })
  broadcast({ type: 'usage', summary: await usage.summary() })

  emit({ type: 'done' })
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'atelbow') return

  activePort = port

  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError
    if (activePort === port) activePort = null

    // Closing the chat should leave the page as it was found — marks belong to the
    // conversation that produced them.
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (tab?.id) return chrome.tabs.sendMessage(tab.id, { type: 'clear-annotations' })
      })
      .catch(() => {})
  })

  port.onMessage.addListener(async (msg: PanelRequest) => {
    const emit = (e: PanelEvent): void => {
      try {
        port.postMessage(e)
      } catch {
        // Panel closed mid-stream; nothing to deliver to.
      }
    }

    try {
      if (msg.type === 'ask') {
        await handleAsk(msg.prompt, msg.history, emit)
      } else if (msg.type === 'clear-annotations') {
        await askContent(await activeTabId(), { type: 'clear-annotations' })
      } else if (msg.type === 'set-auto') {
        await chrome.storage.local.set({ autoAnnotate: msg.enabled })
      } else if (msg.type === 'reset') {
        // Invalidates every run currently in flight, then wipes the page clean.
        generation += 1
        pendingFills.clear()
        activeTasks.clear()
        const tabId = await activeTabId()
        await askContent(tabId, { type: 'clear-annotations' })
      } else if (msg.type === 'get-usage') {
        emit({ type: 'usage', summary: await usage.summary() })
      } else if (msg.type === 'set-daily-limit') {
        await chrome.storage.local.set({ dailyLimit: Math.max(1, Math.round(msg.limit)) })
        emit({ type: 'usage', summary: await usage.summary() })
      } else if (msg.type === 'approve-fill') {
        // Reached only from the panel's approval button — never from the model.
        const tabId = await activeTabId()
        const allowed = pendingFills.get(tabId) ?? []
        pendingFills.delete(tabId)

        // Re-check each approved item against what was actually proposed, so a value can be
        // edited but a field the model never offered can't be smuggled in.
        const allowedIds = new Set(allowed.map((p) => p.elementId))
        const fills = msg.approved.filter((p) => allowedIds.has(p.elementId))

        void telemetry.count('fillsApproved')
        const res = await askContent(tabId, { type: 'apply-fills', fills })
        emit({ type: 'filled', outcomes: res.ok ? (res.outcomes ?? []) : [] })
      }
    } catch (err) {
      emit({ type: 'error', message: (err as Error).message })
      emit({ type: 'done' })
    }
  })
})
