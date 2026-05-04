// ============================================================
// popup.tsx — SprintBuddy v3
// State machine: idle → sprint → break → sprint → ...
// ============================================================

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";

// ── Types ─────────────────────────────────────────────────────

type Phase = "idle" | "sprint" | "break";

interface AppState {
  phase:           Phase;
  startedAt:       number | null;
  sprintDuration:  number;
  breakDuration:   number;
  sprintsToday:    number;
  lastSprintDate:  string;
  pomodoroEnabled: boolean;
}

interface Task     { id: string; text: string; done: boolean; createdAt: number; }
interface Reminder { id: string; taskName: string; targetTime: number; fired: boolean; }
type Tab = "sprint" | "tasks" | "reminders";

// ── Constants ─────────────────────────────────────────────────

const SPRINT_PRESETS = [
  { label: "1m",  value: 1  },
  { label: "5m",  value: 5  },
  { label: "10m", value: 10 },
  { label: "15m", value: 15 },
  { label: "25m", value: 25 },
  { label: "30m", value: 30 },
  { label: "45m", value: 45 },
  { label: "60m", value: 60 },
];

const BREAK_PRESETS = [
  { label: "2m",  value: 2  },
  { label: "5m",  value: 5  },
  { label: "10m", value: 10 },
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
];

const HOURS   = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = ["00","05","10","15","20","25","30","35","40","45","50","55"];

// ── Helpers ───────────────────────────────────────────────────

const fmt = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

const uid      = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

function send<T = any>(type: string, extra = {}): Promise<T> {
  return new Promise((res, rej) =>
    chrome.runtime.sendMessage({ type, ...extra }, (r) =>
      chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r)
    )
  );
}

// ── Ring ──────────────────────────────────────────────────────

