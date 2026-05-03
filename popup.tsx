// ============================================================
// popup.tsx — SprintBuddy full UI
// Tabs: Sprint · Tasks · Reminders
// ============================================================

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";

// ── Types ─────────────────────────────────────────────────────

interface SprintState {
  running: boolean;
  startedAt: number | null;
  totalDuration: number;
  sprintsToday: number;
  lastSprintDate: string;
}

interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

interface Reminder {
  id: string;
  taskName: string;
  targetTime: number;
  fired: boolean;
}

type Tab = "sprint" | "tasks" | "reminders";

// ── Presets ───────────────────────────────────────────────────

const PRESETS = [
  { label: "1m", value: 1 },
  { label: "5m", value: 5 },
  { label: "10m", value: 10 },
  // { label: "15m", value: 15 },
  // { label: "25m", value: 25 },
  // { label: "30m", value: 30 },
  // { label: "45m", value: 45 },
  // { label: "60m", value: 60 },
];

// ── Helpers ───────────────────────────────────────────────────

const fmt = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

const uid = () => Math.random().toString(36).slice(2, 10);

const todayStr = () => new Date().toISOString().slice(0, 10);

function parseTimeInput(raw: string): Date | null {
  const now = new Date();
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  const p = m[3]?.toLowerCase();
  if (p === "pm" && h < 12) h += 12;
  if (p === "am" && h === 12) h = 0;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

function msg<T = any>(type: string, extra = {}): Promise<T> {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage({ type, ...extra }, (r) => {
      if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
      else res(r);
    });
  });
}


function Ring({ pct, timeLeft, running }: { pct: number; timeLeft: number; running: boolean }) {
  const R = 76;
  const circ = 2 * Math.PI * R;
  const offset = circ * (1 - Math.min(1, pct));
  return (
    <div className="ring-wrap">
      <svg width="190" height="190" viewBox="0 0 190 190">
        <circle cx="95" cy="95" r={R} fill="none" strokeWidth="8" className="ring-bg" />
        <circle
          cx="95" cy="95" r={R}
          fill="none" strokeWidth="8"
          className={`ring-fg ${running ? "ring-glow" : ""}`}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 95 95)"
        />
      </svg>
      <div className="ring-inner">
        <span className="ring-time">{fmt(timeLeft)}</span>
        <span className="ring-status">{running ? "focusing" : "ready"}</span>
      </div>
    </div>
  );
}


