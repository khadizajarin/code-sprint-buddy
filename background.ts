// ============================================================
// background.ts — SprintBuddy v3
// Clean state machine: IDLE → SPRINT → BREAK → SPRINT → ...
// Persisted via chrome.storage.local + chrome.alarms
// ============================================================

// ── State shape ───────────────────────────────────────────────

type Phase = "idle" | "sprint" | "break";

interface AppState {
  phase:           Phase;
  startedAt:       number | null;  // epoch ms when current phase began
  sprintDuration:  number;         // seconds — user-chosen sprint length
  breakDuration:   number;         // seconds — auto break length
  sprintsToday:    number;
  lastSprintDate:  string;         // "YYYY-MM-DD"
  pomodoroEnabled: boolean;
}

interface Task {
  id: string; text: string; done: boolean; createdAt: number;
}

interface Reminder {
  id: string; taskName: string; targetTime: number; fired: boolean;
}

// ── Defaults ──────────────────────────────────────────────────

const DEFAULT: AppState = {
  phase:           "idle",
  startedAt:       null,
  sprintDuration:  25 * 60,
  breakDuration:   5  * 60,
  sprintsToday:    0,
  lastSprintDate:  "",
  pomodoroEnabled: false,
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

const todayStr   = () => new Date().toISOString().slice(0, 10);
const randomTip  = () => BREAK_TIPS[Math.floor(Math.random() * BREAK_TIPS.length)];

/** Seconds remaining in current phase */
function computeTimeLeft(state: AppState): number {
  if (state.phase === "idle" || !state.startedAt) return state.sprintDuration;
  const dur = state.phase === "sprint" ? state.sprintDuration : state.breakDuration;
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  return Math.max(0, dur - elapsed);
}

// ── Storage ───────────────────────────────────────────────────

const get = <T>(key: string, fb: T): Promise<T> =>
  new Promise((res) => chrome.storage.local.get(key, (d) => res(d[key] ?? fb)));

const set = (key: string, val: unknown): Promise<void> =>
  new Promise((res) => chrome.storage.local.set({ [key]: val }, res));

const getState  = () => get<AppState>("appState", { ...DEFAULT });
const saveState = (s: AppState) => set("appState", s);

// ── Side effects ──────────────────────────────────────────────

function playSound() {
  chrome.tabs.query({}, (tabs) =>
    tabs.forEach((t) => { if (t.id) chrome.tabs.sendMessage(t.id, { type: "PLAY_SOUND" }).catch(() => {}); })
  );
}

function notify(title: string, message: string) {
  chrome.notifications.create(`sb-${Date.now()}`, {
    type: "basic", iconUrl: "icons/icon48.png",
    title, message, priority: 2,
  });
}

function broadcast(msg: object) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Phase transitions ─────────────────────────────────────────

async function sprintEnded() {
  const s = await getState();
  const today = todayStr();
  const sprintsToday = s.lastSprintDate === today ? s.sprintsToday + 1 : 1;

  if (s.pomodoroEnabled) {
    // Auto-start break
    const next: AppState = {
      ...s,
      phase: "break",
      startedAt: Date.now(),
      sprintsToday,
      lastSprintDate: today,
    };
    await saveState(next);
    chrome.alarms.create("phaseEnd", { delayInMinutes: next.breakDuration / 60 });

    const mins = Math.round(s.sprintDuration / 60);
    notify(`🎉 Sprint #${sprintsToday} done!`, `${mins}m complete! Break starts now. ${randomTip()}`);
    playSound();
    broadcast({ type: "PHASE_CHANGE", state: next, timeLeft: next.breakDuration });

  } else {
    // No pomodoro — go idle
    const next: AppState = { ...s, phase: "idle", startedAt: null, sprintsToday, lastSprintDate: today };
    await saveState(next);
    const mins = Math.round(s.sprintDuration / 60);
    notify(`🎉 Sprint #${sprintsToday} done!`, `${mins}m complete! ${randomTip()}`);
    playSound();
    broadcast({ type: "PHASE_CHANGE", state: next, timeLeft: next.sprintDuration });
  }
}

async function breakEnded() {
  const s = await getState();

  if (s.pomodoroEnabled) {
    // Auto-start next sprint
    const next: AppState = { ...s, phase: "sprint", startedAt: Date.now() };
    await saveState(next);
    chrome.alarms.create("phaseEnd", { delayInMinutes: next.sprintDuration / 60 });

    notify("🚀 Break over!", `Sprint #${s.sprintsToday + 1} starts now. Stay focused!`);
    broadcast({ type: "PHASE_CHANGE", state: next, timeLeft: next.sprintDuration });

  } else {
    // Go idle
    const next: AppState = { ...s, phase: "idle", startedAt: null };
    await saveState(next);
    notify("☀️ Break over!", "Ready for your next sprint?");
    broadcast({ type: "PHASE_CHANGE", state: next, timeLeft: next.sprintDuration });
  }
}

// ── Alarm listener ────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "phaseEnd") {
    const s = await getState();
    if (s.phase === "sprint") await sprintEnded();
    else if (s.phase === "break") await breakEnded();
  }

  if (alarm.name.startsWith("reminder-")) {
    const id = alarm.name.replace("reminder-", "");
    const reminders = await get<Reminder[]>("reminders", []);
    const r = reminders.find((r) => r.id === id);
    if (r && !r.fired) {
      notify("⏰ Task Reminder", r.taskName);
      playSound();
      await set("reminders", reminders.map((x) => x.id === id ? { ...x, fired: true } : x));
      broadcast({ type: "REMINDER_FIRED", id });
    }
  }
});

