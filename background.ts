// ============================================================
// background.ts — Persistent sprint engine
// Uses chrome.storage.local + chrome.alarms so the timer
// survives popup close, SW sleep, and browser restarts.
// ============================================================

interface SprintState {
  running: boolean;
  startedAt: number | null;   // epoch ms
  totalDuration: number;       // seconds
  sprintsToday: number;
  lastSprintDate: string;      // "YYYY-MM-DD"
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export interface Reminder {
  id: string;
  taskName: string;
  targetTime: number;   // epoch ms
  fired: boolean;
}

const DEFAULT_STATE: SprintState = {
  running: false,
  startedAt: null,
  totalDuration: 25 * 60,
  sprintsToday: 0,
  lastSprintDate: "",
};

const BREAK_TIPS = [
  "👀 Look 20 feet away for 20 seconds — rest your eyes.",
  "💧 Drink a full glass of water. Your brain needs it.",
  "🧘 Take 5 deep breaths: in 4s · hold 4s · out 6s.",
  "🚶 Walk around for 5 minutes — blood flow = better code.",
  "🙆 Stretch your shoulders and neck. Release the tension.",
  "🖐️ Shake out your wrists and hands. Prevent RSI.",
  "🌿 Step outside for 2 minutes of fresh air.",
  "😌 Close your eyes and relax your face muscles.",
];

// ── Pure helpers ──────────────────────────────────────────────

const todayStr = () => new Date().toISOString().slice(0, 10);
const randomTip = () => BREAK_TIPS[Math.floor(Math.random() * BREAK_TIPS.length)];

function computeTimeLeft(state: SprintState): number {
  if (!state.running || !state.startedAt) return state.totalDuration;
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  return Math.max(0, state.totalDuration - elapsed);
}

// ── Storage helpers ───────────────────────────────────────────

const get = <T>(key: string, fallback: T): Promise<T> =>
  new Promise((res) =>
    chrome.storage.local.get(key, (d) => res(d[key] ?? fallback))
  );

const set = (key: string, val: unknown): Promise<void> =>
  new Promise((res) => chrome.storage.local.set({ [key]: val }, res));

const getState  = () => get<SprintState>("sprintState", { ...DEFAULT_STATE });
const saveState = (s: SprintState) => set("sprintState", s);

// ── Sound via content scripts ─────────────────────────────────

function playSound() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "PLAY_SOUND" }).catch(() => {});
    });
  });
}

// ── Notifications ─────────────────────────────────────────────

function notify(title: string, message: string) {
  chrome.notifications.create(`sb-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title,
    message,
    priority: 2,
  });
}

// ── End sprint ────────────────────────────────────────────────

async function endSprint() {
  const state = await getState();
  const today = todayStr();
  const sprintsToday = state.lastSprintDate === today ? state.sprintsToday + 1 : 1;

  const updated: SprintState = {
    ...state,
    running: false,
    startedAt: null,
    sprintsToday,
    lastSprintDate: today,
  };
  await saveState(updated);

  const mins = Math.round(state.totalDuration / 60);
  notify(
    `🎉 Sprint #${sprintsToday} Complete!`,
    `${mins} min done! ${randomTip()}`
  );
  playSound();
  chrome.runtime.sendMessage({ type: "SPRINT_ENDED", state: updated }).catch(() => {});
}

// ── Alarm listener (survives SW sleep) ───────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sprintEnd") {
    const state = await getState();
    if (state.running) await endSprint();
  }

  // Reminder alarms named "reminder-<id>"
  if (alarm.name.startsWith("reminder-")) {
    const id = alarm.name.replace("reminder-", "");
    const reminders = await get<Reminder[]>("reminders", []);
    const reminder = reminders.find((r) => r.id === id);
    if (reminder && !reminder.fired) {
      notify("⏰ Task Reminder", reminder.taskName);
      playSound();
      // Mark as fired
      const updated = reminders.map((r) => r.id === id ? { ...r, fired: true } : r);
      await set("reminders", updated);
      chrome.runtime.sendMessage({ type: "REMINDER_FIRED", id }).catch(() => {});
    }
  }
});

// ── Message listener ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const state = await getState();

    switch (message.type) {

      case "START": {
        if (state.running) {
          sendResponse({ success: false, reason: "already_running", state, timeLeft: computeTimeLeft(state) });
          return;
        }
        const durationMins: number = message.duration ?? 25;
        const totalDuration = durationMins * 60;
        const updated: SprintState = { ...state, running: true, startedAt: Date.now(), totalDuration };
        await saveState(updated);
        chrome.alarms.create("sprintEnd", { delayInMinutes: durationMins });
        notify("🚀 Sprint Started!", `${durationMins}-min focus sprint. You've got this!`);
        sendResponse({ success: true, state: updated, timeLeft: totalDuration });
        break;
      }

      case "STOP": {
        chrome.alarms.clear("sprintEnd");
        const updated: SprintState = { ...state, running: false, startedAt: null };
        await saveState(updated);
        sendResponse({ success: true, state: updated, timeLeft: updated.totalDuration });
        break;
      }

      case "STATUS": {
        const timeLeft = computeTimeLeft(state);
        if (state.running && timeLeft === 0) {
          await endSprint();
          const fresh = await getState();
          sendResponse({ ...fresh, timeLeft: 0 });
        } else {
          sendResponse({ ...state, timeLeft });
        }
        break;
      }

      case "SAVE_TASKS": {
        await set("tasks", message.tasks);
        sendResponse({ success: true });
        break;
      }

      case "GET_TASKS": {
        const tasks = await get<Task[]>("tasks", []);
        sendResponse({ tasks });
        break;
      }

      case "ADD_REMINDER": {
        const reminders = await get<Reminder[]>("reminders", []);
        const newReminder: Reminder = message.reminder;
        reminders.push(newReminder);
        await set("reminders", reminders);

        // Schedule alarm
        const delayMins = Math.max(0.1, (newReminder.targetTime - Date.now()) / 60000);
        chrome.alarms.create(`reminder-${newReminder.id}`, { delayInMinutes: delayMins });
        sendResponse({ success: true });
        break;
      }

      case "GET_REMINDERS": {
        const reminders = await get<Reminder[]>("reminders", []);
        // Clean up old fired reminders older than 24h
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const fresh = reminders.filter((r) => !r.fired || r.targetTime > cutoff);
        await set("reminders", fresh);
        sendResponse({ reminders: fresh });
        break;
      }

      case "DELETE_REMINDER": {
        const reminders = await get<Reminder[]>("reminders", []);
        const updated = reminders.filter((r) => r.id !== message.id);
        await set("reminders", updated);
        chrome.alarms.clear(`reminder-${message.id}`);
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, reason: "unknown_type" });
    }
  })().catch((err) => {
    console.error("[SprintBuddy BG]", err);
    sendResponse({ success: false, error: String(err) });
  });

  return true; // keep async channel open
});