// content.ts — injected into every page, plays notification sound
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "PLAY_SOUND") {
    const audio = new Audio(chrome.runtime.getURL("notification.mp3"));
    audio.volume = 0.75;
    audio.play().catch(() => {});
  }
});