const Popup: React.FC = () => {
  // Sprint
  const [sprint, setSprint] = useState<SprintState>({
    running: false, startedAt: null, totalDuration: 25 * 60,
    sprintsToday: 0, lastSprintDate: "",
  });
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [selectedDuration, setSelectedDuration] = useState(25);

  // Tasks
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");

  // Reminders
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [reminderName, setReminderName] = useState("");
  const [reminderTime, setReminderTime] = useState("");
  const [reminderError, setReminderError] = useState("");

  // UI
  const [tab, setTab] = useState<Tab>("sprint");
  const [theme, setTheme] = useState(() => localStorage.getItem("sb-theme") || "dark");
  const [clock, setClock] = useState("");
  const [toast, setToast] = useState("");

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Toast ─────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  }

  // ── Theme ─────────────────────────────────────────────────────

  useEffect(() => { localStorage.setItem("sb-theme", theme); }, [theme]);

  // ── Clock ─────────────────────────────────────────────────────

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Sprint polling (persisted state) ─────────────────────────

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await msg<SprintState & { timeLeft: number }>("STATUS");
        setSprint(res);
        setTimeLeft(res.timeLeft);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 1000);

    const handler = (m: any) => {
      if (m.type === "SPRINT_ENDED") {
        setSprint(m.state);
        setTimeLeft(m.state.totalDuration);
        showToast("Sprint complete! Time for a break 🧘");
      }
      if (m.type === "REMINDER_FIRED") {
        loadReminders();
        showToast("⏰ Reminder fired!");
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => { clearInterval(id); chrome.runtime.onMessage.removeListener(handler); };
  }, []);

  // ── Load tasks ────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    try {
      const res = await msg<{ tasks: Task[] }>("GET_TASKS");
      // Reset done tasks if it's a new day
      const today = todayStr();
      const fresh = res.tasks.map((t) =>
        t.done && new Date(t.createdAt).toISOString().slice(0, 10) !== today
          ? { ...t, done: false } : t
      );
      setTasks(fresh);
    } catch {}
  }, []);

  const loadReminders = useCallback(async () => {
    try {
      const res = await msg<{ reminders: Reminder[] }>("GET_REMINDERS");
      setReminders(res.reminders);
    } catch {}
  }, []);

  useEffect(() => { loadTasks(); loadReminders(); }, []);

  // ── Sprint actions ────────────────────────────────────────────

  const handleStart = async () => {
    try {
      const res = await msg("START", { duration: selectedDuration });
      if (res.state) { setSprint(res.state); setTimeLeft(res.timeLeft); }
    } catch {}
  };

  const handleStop = async () => {
    try {
      const res = await msg("STOP");
      if (res.state) { setSprint(res.state); setTimeLeft(res.state.totalDuration); }
    } catch {}
  };

  // ── Task actions ──────────────────────────────────────────────

  const addTask = async () => {
    const text = newTask.trim();
    if (!text) return;
    const task: Task = { id: uid(), text, done: false, createdAt: Date.now() };
    const updated = [task, ...tasks];
    setTasks(updated);
    setNewTask("");
    await msg("SAVE_TASKS", { tasks: updated });
  };

  const toggleTask = async (id: string) => {
    const updated = tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated);
    await msg("SAVE_TASKS", { tasks: updated });
  };

  const deleteTask = async (id: string) => {
    const updated = tasks.filter((t) => t.id !== id);
    setTasks(updated);
    await msg("SAVE_TASKS", { tasks: updated });
  };

  // ── Reminder actions ──────────────────────────────────────────

  const addReminder = async () => {
    setReminderError("");
    if (!reminderName.trim()) { setReminderError("Enter a task name."); return; }
    const target = parseTimeInput(reminderTime);
    if (!target) { setReminderError("Use formats like '4pm' or '13:30'."); return; }

    const reminder: Reminder = {
      id: uid(),
      taskName: reminderName.trim(),
      targetTime: target.getTime(),
      fired: false,
    };
    await msg("ADD_REMINDER", { reminder });
    setReminders((r) => [...r, reminder]);
    setReminderName("");
    setReminderTime("");
    showToast(`Reminder set for ${target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ✅`);
  };

  const deleteReminder = async (id: string) => {
    await msg("DELETE_REMINDER", { id });
    setReminders((r) => r.filter((x) => x.id !== id));
  };

  // ── Derived ───────────────────────────────────────────────────

  const pct = sprint.totalDuration > 0 ? 1 - timeLeft / sprint.totalDuration : 0;
  const doneTasks = tasks.filter((t) => t.done).length;
  const streakToday = sprint.lastSprintDate === todayStr() ? sprint.sprintsToday : 0;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className={`app ${theme}`}>

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Header */}
      <header className="hdr">
        <div className="hdr-left">
          <span className="logo">⚡ SprintBuddy</span>
          <span className="clock">{clock}</span>
        </div>
        <button className="icon-btn" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} title="Toggle theme">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </header>

      {/* Streak bar */}
      <div className="streak-bar">
        <span className="streak-label">Today's sprints</span>
        <div className="streak-dots">
          {[1,2,3,4,5,6,7,8].map((n) => (
            <span key={n} className={`dot ${n <= streakToday ? "dot-on" : ""}`} />
          ))}
        </div>
        <span className="streak-count">{streakToday} done</span>
      </div>

      {/* Tabs */}
      <nav className="tabs">
        {(["sprint","tasks","reminders"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {t === "sprint" ? "⏱ Sprint" : t === "tasks" ? `✅ Tasks${tasks.length ? ` ${doneTasks}/${tasks.length}` : ""}` : "🔔 Reminders"}
          </button>
        ))}
      </nav>

      {/* ── Sprint Tab ── */}
      {tab === "sprint" && (
        <section className="section">
          <Ring pct={pct} timeLeft={timeLeft} running={sprint.running} />

          {!sprint.running && (
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={`chip ${selectedDuration === p.value ? "chip-active" : ""}`}
                  onClick={() => setSelectedDuration(p.value)}
                >{p.label}</button>
              ))}
            </div>
          )}

          {sprint.running && (
            <p className="hint">
              {Math.round(sprint.totalDuration / 60)}m sprint · sprint #{streakToday} today 🔥
            </p>
          )}

          <div className="actions">
            {!sprint.running
              ? <button className="btn btn-green" onClick={handleStart}>▶ Start {selectedDuration}m Sprint</button>
              : <button className="btn btn-red" onClick={handleStop}>■ Stop Sprint</button>
            }
          </div>
        </section>
      )}

      {/* ── Tasks Tab ── */}
      {tab === "tasks" && (
        <section className="section">
          <p className="hint">Your focus list for today. Check off as you go.</p>

          <div className="input-row">
            <input
              className="field"
              placeholder="Add a task…"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
            />
            <button className="add-btn" onClick={addTask}>+</button>
          </div>

          <ul className="task-list">
            {tasks.length === 0 && (
              <li className="empty">No tasks yet. Add one above ↑</li>
            )}
            {tasks.map((t) => (
              <li key={t.id} className={`task-item ${t.done ? "task-done" : ""}`}>
                <button className="check-btn" onClick={() => toggleTask(t.id)}>
                  {t.done ? "✅" : "⬜"}
                </button>
                <span className="task-text">{t.text}</span>
                <button className="del-btn" onClick={() => deleteTask(t.id)}>✕</button>
              </li>
            ))}
          </ul>

          {tasks.length > 0 && (
            <p className="hint" style={{ textAlign: "center", marginTop: 8 }}>
              {doneTasks}/{tasks.length} complete
              {doneTasks === tasks.length && tasks.length > 0 ? " 🎉 All done!" : ""}
            </p>
          )}
        </section>
      )}

      {/* ── Reminders Tab ── */}
      {tab === "reminders" && (
        <section className="section">
          <p className="hint">Get a notification + sound at a specific time.</p>

          <label className="label">Task name</label>
          <input
            className="field"
            placeholder="e.g. Review PR, Daily standup…"
            value={reminderName}
            onChange={(e) => setReminderName(e.target.value)}
          />

          <label className="label">Remind me at</label>
          <input
            className="field"
            placeholder="e.g. 4pm  or  13:30"
            value={reminderTime}
            onChange={(e) => setReminderTime(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addReminder()}
          />

          {reminderError && <p className="error">{reminderError}</p>}

          <button className="btn btn-green" onClick={addReminder} style={{ marginTop: 4 }}>
            Set Reminder
          </button>

          {/* Existing reminders */}
          {reminders.length > 0 && (
            <ul className="reminder-list">
              {reminders.map((r) => (
                <li key={r.id} className={`reminder-item ${r.fired ? "reminder-fired" : ""}`}>
                  <div className="reminder-info">
                    <span className="reminder-name">{r.taskName}</span>
                    <span className="reminder-time">
                      {new Date(r.targetTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {r.fired ? " · fired ✅" : ""}
                    </span>
                  </div>
                  <button className="del-btn" onClick={() => deleteReminder(r.id)}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<Popup />);