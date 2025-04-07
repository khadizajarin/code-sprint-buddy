let sprintStartTime: number | null = null;
let sprintDuration = 1 * 60 * 1000; // 20 minutes in milliseconds
let sprintTimer: number | null = null;


// function endSprint() {
//   chrome.notifications.create({
//     type: "basic",
//     iconUrl: "icons/icon48.png",
//     title: "Sprint Finished!",
//     message: "20-minute sprint complete! Time to take a break. 🧘‍♀️",
//   });

//   // Notify content script to play sound
//   chrome.tabs.query({}, (tabs) => {
//     tabs.forEach((tab) => {
//       if (tab.id) {
//         chrome.tabs.sendMessage(tab.id, { type: "PLAY_SOUND" });
//       }
//     });
//   });

  
//   sprintStartTime = null;
//   sprintTimer = null;
// }

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

      // Sound
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "PLAY_SOUND" });
          }
        });
      });
    }
    

    sendResponse({ status: "started" });
  }

  if (request.type === "STATUS") {
    if (sprintStartTime) {
      const elapsed = Date.now() - sprintStartTime;
      const timeLeft = Math.max(0, Math.floor((sprintDuration - elapsed) / 1000));
      sendResponse({ running: true, timeLeft });
    } else {
      sendResponse({ running: false, timeLeft: sprintDuration / 1000 });
    }
    return true; // Indicate async response
  }
});

function playNotificationSound() {
  chrome.windows.create({
    url: chrome.runtime.getURL("sound.html"),
    type: "popup",
    width: 1,
    height: 1,
    left: 0,
    top: 0,
    focused: false
  });
}

function endSprint() {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Sprint Finished!",
    message: "20-minute sprint complete! Time to take a break. 🧘‍♀️",
  });

  playNotificationSound(); // 👈 plays sound in a hidden popup

  sprintStartTime = null;
  sprintTimer = null;
}
