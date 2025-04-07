import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./../public/popup.css";

const Popup = () => {
  const [taskName, setTaskName] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [reminderSet, setReminderSet] = useState(false);
  //const [timeLeft, setTimeLeft] = useState<number | ''>('');
  const [timeLeft, setTimeLeft] = useState(1 * 60);
  const [running, setRunning] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [currentTime, setCurrentTime] = useState<string>(""); // Local time state
  //const [taskTime, setTaskTime] = useState<number | "">(""); // Custom task time
  const [taskReminder, setTaskReminder] = useState<number | null>(null); // To store the reminder time

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    // Update the local time every second
    const interval = setInterval(() => {
      const currentTime = new Date().toLocaleTimeString();
      setCurrentTime(currentTime);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Handle the task reminder
    if (taskReminder !== null) {
      const reminderTimeout = setTimeout(() => {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon48.png",
          title: "Task Reminder",
          message: `Reminder: Your task is due! ⏰`,
        });

        chrome.runtime.sendMessage({ type: "PLAY_SOUND" }); // Play sound when task reminder triggers
        setTaskReminder(null); // Reset the task reminder
      }, taskReminder * 60 * 1000); // Convert minutes to milliseconds

      return () => clearTimeout(reminderTimeout);
    }
  }, [taskReminder]);

  useEffect(() => {
    const interval = setInterval(() => {
      chrome.runtime.sendMessage({ type: "STATUS" }, (response) => {
        if (response) {
          setRunning(response.running);
          setTimeLeft(response.timeLeft);
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleStartPause = () => {
    if (!running) {
      chrome.runtime.sendMessage({ type: "START" }, () => {
        setRunning(true);
      });
    }
  };

  // Function to handle the time input (format: 4pm, 13:00, etc.)
  const handleSetReminder = () => {
    if (!taskName || !taskTime) {
      alert("Please enter a task and time.");
      return;
    }

    // Parse the time input (assuming "4pm", "13:00", etc.)
    let reminderDate = new Date();
    let timeParts = taskTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);

    if (timeParts) {
      let hours = parseInt(timeParts[1]);
      const minutes = timeParts[2] ? parseInt(timeParts[2]) : 0;
      const period = timeParts[3];

      // Convert time to 24-hour format if necessary (handling AM/PM)
      if (period && period.toLowerCase() === 'pm' && hours < 12) {
        hours += 12;
      } else if (period && period.toLowerCase() === 'am' && hours === 12) {
        hours = 0;
      }

      reminderDate.setHours(hours, minutes, 0, 0);

      // Check if reminder time is in the future; if not, set it for the next day
      if (reminderDate <= new Date()) {
        reminderDate.setDate(reminderDate.getDate() + 1); // Set for the next day
      }

      const timeDifference = reminderDate.getTime() - Date.now();
      setTimeLeft(timeDifference);

      // Set reminder alert (you can also send a notification)
      setReminderSet(true);

      // Simulate an alert at the reminder time (you can improve this with a background script if necessary)
      setTimeout(() => {
        alert(`Reminder: ${taskName} at ${taskTime}!`);
        setReminderSet(false); // Reset reminder state after the alert
      }, timeDifference);
    } else {
      alert("Invalid time format. Please use formats like '4pm' or '13:00'.");
    }
  };


  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

  return (
    <div className={`popup-container ${theme}`}>
      <h1>⏱️ Code Sprint Buddy</h1>
      <p className="timer">{formatTime(timeLeft)}</p>
      <p className="current-time">Current Time: {currentTime}</p>
      <button onClick={handleStartPause} className="start-btn">
        {running ? "Running..." : "Start Sprint"}
      </button>
      <button
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        className="theme-toggle"
      >
        {theme === "light" ? "🌙 Dark Mode" : "☀️ Light Mode"}
      </button>

      <div className="container">
      <h1>Task Reminder</h1>
      <div>
        <input
          type="text"
          placeholder="Enter task name"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
        />
      </div>
      <div>
        <input
          type="text"
          placeholder="Enter reminder time (e.g., 4pm, 13:00)"
          value={taskTime}
          onChange={(e) => setTaskTime(e.target.value)}
        />
      </div>
      <button onClick={handleSetReminder} disabled={reminderSet}>
        {reminderSet ? `Reminder Set for ${taskTime}` : 'Set Reminder'}
      </button>
      {timeLeft && <p>Time left: {Math.floor(timeLeft / 1000)} seconds</p>}
    </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<Popup />);
