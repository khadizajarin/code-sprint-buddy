// ============================================================
// popup.tsx — Sprint timer popup UI
// ============================================================

import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";

// ── Types ────────────────────────────────────────────────────

interface SprintState {
  running: boolean;
  timeLeft: number;
  totalDuration: number;
}

// ── Preset durations ─────────────────────────────────────────

const PRESETS = [
  { label: "15 min", value: 15 },
  { label: "25 min", value: 25 },
  { label: "30 min", value: 30 },
  { label: "45 min", value: 45 },
  { label: "60 min", value: 60 },
];

// ── Helpers ──────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function parseTimeInput(raw: string): Date | null {
  const now = new Date();
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const period = match[3]?.toLowerCase();

  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;

  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);
  if (result <= now) result.setDate(result.getDate() + 1);
  return result;
}

// ── Circular Progress ─────────────────────────────────────────

function CircularProgress({ pct, timeLeft, running }: { pct: number; timeLeft: number; running: boolean }) {
  const R = 80;
  const circ = 2 * Math.PI * R;
  const dash = circ * (1 - pct);

  return (
    <div className="timer-ring-wrap">
      <svg width="200" height="200" viewBox="0 0 200 200">
        {/* Track */}
        <circle cx="100" cy="100" r={R} fill="none" strokeWidth="10" className="ring-track" />
        {/* Progress */}
        <circle
          cx="100" cy="100" r={R}
          fill="none" strokeWidth="10"
          className={`ring-progress ${running ? "ring-active" : ""}`}
          strokeDasharray={circ}
          strokeDashoffset={dash}
          strokeLinecap="round"
          transform="rotate(-90 100 100)"
        />
      </svg>
      <div className="timer-display">
        <span className="timer-digits">{formatTime(timeLeft)}</span>
        <span className="timer-label">{running ? "in sprint" : "ready"}</span>
      </div>
    </div>
  );
}

// ── Main Popup ────────────────────────────────────────────────

const Popup: React.FC = () => {
  // Sprint state synced from background
  const [sprint, setSprint] = useState<SprintState>({
    running: false,
    timeLeft: 25 * 60,
    totalDuration: 25 * 60,
  });

  // Selected duration (before start)
  const [selectedDuration, setSelectedDuration] = useState(25);

  // Reminder
  const [taskName, setTaskName] = useState("");
  const [taskTime, setTaskTime] = useState("");
  const [reminderPending, setReminderPending] = useState(false);
  const [reminderMsg, setReminderMsg] = useState("");

  // UI
  const [tab, setTab] = useState<"sprint" | "reminder">("sprint");
  const [theme, setTheme] = useState(() => localStorage.getItem("sb-theme") || "dark");
  const [currentTime, setCurrentTime] = useState("");

  // ── Effects ─────────────────────────────────────────────────

  useEffect(() => {
    localStorage.setItem("sb-theme", theme);
  }, [theme]);

  useEffect(() => {
    const tick = () => setCurrentTime(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Poll background every second for live countdown
    const id = setInterval(() => {
      chrome.runtime.sendMessage({ type: "STATUS" }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res) setSprint(res);
      });
    }, 1000);

    // Listen for sprint end event
    const handler = (msg: { type: string }) => {
      if (msg.type === "SPRINT_ENDED") {
        setSprint((s) => ({ ...s, running: false, timeLeft: s.totalDuration }));
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    return () => {
      clearInterval(id);
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, []);

  // ── Actions ──────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    chrome.runtime.sendMessage({ type: "START", duration: selectedDuration }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.state) setSprint(res.state);
    });
  }, [selectedDuration]);

  const handleStop = useCallback(() => {
    chrome.runtime.sendMessage({ type: "STOP" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.state) setSprint(res.state);
    });
  }, []);

  const handleSetReminder = useCallback(() => {
    if (!taskName.trim() || !taskTime.trim()) {
      setReminderMsg("Please enter both a task and a time.");
      return;
    }
    const target = parseTimeInput(taskTime);
    if (!target) {
      setReminderMsg("Invalid time — try '4pm' or '13:30'.");
      return;
    }

    const delay = target.getTime() - Date.now();
    setReminderPending(true);
    setReminderMsg(`Reminder set for ${target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);

    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "TASK_REMINDER", taskName });
      setReminderPending(false);
      setReminderMsg("Reminder fired! ✅");
      setTimeout(() => setReminderMsg(""), 3000);
    }, delay);
  }, [taskName, taskTime]);

  // ── Derived ──────────────────────────────────────────────────

  const pct = sprint.totalDuration > 0 ? 1 - sprint.timeLeft / sprint.totalDuration : 1;

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className={`popup ${theme}`}>
      {/* Header */}
      <header className="popup-header">
        <span className="popup-logo">⚡ SprintBuddy</span>
        <div className="header-right">
          <span className="clock">{currentTime}</span>
          <button
            className="theme-btn"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            title="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tabs">
        <button className={`tab ${tab === "sprint" ? "active" : ""}`} onClick={() => setTab("sprint")}>
          Sprint
        </button>
        <button className={`tab ${tab === "reminder" ? "active" : ""}`} onClick={() => setTab("reminder")}>
          Reminder
        </button>
      </nav>

      {/* Sprint Tab */}
      {tab === "sprint" && (
        <section className="sprint-section">
          <CircularProgress pct={pct} timeLeft={sprint.timeLeft} running={sprint.running} />

          {/* Duration presets — only when not running */}
          {!sprint.running && (
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={`preset-btn ${selectedDuration === p.value ? "selected" : ""}`}
                  onClick={() => setSelectedDuration(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {sprint.running && (
            <p className="sprint-info">
              {Math.round(sprint.totalDuration / 60)}-min sprint · stay focused 🎯
            </p>
          )}

          <div className="sprint-actions">
            {!sprint.running ? (
              <button className="btn btn-start" onClick={handleStart}>
                ▶ Start Sprint
              </button>
            ) : (
              <button className="btn btn-stop" onClick={handleStop}>
                ■ Stop
              </button>
            )}
          </div>
        </section>
      )}

      {/* Reminder Tab */}
      {tab === "reminder" && (
        <section className="reminder-section">
          <p className="section-hint">Get a notification + sound at a specific time.</p>

          <label className="field-label">Task name</label>
          <input
            className="field-input"
            type="text"
            placeholder="e.g. Review PR #42"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            disabled={reminderPending}
          />

          <label className="field-label">Remind me at</label>
          <input
            className="field-input"
            type="text"
            placeholder="e.g. 4pm  or  13:30"
            value={taskTime}
            onChange={(e) => setTaskTime(e.target.value)}
            disabled={reminderPending}
          />

          <button
            className={`btn ${reminderPending ? "btn-pending" : "btn-start"}`}
            onClick={handleSetReminder}
            disabled={reminderPending}
          >
            {reminderPending ? "⏳ Reminder Pending…" : "Set Reminder"}
          </button>

          {reminderMsg && <p className="reminder-msg">{reminderMsg}</p>}
        </section>
      )}
    </div>
  );
};

// ── Mount ────────────────────────────────────────────────────

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<Popup />);