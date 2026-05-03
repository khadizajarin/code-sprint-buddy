# ⚡ SprintBuddy — Chrome Extension

A clean, configurable coding sprint timer with break reminders.

## Features
- **Configurable durations**: 15, 25, 30, 45, or 60 minutes
- **Circular countdown ring** with live animation
- **Desktop notification + sound** when sprint ends
- **Task reminders**: set a reminder at a specific clock time
- **Dark / Light theme**

## Project Structure

```
sprint-extension/
├── manifest.json       ← Chrome extension config (MV3)
├── popup.html          ← Popup entry point
├── popup.tsx           ← React popup UI
├── popup.css           ← Styles
├── background.ts       ← Service worker (timer logic)
├── content.ts          ← Content script (audio playback)
├── notification.mp3    ← Your sound file (add manually)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Setup

### 1. Install dependencies

```bash
npm init -y
npm install react react-dom
npm install -D typescript @types/chrome @types/react @types/react-dom esbuild
```

### 2. Build script (package.json)

```json
{
  "scripts": {
    "build": "npm run build:popup && npm run build:bg && npm run build:content",
    "build:popup":   "esbuild popup.tsx   --bundle --outfile=dist/popup.js   --loader:.css=css",
    "build:bg":      "esbuild background.ts --bundle --outfile=dist/background.js --platform=browser",
    "build:content": "esbuild content.ts    --bundle --outfile=dist/content.js",
    "watch": "npm run build -- --watch"
  }
}
```

### 3. Build

```bash
npm run build
```

This outputs to `dist/`. Copy `manifest.json`, `popup.html`, `popup.css`,
`notification.mp3`, and the `icons/` folder into `dist/` as well.

### 4. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `dist/` folder

### 5. Add your sound

Drop any `notification.mp3` into the `dist/` folder.
Free sounds: [freesound.org](https://freesound.org) or [mixkit.co](https://mixkit.co/free-sound-effects/)

---

## Why one `onMessage` listener in background.ts?

Your original code registered **3 separate** `chrome.runtime.onMessage.addListener` calls
and had **two independent timer systems** (setTimeout + setInterval) that could conflict.
The rewrite uses:
- **One listener** that handles all message types with `if (type === "...")` branches
- **One timer system** (setInterval ticking every second, computing time from `Date.now() - startedAt`)
- **Computed time** instead of a decrementing variable — survives service worker restarts

## Key Architecture Decisions

| Problem | Old code | Fixed |
|---|---|---|
| Duplicate listeners | 3× `addListener` | Single listener |
| Conflicting timers | `setTimeout` + `setInterval` | Single `setInterval` |
| Audio in SW | `new Audio()` in background | Delegated to content script |
| Fixed 20-min duration | Hardcoded | Configurable via presets |
| SW restart resilience | Lost state | Recomputes from `startedAt` |