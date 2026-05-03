// ============================================================
// background.ts — Single source of truth for sprint state
// ============================================================

interface SprintState {
  running: boolean;
  timeLeft: number;       // seconds remaining
  totalDuration: number;  // seconds total
  startedAt: number | null;
}

let state: SprintState = {
  running: false,
  timeLeft: 25 * 60,
  totalDuration: 25 * 60,
  startedAt: null,
};

let tickInterval: ReturnType<typeof setInterval> | null = null;

// ── Helpers ──────────────────────────────────────────────────

function playSound() {
  // Background service workers can't play Audio directly.
  // We broadcast to all content scripts instead.
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "PLAY_SOUND" }).catch(() => {
          // Tab may not have content script — silently ignore
        });
      }
    });
  });
}

function sendNotification(title: string, message: string) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title,
    message,
  });
}

function stopTick() {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function startTick() {
  stopTick();
  tickInterval = setInterval(() => {
    if (!state.running) return;

    state.timeLeft = Math.max(
      0,
      state.totalDuration - Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000)
    );

    if (state.timeLeft === 0) {
      endSprint();
    }
  }, 1000);
}

function endSprint() {
  stopTick();
  state.running = false;
  state.startedAt = null;

  sendNotification(
    "🎉 Sprint Complete!",
    `Great work! Your ${Math.round(state.totalDuration / 60)}-minute sprint is done. Time for a break! 🧘‍♀️`
  );
  playSound();

  // Reset timeLeft to full duration for next sprint
  state.timeLeft = state.totalDuration;

  // Notify popup if open
  chrome.runtime.sendMessage({ type: "SPRINT_ENDED" }).catch(() => {});
}

// ── Single message listener ───────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type } = message;

  // --- START ---
  if (type === "START") {
    if (!state.running) {
      const durationMinutes: number = message.duration ?? 25; // default 25 min
      state.totalDuration = durationMinutes * 60;
      state.timeLeft = state.totalDuration;
      state.startedAt = Date.now();
      state.running = true;

      startTick();

      sendNotification(
        "🚀 Sprint Started!",
        `Your ${durationMinutes}-minute coding sprint has begun. Let's go!`
      );
    }
    sendResponse({ success: true, state });
    return true;
  }

  // --- STOP / RESET ---
  if (type === "STOP") {
    stopTick();
    state.running = false;
    state.startedAt = null;
    state.timeLeft = state.totalDuration;
    sendResponse({ success: true, state });
    return true;
  }

  // --- STATUS ---
  if (type === "STATUS") {
    sendResponse({ ...state });
    return true;
  }

  // --- TASK_REMINDER ---
  if (type === "TASK_REMINDER") {
    sendNotification("⏰ Task Reminder", `${message.taskName}`);
    playSound();
    sendResponse({ success: true });
    return true;
  }
});