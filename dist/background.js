"use strict";
(() => {
  // background.ts
  var DEFAULT = {
    phase: "idle",
    startedAt: null,
    sprintDuration: 25 * 60,
    breakDuration: 5 * 60,
    sprintsToday: 0,
    lastSprintDate: "",
    pomodoroEnabled: false
  };
  var BREAK_TIPS = [
    "\u{1F440} Look 20 feet away for 20 seconds \u2014 rest your eyes.",
    "\u{1F4A7} Drink a full glass of water. Your brain needs it.",
    "\u{1F9D8} Take 5 deep breaths: in 4s \xB7 hold 4s \xB7 out 6s.",
    "\u{1F6B6} Walk around for 5 minutes \u2014 blood flow = better code.",
    "\u{1F646} Stretch your shoulders and neck. Release the tension.",
    "\u{1F590}\uFE0F Shake out your wrists and hands. Prevent RSI.",
    "\u{1F33F} Step outside for 2 minutes of fresh air.",
    "\u{1F60C} Close your eyes and relax your face muscles."
  ];
  var todayStr = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  var randomTip = () => BREAK_TIPS[Math.floor(Math.random() * BREAK_TIPS.length)];
  function computeTimeLeft(state) {
    if (state.phase === "idle" || !state.startedAt) return state.sprintDuration;
    const dur = state.phase === "sprint" ? state.sprintDuration : state.breakDuration;
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1e3);
    return Math.max(0, dur - elapsed);
  }
  var get = (key, fb) => new Promise((res) => chrome.storage.local.get(key, (d) => res(d[key] ?? fb)));
  var set = (key, val) => new Promise((res) => chrome.storage.local.set({ [key]: val }, res));
  var getState = () => get("appState", { ...DEFAULT });
  var saveState = (s) => set("appState", s);
  function playSound() {
    chrome.tabs.query(
      {},
      (tabs) => tabs.forEach((t) => {
        if (t.id) chrome.tabs.sendMessage(t.id, { type: "PLAY_SOUND" }).catch(() => {
        });
      })
    );
  }
  function notify(title, message) {
    chrome.notifications.create(`sb-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon48.png",
      title,
      message,
      priority: 2
    });
  }
  function broadcast(msg) {
    chrome.runtime.sendMessage(msg).catch(() => {
    });
  }
  async function sprintEnded() {
    const s = await getState();
    const today = todayStr();
    const sprintsToday = s.lastSprintDate === today ? s.sprintsToday + 1 : 1;
    if (s.pomodoroEnabled) {
      const next = {
        ...s,
        phase: "break",
        startedAt: Date.now(),
        sprintsToday,
        lastSprintDate: today
      };
      await saveState(next);
      chrome.alarms.create("phaseEnd", { delayInMinutes: next.breakDuration / 60 });
      const mins = Math.round(s.sprintDuration / 60);
      notify(`\u{1F389} Sprint #${sprintsToday} done!`, `${mins}m complete! Break starts now. ${randomTip()}`);
      playSound();
      broadcast({ type: "PHASE_CHANGE", state: next, timeLeft: next.breakDuration });
    } else {
      const next = { ...s, phase: "idle", startedAt: null, sprintsToday, lastSprintDate: today };
      await saveState(next);
      const mins = Math.round(s.sprintDuration / 60);
      notify(`\u{1F389} Sprint #${sprintsToday} done!`, `${mins}m complete! ${randomTip()}`);
      playSound();
      broadcast({ type: "PHASE_CHANGE", state: next, timeLeft: next.sprintDuration });
    }
  }
  async function breakEnded() {
    const s = await getState();
    if (s.pomodoroEnabled) {
      const next = { ...s, phase: "sprint", startedAt: Date.now() };
      await saveState(next);
      chrome.alarms.create("phaseEnd", { delayInMinutes: next.sprintDuration / 60 });
      notify("\u{1F680} Break over!", `Sprint #${s.sprintsToday + 1} starts now. Stay focused!`);
      broadcast({ type: "PHASE_CHANGE", state: next, timeLeft: next.sprintDuration });
    } else {
      const next = { ...s, phase: "idle", startedAt: null };
      await saveState(next);
      notify("\u2600\uFE0F Break over!", "Ready for your next sprint?");
      broadcast({ type: "PHASE_CHANGE", state: next, timeLeft: next.sprintDuration });
    }
  }
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "phaseEnd") {
      const s = await getState();
      if (s.phase === "sprint") await sprintEnded();
      else if (s.phase === "break") await breakEnded();
    }
    if (alarm.name.startsWith("reminder-")) {
      const id = alarm.name.replace("reminder-", "");
      const reminders = await get("reminders", []);
      const r = reminders.find((r2) => r2.id === id);
      if (r && !r.fired) {
        notify("\u23F0 Task Reminder", r.taskName);
        playSound();
        await set("reminders", reminders.map((x) => x.id === id ? { ...x, fired: true } : x));
        broadcast({ type: "REMINDER_FIRED", id });
      }
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      const s = await getState();
      switch (message.type) {
        // ── Start sprint ──
        case "START": {
          if (s.phase !== "idle") {
            sendResponse({ success: false, reason: "not_idle" });
            return;
          }
          const durationMins = message.duration ?? 25;
          const breakMins = message.breakDuration ?? 5;
          const pomodoroEnabled = message.pomodoroEnabled ?? s.pomodoroEnabled;
          const next = {
            ...s,
            phase: "sprint",
            startedAt: Date.now(),
            sprintDuration: durationMins * 60,
            breakDuration: breakMins * 60,
            pomodoroEnabled
          };
          await saveState(next);
          chrome.alarms.create("phaseEnd", { delayInMinutes: durationMins });
          notify("\u{1F680} Sprint started!", `${durationMins}m focus sprint. You've got this!`);
          sendResponse({ success: true, state: next, timeLeft: next.sprintDuration });
          break;
        }
        // ── Skip break (go straight to next sprint) ──
        case "SKIP_BREAK": {
          if (s.phase !== "break") {
            sendResponse({ success: false, reason: "not_in_break" });
            return;
          }
          chrome.alarms.clear("phaseEnd");
          const next = { ...s, phase: "sprint", startedAt: Date.now() };
          await saveState(next);
          chrome.alarms.create("phaseEnd", { delayInMinutes: next.sprintDuration / 60 });
          notify("\u{1F680} Break skipped!", "Next sprint started. Focus up!");
          sendResponse({ success: true, state: next, timeLeft: next.sprintDuration });
          break;
        }
        // ── Stop everything → idle ──
        case "STOP": {
          chrome.alarms.clear("phaseEnd");
          const next = { ...s, phase: "idle", startedAt: null };
          await saveState(next);
          sendResponse({ success: true, state: next, timeLeft: next.sprintDuration });
          break;
        }
        // ── Status (popup polls this every second) ──
        case "STATUS": {
          const timeLeft = computeTimeLeft(s);
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
          const next = { ...s, pomodoroEnabled: message.enabled };
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
          sendResponse({ tasks: await get("tasks", []) });
          break;
        }
        // ── Reminders ──
        case "ADD_REMINDER": {
          const reminders = await get("reminders", []);
          reminders.push(message.reminder);
          await set("reminders", reminders);
          const delayMins = Math.max(0.1, (message.reminder.targetTime - Date.now()) / 6e4);
          chrome.alarms.create(`reminder-${message.reminder.id}`, { delayInMinutes: delayMins });
          sendResponse({ success: true });
          break;
        }
        case "GET_REMINDERS": {
          const reminders = await get("reminders", []);
          const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
          const fresh = reminders.filter((r) => !r.fired || r.targetTime > cutoff);
          await set("reminders", fresh);
          sendResponse({ reminders: fresh });
          break;
        }
        case "DELETE_REMINDER": {
          const reminders = await get("reminders", []);
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
})();
