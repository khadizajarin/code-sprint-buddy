let sprintStartTime: number | null = null;
let sprintDuration = 1 * 60 * 1000; // 1 minute for testing
let sprintTimer: number | null = null;

// ✅ Function to play sound directly in background
const playSound = () => {
  const audio = new Audio(chrome.runtime.getURL("notification.mp3"));
  audio.play().catch((err) => {
    console.warn("Failed to play audio in background:", err);
  });
};

function endSprint() {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Sprint Finished!",
    message: "20-minute sprint complete! Time to take a break. 🧘‍♀️",
  });

  // ✅ Play sound directly
  playSound();

  // Optional: Notify popup if it's open
  chrome.runtime.sendMessage({ type: "SPRINT_ENDED" });

  sprintStartTime = null;
  sprintTimer = null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "START") {
    if (!sprintStartTime) {
      sprintStartTime = Date.now();

      sprintTimer = setTimeout(() => {
        endSprint();
      }, sprintDuration);

      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Sprint Started!",
        message: "Your 20-minute coding sprint has begun. Let’s go! 🚀",
      });

      sendResponse({ status: "started" });
    }
  }

  if (request.type === "STATUS") {
    if (sprintStartTime) {
      const elapsed = Date.now() - sprintStartTime;
      const timeLeft = Math.max(0, Math.floor((sprintDuration - elapsed) / 1000));
      sendResponse({ running: true, timeLeft });
    } else {
      sendResponse({ running: false, timeLeft: sprintDuration / 1000 });
    }
    return true; // keep message channel open
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PLAY_SOUND") {
    const audio = new Audio(chrome.runtime.getURL("notification.mp3"));
    audio.play().catch((err) => console.warn("Audio play failed:", err));
  }
});
