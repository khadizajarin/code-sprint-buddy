"use strict";
(() => {
  // background.ts
  var state = {
    running: false,
    timeLeft: 25 * 60,
    totalDuration: 25 * 60,
    startedAt: null
  };
  var tickInterval = null;
  function playSound() {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "PLAY_SOUND" }).catch(() => {
          });
        }
      });
    });
  }
  function sendNotification(title, message) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title,
      message
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
        state.totalDuration - Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1e3)
      );
      if (state.timeLeft === 0) {
        endSprint();
      }
    }, 1e3);
  }
  function endSprint() {
    stopTick();
    state.running = false;
    state.startedAt = null;
    sendNotification(
      "\u{1F389} Sprint Complete!",
      `Great work! Your ${Math.round(state.totalDuration / 60)}-minute sprint is done. Time for a break! \u{1F9D8}\u200D\u2640\uFE0F`
    );
    playSound();
    state.timeLeft = state.totalDuration;
    chrome.runtime.sendMessage({ type: "SPRINT_ENDED" }).catch(() => {
    });
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const { type } = message;
    if (type === "START") {
      if (!state.running) {
        const durationMinutes = message.duration ?? 25;
        state.totalDuration = durationMinutes * 60;
        state.timeLeft = state.totalDuration;
        state.startedAt = Date.now();
        state.running = true;
        startTick();
        sendNotification(
          "\u{1F680} Sprint Started!",
          `Your ${durationMinutes}-minute coding sprint has begun. Let's go!`
        );
      }
      sendResponse({ success: true, state });
      return true;
    }
    if (type === "STOP") {
      stopTick();
      state.running = false;
      state.startedAt = null;
      state.timeLeft = state.totalDuration;
      sendResponse({ success: true, state });
      return true;
    }
    if (type === "STATUS") {
      sendResponse({ ...state });
      return true;
    }
    if (type === "TASK_REMINDER") {
      sendNotification("\u23F0 Task Reminder", `${message.taskName}`);
      playSound();
      sendResponse({ success: true });
      return true;
    }
  });
})();