function Ring({ pct, timeLeft, phase }: { pct: number; timeLeft: number; phase: Phase }) {
  const R = 76, circ = 2 * Math.PI * R;
  const offset = circ * (1 - Math.min(1, pct));
  const label  = phase === "sprint" ? "focusing" : phase === "break" ? "on break" : "ready";

  return (
    <div className="ring-wrap">
      <svg width="190" height="190" viewBox="0 0 190 190">
        <circle cx="95" cy="95" r={R} fill="none" strokeWidth="8" className="ring-bg" />
        <circle cx="95" cy="95" r={R} fill="none" strokeWidth="8"
          className={`ring-fg ring-${phase}`}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 95 95)"
        />
      </svg>
      <div className="ring-inner">
        <span className="ring-time">{fmt(timeLeft)}</span>
        <span className={`ring-status phase-${phase}`}>{label}</span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────

const Popup: React.FC = () => {

  // ── App state (mirrors background) ────────────────────────
  const [state, setState] = useState<AppState>({
    phase: "idle", startedAt: null,
    sprintDuration: 25 * 60, breakDuration: 5 * 60,
    sprintsToday: 0, lastSprintDate: "", pomodoroEnabled: false,
  });
  const [timeLeft, setTimeLeft] = useState(25 * 60);

  // ── Local UI state ─────────────────────────────────────────
  const [selectedSprint, setSelectedSprint] = useState(25);
  const [selectedBreak,  setSelectedBreak]  = useState(5);

  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [newTask,  setNewTask]  = useState("");

  const [reminders,      setReminders]      = useState<Reminder[]>([]);
  const [reminderName,   setReminderName]   = useState("");
  const [reminderHour,   setReminderHour]   = useState("9");
  const [reminderMin,    setReminderMin]     = useState("00");
  const [reminderPeriod, setReminderPeriod] = useState<"AM"|"PM">("AM");
  const [reminderError,  setReminderError]  = useState("");

  const [tab,   setTab]   = useState<Tab>("sprint");
  const [theme, setTheme] = useState(() => localStorage.getItem("sb-theme") || "dark");
  const [clock, setClock] = useState("");
  const [toast, setToast] = useState("");
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Toast ──────────────────────────────────────────────────
  const showToast = (m: string) => {
    setToast(m);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(""), 2800);
  };

  // ── Theme ──────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem("sb-theme", theme); }, [theme]);

  // ── Clock ──────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  // ── Poll background for state ──────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await send<AppState & { timeLeft: number }>("STATUS");
        setState(res); setTimeLeft(res.timeLeft);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 1000);

    const handler = (m: any) => {
      if (m.type === "PHASE_CHANGE") {
        setState(m.state); setTimeLeft(m.timeLeft);
        if (m.state.phase === "break") showToast("Sprint done! Break time 🧘");
        if (m.state.phase === "sprint") showToast("Break over! Sprint starting 🚀");
        if (m.state.phase === "idle")   showToast("Sprint complete! Great work 🎉");
      }
      if (m.type === "REMINDER_FIRED") { loadReminders(); showToast("⏰ Reminder fired!"); }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => { clearInterval(id); chrome.runtime.onMessage.removeListener(handler); };
  }, []);

  // ── Load data ──────────────────────────────────────────────
  const loadTasks = useCallback(async () => {
    try {
      const res = await send<{ tasks: Task[] }>("GET_TASKS");
      const today = todayStr();
      setTasks(res.tasks.map((t) =>
        t.done && new Date(t.createdAt).toISOString().slice(0, 10) !== today
          ? { ...t, done: false } : t
      ));
    } catch {}
  }, []);

  const loadReminders = useCallback(async () => {
    try {
      const res = await send<{ reminders: Reminder[] }>("GET_REMINDERS");
      setReminders(res.reminders);
    } catch {}
  }, []);

  useEffect(() => { loadTasks(); loadReminders(); }, []);

  // ── Sprint controls ────────────────────────────────────────
  const handleStart = async () => {
    try {
      const res = await send("START", {
        duration: selectedSprint,
        breakDuration: selectedBreak,
        pomodoroEnabled: state.pomodoroEnabled,
      });
      if (res.state) { setState(res.state); setTimeLeft(res.timeLeft); }
    } catch {}
  };

  const handleStop = async () => {
    try {
      const res = await send("STOP");
      if (res.state) { setState(res.state); setTimeLeft(res.state.sprintDuration); }
    } catch {}
  };

  const handleSkipBreak = async () => {
    try {
      const res = await send("SKIP_BREAK");
      if (res.state) { setState(res.state); setTimeLeft(res.timeLeft); }
    } catch {}
  };

  const togglePomodoro = async () => {
    const enabled = !state.pomodoroEnabled;
    try {
      const res = await send("SET_POMODORO", { enabled });
      if (res.state) setState(res.state);
    } catch {}
  };

  // ── Task controls ──────────────────────────────────────────
  const addTask = async () => {
    const text = newTask.trim(); if (!text) return;
    const task: Task = { id: uid(), text, done: false, createdAt: Date.now() };
    const updated = [task, ...tasks];
    setTasks(updated); setNewTask("");
    await send("SAVE_TASKS", { tasks: updated });
  };

  const toggleTask = async (id: string) => {
    const updated = tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated); await send("SAVE_TASKS", { tasks: updated });
  };

  const deleteTask = async (id: string) => {
    const updated = tasks.filter((t) => t.id !== id);
    setTasks(updated); await send("SAVE_TASKS", { tasks: updated });
  };

  // ── Reminder controls ──────────────────────────────────────
  const addReminder = async () => {
    setReminderError("");
    if (!reminderName.trim()) { setReminderError("Enter a task name."); return; }
    let h = parseInt(reminderHour);
    const m = parseInt(reminderMin);
    if (reminderPeriod === "PM" && h < 12) h += 12;
    if (reminderPeriod === "AM" && h === 12) h = 0;
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target <= new Date()) target.setDate(target.getDate() + 1);

    const reminder: Reminder = { id: uid(), taskName: reminderName.trim(), targetTime: target.getTime(), fired: false };
    await send("ADD_REMINDER", { reminder });
    setReminders((r) => [...r, reminder]);
    setReminderName("");
    showToast(`Reminder set for ${target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ✅`);
  };

  const deleteReminder = async (id: string) => {
    await send("DELETE_REMINDER", { id });
    setReminders((r) => r.filter((x) => x.id !== id));
  };

  // ── Derived ────────────────────────────────────────────────
  const currentDuration = state.phase === "break" ? state.breakDuration : state.sprintDuration;
  const pct             = currentDuration > 0 ? 1 - timeLeft / currentDuration : 0;
  const doneTasks       = tasks.filter((t) => t.done).length;
  const streakToday     = state.lastSprintDate === todayStr() ? state.sprintsToday : 0;

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className={`app ${theme}`}>

      {toast && <div className="toast">{toast}</div>}

      {/* Header */}
      <header className="hdr">
        <div className="hdr-left">
          <span className="logo">⚡ SprintBuddy</span>
          <span className="clock">{clock}</span>
        </div>
        <button className="icon-btn" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </header>

      {/* Streak */}
      <div className="streak-bar">
        <span className="streak-label">Today</span>
        <div className="streak-dots">
          {[1,2,3,4,5,6,7,8].map((n) => (
            <span key={n} className={`dot ${n <= streakToday ? "dot-on" : ""}`} />
          ))}
        </div>
        <span className="streak-count">{streakToday} sprint{streakToday !== 1 ? "s" : ""}</span>
      </div>

      {/* Tabs */}
      <nav className="tabs">
        {(["sprint","tasks","reminders"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {t === "sprint"    ? "⏱ Sprint"
            : t === "tasks"    ? `✅ Tasks${tasks.length ? ` ${doneTasks}/${tasks.length}` : ""}`
            :                    "🔔 Reminders"}
          </button>
        ))}
      </nav>

      {/* ── Sprint Tab ── */}
      {tab === "sprint" && (
        <section className="section">
          <Ring pct={pct} timeLeft={timeLeft} phase={state.phase} />

          {/* Break phase UI */}
          {state.phase === "break" && (
            <div className="break-card">
              <p className="break-title">☕ Break time</p>
              <p className="hint">Stretch, hydrate, rest your eyes.</p>
              <button className="btn btn-outline" onClick={handleSkipBreak}>Skip Break →</button>
            </div>
          )}

          {/* Idle phase — show config */}
          {state.phase === "idle" && (
            <>
              <div className="config-row">
                <span className="config-label">Sprint</span>
                <div className="presets-scroll">
                  <div className="presets">
                    {SPRINT_PRESETS.map((p) => (
                      <button key={p.value}
                        className={`chip ${selectedSprint === p.value ? "chip-active" : ""}`}
                        onClick={() => setSelectedSprint(p.value)}
                      >{p.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Pomodoro toggle */}
              <div className="pomodoro-row">
                <div className="pomodoro-info">
                  <span className="config-label">🍅 Pomodoro</span>
                  <span className="hint" style={{ textAlign: "left" }}>
                    Auto-start break after sprint
                  </span>
                </div>
                <button
                  className={`toggle ${state.pomodoroEnabled ? "toggle-on" : ""}`}
                  onClick={togglePomodoro}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              {/* Break duration — only shown when pomodoro on */}
              {state.pomodoroEnabled && (
                <div className="config-row">
                  <span className="config-label">Break</span>
                  <div className="presets-scroll">
                    <div className="presets">
                      {BREAK_PRESETS.map((p) => (
                        <button key={p.value}
                          className={`chip ${selectedBreak === p.value ? "chip-active chip-break" : ""}`}
                          onClick={() => setSelectedBreak(p.value)}
                        >{p.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sprint phase info */}
          {state.phase === "sprint" && (
            <p className="hint">
              {Math.round(state.sprintDuration / 60)}m sprint
              {state.pomodoroEnabled ? ` · ${Math.round(state.breakDuration / 60)}m break next 🍅` : ""}
              {streakToday > 0 ? ` · #${streakToday} today 🔥` : ""}
            </p>
          )}

          {/* Action buttons */}
          <div className="actions">
            {state.phase === "idle" && (
              <button className="btn btn-green" onClick={handleStart}>
                ▶ Start {selectedSprint}m Sprint
              </button>
            )}
            {state.phase === "sprint" && (
              <button className="btn btn-red" onClick={handleStop}>■ Stop Sprint</button>
            )}
            {state.phase === "break" && (
              <button className="btn btn-red" onClick={handleStop}>■ End Session</button>
            )}
          </div>
        </section>
      )}

      {/* ── Tasks Tab ── */}
      {tab === "tasks" && (
        <section className="section">
          <p className="hint">Your focus list for today. Check off as you go.</p>
          <div className="input-row">
            <input className="field" placeholder="Add a task…"
              value={newTask} onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
            />
            <button className="add-btn" onClick={addTask}>+</button>
          </div>
          <ul className="task-list">
            {tasks.length === 0 && <li className="empty">No tasks yet. Add one above ↑</li>}
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
            <p className="hint" style={{ marginTop: 4 }}>
              {doneTasks}/{tasks.length} complete {doneTasks === tasks.length && tasks.length > 0 ? "🎉" : ""}
            </p>
          )}
        </section>
      )}

      {/* ── Reminders Tab ── */}
      {tab === "reminders" && (
        <section className="section">
          <p className="hint">Get a notification + sound at a specific time.</p>

          <label className="label">Task name</label>
          <input className="field" placeholder="e.g. Review PR, Daily standup…"
            value={reminderName} onChange={(e) => setReminderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addReminder()}
          />

          <label className="label">Remind me at</label>
          <div className="time-dropdowns">
            <select className="time-select" value={reminderHour} onChange={(e) => setReminderHour(e.target.value)}>
              {HOURS.map((h) => <option key={h} value={String(h)}>{String(h).padStart(2,"0")}</option>)}
            </select>
            <span className="time-colon">:</span>
            <select className="time-select" value={reminderMin} onChange={(e) => setReminderMin(e.target.value)}>
              {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="time-select time-period" value={reminderPeriod}
              onChange={(e) => setReminderPeriod(e.target.value as "AM"|"PM")}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>

          {reminderError && <p className="error">{reminderError}</p>}
          <button className="btn btn-green" onClick={addReminder}>Set Reminder</button>

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