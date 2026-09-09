# ScreenPilot — Chrome Extension (prototype)

The step-1 wedge: ask about the page you're on, and get the answer **drawn onto the page**
rather than described in a chat window.

## Why this replaces the desktop app's hardest machinery

The desktop app reads Windows UI Automation through a PowerShell bridge to learn what's on
screen. In a browser, the DOM *is* that data — and it's strictly better:

| | Desktop (UIA) | Extension (DOM) |
|---|---|---|
| Element geometry | ~900ms PowerShell probe | `getBoundingClientRect()`, instant |
| Element text | OCR/vision risk of misreads | exact `textContent` |
| Overlay on scroll | can't follow — it's a separate window | anchored in the document, follows natively |
| Cost per question | screenshot ≈ 1,500+ vision tokens | ~2.7KB of text (measured on a real page) |

## Load it

```bash
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select the `extension/dist` folder. Click the toolbar icon to open the side panel.

Use `npm run dev` to rebuild on change (press the reload button on the extension card
afterwards; Chrome does not hot-reload content scripts).

## Architecture

```
src/
  content/
    extract.ts   DOM → PageElement[] with document-space coordinates
    overlay.ts   Shadow-DOM overlay: coloured boxes + label chips
    index.ts     message handling, clears marks on SPA route change
  background/
    prompt.ts          system prompt + annotate_page tool schema
    service-worker.ts  Anthropic streaming call, wires page → model → overlay
  sidepanel/     React chat UI
```

**Verdict vocabulary** is a fixed set (`best` / `value` / `flexible` / `caution` / `info`)
so colours stay stable and learnable across every site, instead of the model inventing a new
label scheme per page.

**Coordinates are document-space** (rect + scroll offset), which is what lets a marker stay
glued to its target while the user scrolls.

## Known limitations

- **Container text merging.** An element like `<tr>` wrapping a nav bar reports its children's
  text concatenated (`"Hacker Newsnew | past | comments"`). Harmless but wasteful; a
  leaf-vs-card heuristic would tighten it. Deliberately not over-filtered — dropping real
  option cards would be a worse failure than some noise.
- **On-screen only.** Elements outside the viewport are skipped, so answers cover what the
  user can currently see. Scrolling and re-asking picks up the rest.
- **Same-origin main frame only.** Cross-origin iframes (many embedded checkout and booking
  widgets) aren't readable without `all_frames` plus per-frame overlay logic.
- **Not usable on `chrome://` pages** or the Web Store — Chrome blocks content scripts there.

## Before this can ship as a tiered product

The prototype has the user paste their own Anthropic key, stored in `chrome.storage.local`.
**That does not survive contact with a free/paid tier** — a shipped key is a leaked key, and
metering has to happen somewhere you control. Going commercial means a backend that holds the
key, authenticates the user, meters usage, and proxies the model call. That backend is what
the "website" half of the product actually is, and it is a larger build than this extension.
