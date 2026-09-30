// ============================================================
// Day / night mode
//   Auto  – follows the clock in Las Vegas (America/Los_Angeles,
//           so it handles PDT and PST automatically)
//   Light – always light
//   Dark  – always dark
// The choice is remembered on each device.
// ============================================================
(function () {
  const TIME_ZONE = "America/Los_Angeles"; // Nevada / Pacific time
  const DAY_STARTS = 6;   // 6:00 AM Pacific → light mode
  const NIGHT_STARTS = 19; // 7:00 PM Pacific → dark mode
  const KEY = "todo-app.theme";
  const MODES = ["auto", "light", "dark"];
  const LABELS = { auto: "Auto", light: "Light", dark: "Dark" };
  const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    auto: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
    light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    dark: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  };

  function getMode() {
    try {
      const m = localStorage.getItem(KEY);
      return MODES.includes(m) ? m : "auto";
    } catch { return "auto"; }
  }

  function pacificHour() {
    const h = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(new Date());
    return Number(h) % 24;
  }

  function resolved(mode) {
    if (mode !== "auto") return mode;
    const h = pacificHour();
    return h >= DAY_STARTS && h < NIGHT_STARTS ? "light" : "dark";
  }

  function apply() {
    const mode = getMode();
    const theme = resolved(mode);
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0f1426" : "#f3f5f9";
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.querySelector(".theme-icon").innerHTML = ICONS[mode];
      btn.querySelector(".theme-label").textContent = LABELS[mode];
      btn.title = mode === "auto"
        ? `Auto: light 6 AM–7 PM, dark 7 PM–6 AM (Las Vegas time). Now ${theme}. Tap to change.`
        : `${LABELS[mode]} mode. Tap to change.`;
    });
  }

  let noteTimer = null;
  function announce(mode) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    document.getElementById("toastMsg").textContent = mode === "auto"
      ? `Auto · follows Las Vegas time`
      : `${LABELS[mode]} mode`;
    const undo = document.getElementById("toastUndo");
    if (undo) undo.hidden = true;
    toast.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { toast.hidden = true; }, 2500);
  }

  function cycle() {
    const next = MODES[(MODES.indexOf(getMode()) + 1) % MODES.length];
    try { localStorage.setItem(KEY, next); } catch {}
    apply();
    announce(next);
  }

  // Apply immediately (before the page draws) to avoid a flash of the wrong theme
  apply();

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".theme-btn").forEach((btn) => btn.addEventListener("click", cycle));
    apply();
  });

  // Re-check every minute so Auto flips at 6 AM / 7 PM Pacific while the app is open
  setInterval(apply, 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) apply(); });
})();
