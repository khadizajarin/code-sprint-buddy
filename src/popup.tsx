import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./../public/popup.css";

const Popup = () => {
  const [timeLeft, setTimeLeft] = useState(1 * 60);
  const [running, setRunning] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

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

  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

  return (
    <div className={`popup-container ${theme}`}>
      <h1>⏱️ Code Sprint Buddy</h1>
      <p className="timer">{formatTime(timeLeft)}</p>
      <button onClick={handleStartPause} className="start-btn">
        {running ? "Running..." : "Start Sprint"}
      </button>
      <button
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        className="theme-toggle"
      >
        {theme === "light" ? "🌙 Dark Mode" : "☀️ Light Mode"}
      </button>
    </div>
  );
};

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<Popup />);
