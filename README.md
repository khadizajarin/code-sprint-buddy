# ⚡ SprintBuddy v2 — Chrome Extension

## What's new in v2

| Feature | Details |
|---|---|
| **Persistent timer** | Uses `chrome.storage.local` + `chrome.alarms` — survives popup close, SW sleep, browser restart |
| **Sprint streaks** | Dot counter tracks sprints completed today, resets each day |
| **Task list** | Add/check-off/delete tasks, stored in Chrome storage, resets done status daily |
| **Reminders** | Alarm-based reminders that fire even when popup is closed, stored persistently |
| **Break tips** | Random break suggestions shown in notification when sprint ends |

## File structure

```
sprint-extension/
├── manifest.json      ← MV3, includes "alarms" permission
├── popup.html
├── popup.tsx          ← React UI (Sprint · Tasks · Reminders tabs)
├── popup.css
├── background.ts      ← Service worker with chrome.alarms + chrome.storage
├── content.ts         ← Audio playback in page context
├── notification.mp3   ← Add your own sound file here
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Setup & Build

### 1. Install dependencies
```bash
npm init -y
npm install react react-dom
npm install -D typescript @types/chrome @types/react @types/react-dom esbuild
```

### 2. Add to package.json scripts
```json
{
  "scripts": {
    "build": "npm run build:bg && npm run build:content && npm run build:popup && npm run copy",
    "build:bg":      "esbuild background.ts --bundle --platform=browser --outfile=dist/background.js",
    "build:content": "esbuild content.ts --bundle --outfile=dist/content.js",
    "build:popup":   "esbuild popup.tsx --bundle --loader:.css=local-css --outfile=dist/popup.js",
    "copy": "cp popup.html popup.css manifest.json notification.mp3 dist/ && cp -r icons dist/",
    "watch": "npm run build:bg -- --watch & npm run build:content -- --watch & npm run build:popup -- --watch"
  }
}
```

> **CSS note**: If `--loader:.css=local-css` gives an error with your esbuild version, use `--loader:.css=css` instead, then manually copy `popup.css` to `dist/`.

### 3. Build
```bash
mkdir -p dist
npm run build
```

### 4. Load in Chrome
1. `chrome://extensions` → Enable **Developer mode**
2. **Load unpacked** → select the `dist/` folder

## Why the timer now persists

**Old problem**: The timer lived only in JS variables. When the popup closed, the service worker eventually went to sleep and the variables were gone.

**Fix**: Two changes:
1. `chrome.storage.local` stores `{ running, startedAt, totalDuration, sprintsToday, lastSprintDate }`. Time left is always *computed* from `Date.now() - startedAt`, never stored as a decrementing number.
2. `chrome.alarms.create("sprintEnd", { delayInMinutes: N })` schedules the end event via Chrome's alarm API, which survives SW sleep and fires even if the popup is closed.

## Reminder storage

Reminders are stored as a JSON array in `chrome.storage.local`. Each reminder:
- Gets its own named alarm: `reminder-<id>`
- Is marked `fired: true` after it fires
- Is auto-cleaned after 24 hours

This means reminders survive browser restarts and popup closes.