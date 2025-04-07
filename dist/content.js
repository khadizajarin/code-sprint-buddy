"use strict";
(() => {
  // src/content.ts
  if (!document.getElementById("test-sound-button")) {
    const testBtn = document.createElement("button");
    testBtn.id = "test-sound-button";
    testBtn.textContent = "\u25B6\uFE0F Test Sound";
    testBtn.style.position = "fixed";
    testBtn.style.top = "20px";
    testBtn.style.right = "20px";
    testBtn.style.zIndex = "9999";
    testBtn.style.padding = "10px 20px";
    testBtn.style.background = "#4CAF50";
    testBtn.style.color = "#fff";
    testBtn.style.fontSize = "16px";
    testBtn.style.border = "none";
    testBtn.style.borderRadius = "8px";
    testBtn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
    testBtn.style.cursor = "pointer";
    testBtn.onclick = () => {
      console.log("\u{1F50A} Attempting to play sound from button...");
      const audio = new Audio(chrome.runtime.getURL("notification.mp3"));
      audio.play().then(() => {
        console.log("\u2705 Sound played!");
      }).catch((err) => {
        console.warn("\u274C Sound play error:", err);
      });
    };
    document.body.appendChild(testBtn);
    console.log("\u{1F3AF} Test sound button injected into page");
  }
})();