// ── Message listener ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const s = await getState();

    switch (message.type) {

      // ── Start sprint ──
      case "START": {
        if (s.phase !== "idle") {
          sendResponse({ success: false, reason: "not_idle" }); return;
        }
        const durationMins: number = message.duration ?? 25;
        const breakMins:    number = message.breakDuration ?? 5;
        const pomodoroEnabled: boolean = message.pomodoroEnabled ?? s.pomodoroEnabled;

        const next: AppState = {
          ...s,
          phase: "sprint",
          startedAt: Date.now(),
          sprintDuration: durationMins * 60,
          breakDuration:  breakMins * 60,
          pomodoroEnabled,
        };
        await saveState(next);
        chrome.alarms.create("phaseEnd", { delayInMinutes: durationMins });
        notify("🚀 Sprint started!", `${durationMins}m focus sprint. You've got this!`);
        sendResponse({ success: true, state: next, timeLeft: next.sprintDuration });
        break;
      }

      // ── Skip break (go straight to next sprint) ──
      case "SKIP_BREAK": {
        if (s.phase !== "break") {
          sendResponse({ success: false, reason: "not_in_break" }); return;
        }
        chrome.alarms.clear("phaseEnd");
        const next: AppState = { ...s, phase: "sprint", startedAt: Date.now() };
        await saveState(next);
        chrome.alarms.create("phaseEnd", { delayInMinutes: next.sprintDuration / 60 });
        notify("🚀 Break skipped!", "Next sprint started. Focus up!");
        sendResponse({ success: true, state: next, timeLeft: next.sprintDuration });
        break;
      }

      // ── Stop everything → idle ──
      case "STOP": {
        chrome.alarms.clear("phaseEnd");
        const next: AppState = { ...s, phase: "idle", startedAt: null };
        await saveState(next);
        sendResponse({ success: true, state: next, timeLeft: next.sprintDuration });
        break;
      }

      // ── Status (popup polls this every second) ──
      case "STATUS": {
        const timeLeft = computeTimeLeft(s);
        // Safety net: alarm missed
        if (timeLeft === 0 && s.phase !== "idle") {
          if (s.phase === "sprint") await sprintEnded();
          else await breakEnded();
          const fresh = await getState();
          sendResponse({ ...fresh, timeLeft: computeTimeLeft(fresh) });
        } else {
          sendResponse({ ...s, timeLeft });
        }
        break;
      }

      // ── Pomodoro toggle ──
      case "SET_POMODORO": {
        const next: AppState = { ...s, pomodoroEnabled: message.enabled };
        await saveState(next);
        sendResponse({ success: true, state: next });
        break;
      }

      // ── Tasks ──
      case "SAVE_TASKS": {
        await set("tasks", message.tasks);
        sendResponse({ success: true });
        break;
      }
      case "GET_TASKS": {
        sendResponse({ tasks: await get<Task[]>("tasks", []) });
        break;
      }

      // ── Reminders ──
      case "ADD_REMINDER": {
        const reminders = await get<Reminder[]>("reminders", []);
        reminders.push(message.reminder);
        await set("reminders", reminders);
        const delayMins = Math.max(0.1, (message.reminder.targetTime - Date.now()) / 60000);
        chrome.alarms.create(`reminder-${message.reminder.id}`, { delayInMinutes: delayMins });
        sendResponse({ success: true });
        break;
      }
      case "GET_REMINDERS": {
        const reminders = await get<Reminder[]>("reminders", []);
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const fresh = reminders.filter((r) => !r.fired || r.targetTime > cutoff);
        await set("reminders", fresh);
        sendResponse({ reminders: fresh });
        break;
      }
      case "DELETE_REMINDER": {
        const reminders = await get<Reminder[]>("reminders", []);
        await set("reminders", reminders.filter((r) => r.id !== message.id));
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

  return true;
});