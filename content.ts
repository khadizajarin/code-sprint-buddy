// ============================================================
// content.ts — Injected into every page; handles audio playback
// ============================================================

// Only register the listener once per page load
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "PLAY_SOUND") {
    const audio = new Audio(chrome.runtime.getURL("notification.mp3"));
    audio.volume = 0.8;
    audio.play().catch((err) => console.warn("[SprintBuddy] Audio play failed:", err));
  }
});