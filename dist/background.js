"use strict";
(() => {
  // background.ts
  var DEFAULT_STATE = {
    running: false,
    startedAt: null,
    totalDuration: 25 * 60,
    sprintsToday: 0,
    lastSprintDate: ""
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
    if (!state.running || !state.startedAt) return state.totalDuration;
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1e3);
    return Math.max(0, state.totalDuration - elapsed);
  }
  var get = (key, fallback) => new Promise(
    (res) => chrome.storage.local.get(key, (d) => res(d[key] ?? fallback))
  );
  var set = (key, val) => new Promise((res) => chrome.storage.local.set({ [key]: val }, res));
  var getState = () => get("sprintState", { ...DEFAULT_STATE });
  var saveState = (s) => set("sprintState", s);
  function playSound() {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "PLAY_SOUND" }).catch(() => {
        });
      });
    });
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
  async function endSprint() {
    const state = await getState();
    const today = todayStr();
    const sprintsToday = state.lastSprintDate === today ? state.sprintsToday + 1 : 1;
    const updated = {
      ...state,
      running: false,
      startedAt: null,
      sprintsToday,
      lastSprintDate: today
    };
    await saveState(updated);
    const mins = Math.round(state.totalDuration / 60);
    notify(
      `\u{1F389} Sprint #${sprintsToday} Complete!`,
      `${mins} min done! ${randomTip()}`
    );
    playSound();
    chrome.runtime.sendMessage({ type: "SPRINT_ENDED", state: updated }).catch(() => {
    });
  }
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "sprintEnd") {
      const state = await getState();
      if (state.running) await endSprint();
    }
    if (alarm.name.startsWith("reminder-")) {
      const id = alarm.name.replace("reminder-", "");
      const reminders = await get("reminders", []);
      const reminder = reminders.find((r) => r.id === id);
      if (reminder && !reminder.fired) {
        notify("\u23F0 Task Reminder", reminder.taskName);
        playSound();
        const updated = reminders.map((r) => r.id === id ? { ...r, fired: true } : r);
        await set("reminders", updated);
        chrome.runtime.sendMessage({ type: "REMINDER_FIRED", id }).catch(() => {
        });
      }
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      const state = await getState();
      switch (message.type) {
        case "START": {
          if (state.running) {
            sendResponse({ success: false, reason: "already_running", state, timeLeft: computeTimeLeft(state) });
            return;
          }
          const durationMins = message.duration ?? 25;
          const totalDuration = durationMins * 60;
          const updated = { ...state, running: true, startedAt: Date.now(), totalDuration };
          await saveState(updated);
          chrome.alarms.create("sprintEnd", { delayInMinutes: durationMins });
          notify("\u{1F680} Sprint Started!", `${durationMins}-min focus sprint. You've got this!`);
          sendResponse({ success: true, state: updated, timeLeft: totalDuration });
          break;
        }
        case "STOP": {
          chrome.alarms.clear("sprintEnd");
          const updated = { ...state, running: false, startedAt: null };
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
          const tasks = await get("tasks", []);
          sendResponse({ tasks });
          break;
        }
        case "ADD_REMINDER": {
          const reminders = await get("reminders", []);
          const newReminder = message.reminder;
          reminders.push(newReminder);
          await set("reminders", reminders);
          const delayMins = Math.max(0.1, (newReminder.targetTime - Date.now()) / 6e4);
          chrome.alarms.create(`reminder-${newReminder.id}`, { delayInMinutes: delayMins });
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
    return true;
  });
})();
