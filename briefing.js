// ============================================================
// Task Tracker tab
// Shows the daily briefing (the same one that's emailed each
// morning) with action items you can tick off on any device.
//
// Each morning the IPMI Daily Briefing saves a copy of the email
// here (see briefings.sql). Ticks are saved to your account.
// Items that come from your To-Do List stay in step with it:
// ticking one here marks the task done there, and the other way
// round. Anything else can be added to the To-Do List with one tap.
// ============================================================

const TAB_KEY = "todo-app.tab";
const BRIEFING_DAYS = 14;              // how many recent briefings to keep handy
const PACIFIC = "America/Los_Angeles"; // briefings are dated in Las Vegas time

let activeTab = "todo";
let briefings = [];          // newest first: { day, data, updatedAt, items, summary }
let checks = {};             // "day|itemKey" -> { day, item_key, done_at, task_id }
let viewDay = null;          // day being shown; null means the newest
let briefingState = "idle";  // idle | loading | ready | missing | error
let briefingsFromServer = false;
let briefingLoadSeq = 0;

// ---- Dates (briefing days are Las Vegas dates, "YYYY-MM-DD") ----
function pacificISO(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dayText(iso, options) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

function pacificTime(stamp) {
  const t = new Date(stamp);
  if (!stamp || isNaN(t)) return "";
  return t.toLocaleTimeString(undefined, { timeZone: PACIFIC, hour: "numeric", minute: "2-digit" });
}

// ---- Text helpers (everything from the briefing is treated as plain text) ----
function plain(value) {
  return String(value ?? "").replace(/<\/?[a-z][^>]*>/gi, "").replace(/\s+/g, " ").trim();
}

function norm(value) {
  return plain(value).toLowerCase();
}

function safeUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\/[^\s"<>]+$/i.test(url) ? url : "";
}

function escAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "link"; }
}

function linkLabel(url) {
  const host = hostOf(url);
  if (host === "mail.google.com") return "Open email";
  if (host === "calendar.google.com") return "Open in Calendar";
  return `Open ${host}`;
}

function externalLink(url, label, className = "") {
  return `<a${className ? ` class="${className}"` : ""} href="${escAttr(url)}" target="_blank" rel="noopener">${escapeHTML(label)} <span aria-hidden="true">&#8599;</span></a>`;
}

// Turn web addresses inside a line into short tappable links
function linkify(text) {
  const parts = [];
  const re = /https?:\/\/[^\s<>"]+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    parts.push(escapeHTML(text.slice(last, m.index)));
    parts.push(externalLink(url, hostOf(url)));
    last = m.index + url.length;
    re.lastIndex = last;
  }
  parts.push(escapeHTML(text.slice(last)));
  return parts.join("");
}

// ---- Reading a briefing ----
function prepareBriefing(row) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const seen = {};
  const items = (Array.isArray(data.action_items) ? data.action_items : [])
    .filter((raw) => raw && plain(raw.title))
    .map((raw) => {
      const item = {
        title: plain(raw.title).slice(0, 300),
        source: plain(raw.source),
        type: ["task", "email", "note"].includes(raw.type) ? raw.type : "other",
        high: raw.high === true || raw.priority === "high",
        taskTitle: plain(raw.task_title),
        taskDue: /^\d{4}-\d{2}-\d{2}$/.test(raw.task_due || "") ? raw.task_due : "",
        link: safeUrl(raw.link),
      };
      // Ticks are remembered by the item's wording, so a re-sent briefing keeps them
      let key = `${item.type}:${norm(item.title).slice(0, 200)}`;
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key += `#${seen[key]}`;
      item.key = key;
      return item;
    });

  const summary = (Array.isArray(data.summary) ? data.summary : [])
    .filter((s) => s && typeof s === "object")
    .map((s) => ({
      heading: plain(s.heading),
      items: (Array.isArray(s.items) ? s.items : [])
        .map((it) => (typeof it === "string"
          ? { lead: "", text: plain(it), link: "" }
          : { lead: plain(it && it.lead), text: plain(it && it.text), link: safeUrl(it && it.link) }))
        .filter((it) => it.lead || it.text),
    }))
    .filter((s) => s.heading || s.items.length);

  return { day: row.day, data, updatedAt: row.updatedAt || row.updated_at || null, items, summary };
}

// ---- Matching items to To-Do List tasks ----
function checkFor(day, key) {
  return checks[`${day}|${key}`] || null;
}

// Find the task a "task" item came from, by its exact title (and due date)
function matchTask(item) {
  const want = norm(item.taskTitle || item.title);
  let found = tasks.filter((t) => norm(t.title) === want);
  if (!found.length) return null;
  if (item.taskDue) {
    const sameDue = found.filter((t) => t.due === item.taskDue);
    if (sameDue.length) found = sameDue;
  }
  const open = found.filter((t) => !t.done);
  if (open.length) found = open;
  return found.sort((a, b) => b.createdAt - a.createdAt)[0];
}

function linkedTask(day, item) {
  const check = checkFor(day, item.key);
  if (check && check.task_id) return tasks.find((t) => t.id === check.task_id) || null;
  return item.type === "task" ? matchTask(item) : null;
}

function isDone(day, item) {
  const task = linkedTask(day, item);
  if (task) return !!task.done;
  const check = checkFor(day, item.key);
  return !!(check && check.done_at);
}

// ---- Saving ticks ----
function saveCheck(day, key, fields, { quiet = false } = {}) {
  const id = `${day}|${key}`;
  checks[id] = { day, item_key: key, done_at: null, task_id: null, ...checks[id], ...fields };
  saveBriefingCache();
  const row = { day, item_key: key, ...fields, updated_at: new Date().toISOString() };
  const write = () => db.from("briefing_checks").upsert(row, { onConflict: "user_id,day,item_key" });
  if (!quiet) return remote(write);
  return Promise.resolve()
    .then(write)
    .then(({ error }) => { if (error) console.warn(error); })
    .catch((err) => console.warn(err));
}

// Remember which task each "task" item belongs to, so renaming the task later keeps the link
function bindTaskItems(briefing) {
  if (!briefingsFromServer || !tasksSynced) return;
  for (const item of briefing.items) {
    if (item.type !== "task") continue;
    const check = checkFor(briefing.day, item.key);
    if (check && check.task_id) continue;
    const task = matchTask(item);
    if (!task) continue;
    const fields = { task_id: task.id };
    if (task.done && !(check && check.done_at)) fields.done_at = task.doneAt || Date.now();
    saveCheck(briefing.day, item.key, fields, { quiet: true });
  }
}

function toggleItem(day, item, done) {
  const task = linkedTask(day, item);
  const now = Date.now();
  const fields = { done_at: done ? now : null };
  if (task) fields.task_id = task.id;
  saveCheck(day, item.key, fields);
  if (task && !!task.done !== done) {
    updateTask(task.id, { done, doneAt: done ? now : null });
    showToast(done ? "Also ticked off in your To-Do List." : "Reopened in your To-Do List too.");
  } else {
    renderTracker();
  }
}

function addItemToTodo(day, item) {
  const task = addTask({
    title: item.title.slice(0, 200),
    due: todayISO(),
    priority: item.high ? "high" : "normal",
    list: LISTS[0],
  });
  saveCheck(day, item.key, { task_id: task.id });
  renderTracker();
  showToast("Added to your To-Do List for today.", () => {
    const index = tasks.findIndex((t) => t.id === task.id);
    if (index !== -1) {
      tasks.splice(index, 1);
      saveCache();
      remote(() => db.from("tasks").delete().eq("id", task.id));
    }
    saveCheck(day, item.key, { task_id: null });
    render();
  });
}

// Called by the To-Do List when a task is ticked or unticked there
function onTaskDoneChanged(task) {
  for (const briefing of briefings) {
    for (const item of briefing.items) {
      const check = checkFor(briefing.day, item.key);
      const isLinked = check && check.task_id
        ? check.task_id === task.id
        : item.type === "task" && (matchTask(item) || {}).id === task.id;
      if (!isLinked) continue;
      if (check && check.task_id && !!check.done_at === !!task.done) continue;
      saveCheck(briefing.day, item.key, {
        task_id: task.id,
        done_at: task.done ? (task.doneAt || Date.now()) : null,
      }, { quiet: true });
    }
  }
}

// Called by the To-Do List just before tasks are deleted or cleared,
// so finished items stay ticked here after their task is gone
function onTasksRemoved(removed) {
  for (const task of removed) {
    if (task.done) onTaskDoneChanged(task);
  }
}

// ---- Loading ----
function briefingCacheKey() {
  return user ? `todo-app.briefings.${user.id}` : null;
}

function saveBriefingCache() {
  try {
    const slim = briefings.map(({ day, data, updatedAt }) => ({ day, data, updatedAt }));
    localStorage.setItem(briefingCacheKey(), JSON.stringify({ briefings: slim, checks }));
  } catch {}
}

function loadBriefingCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(briefingCacheKey()));
    if (!cached || !Array.isArray(cached.briefings)) return;
    briefings = cached.briefings.map(prepareBriefing);
    checks = cached.checks && typeof cached.checks === "object" ? cached.checks : {};
    briefingState = "ready";
  } catch {}
}

function isMissingSetup(error) {
  return ["42P01", "PGRST205", "PGRST200"].includes(error.code) || /does not exist|schema cache/i.test(error.message || "");
}

async function loadBriefings() {
  if (!user) return;
  const seq = ++briefingLoadSeq;
  const since = shiftISO(pacificISO(), -45);
  let result;
  try {
    result = await Promise.all([
      db.from("briefings").select("day,data,updated_at").gte("day", since).order("day", { ascending: false }).limit(BRIEFING_DAYS),
      db.from("briefing_checks").select("day,item_key,done_at,task_id").gte("day", since),
    ]);
  } catch (err) {
    result = [{ error: err }, { error: null }];
  }
  if (seq !== briefingLoadSeq || !user) return; // a newer load started, or signed out

  const [b, c] = result;
  const error = b.error || c.error;
  if (error) {
    console.error(error);
    if (isMissingSetup(error)) {
      briefings = [];
      checks = {};
      briefingState = "missing";
    } else if (!briefings.length) {
      briefingState = "error";
    }
    renderTracker();
    return;
  }

  briefings = (b.data || []).map((r) => prepareBriefing({ day: r.day, data: r.data, updatedAt: r.updated_at }));
  checks = {};
  for (const r of c.data || []) {
    checks[`${r.day}|${r.item_key}`] = {
      day: r.day,
      item_key: r.item_key,
      done_at: r.done_at == null ? null : Number(r.done_at),
      task_id: r.task_id || null,
    };
  }
  briefingsFromServer = true;
  briefingState = "ready";
  if (viewDay && !briefings.some((x) => x.day === viewDay)) viewDay = null;
  saveBriefingCache();
  renderTracker();
}

function startBriefings() {
  briefings = [];
  checks = {};
  viewDay = null;
  briefingsFromServer = false;
  briefingState = "loading";
  loadBriefingCache();
  renderTracker();
  loadBriefings();
}

function stopBriefings() {
  briefingLoadSeq++;
  briefings = [];
  checks = {};
  viewDay = null;
  briefingsFromServer = false;
  briefingState = "idle";
  renderTracker();
}

// ---- Drawing ----
function currentBriefing() {
  if (!briefings.length) return null;
  return briefings.find((b) => b.day === viewDay) || briefings[0];
}

function updateTabCounts() {
  const el = $("trackerCount");
  const latest = briefings[0];
  if (!latest || !latest.items.length) {
    el.hidden = true;
    return;
  }
  const left = latest.items.filter((item) => !isDone(latest.day, item)).length;
  el.textContent = left ? left : "✓";
  el.title = left ? `${left} action item${left === 1 ? "" : "s"} left` : "All action items done";
  el.hidden = false;
}

function highlightSource(text) {
  return escapeHTML(text).replace(/\bHigh\b/g, '<span class="hi">High</span>');
}

function itemHTML(briefing, item) {
  const done = isDone(briefing.day, item);
  const task = linkedTask(briefing.day, item);
  const actions = [];
  if (item.link) actions.push(externalLink(item.link, linkLabel(item.link), "chip"));
  if (item.type !== "task") {
    if (task) actions.push(`<span class="chip chip-linked">&#10003; In To-Do List</span>`);
    else if (!done) actions.push(`<button type="button" class="chip chip-add" data-action="add">+ Add to To-Do</button>`);
  }
  const classes = ["tb-item"];
  if (done) classes.push("done");
  return `
    <li class="${classes.join(" ")}" data-key="${escAttr(item.key)}">
      <label class="tb-check">
        <input type="checkbox" ${done ? "checked" : ""}>
        <span class="tb-item-body">
          <span class="tb-item-title">${escapeHTML(item.title)}</span>
          ${item.source ? `<span class="tb-item-source">${highlightSource(item.source)}</span>` : ""}
        </span>
      </label>
      ${actions.length ? `<div class="tb-actions">${actions.join("")}</div>` : ""}
    </li>`;
}

function statsHTML(stats) {
  if (!stats || typeof stats !== "object") return "";
  const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : "–");
  return `
    <section class="card tb-stats" aria-label="Briefing numbers">
      <div><strong>${n(stats.due_today)}</strong><span>Due today</span></div>
      <div class="overdue"><strong>${n(stats.overdue)}</strong><span>Overdue</span></div>
      <div><strong>${n(stats.meetings)}</strong><span>Meetings</span></div>
      <div><strong>${n(stats.action_items)}</strong><span>Action items</span></div>
    </section>`;
}

function summaryHTML(briefing) {
  if (!briefing.summary.length) return "";
  const sections = briefing.summary.map((s) => `
      <div class="tb-section">
        ${s.heading ? `<h3>${escapeHTML(s.heading)}</h3>` : ""}
        ${s.items.length ? `<ul>${s.items.map((it) => `
          <li>${it.lead ? `<b>${escapeHTML(it.lead)}</b> ` : ""}${linkify(it.text)}${it.link ? ` ${externalLink(it.link, linkLabel(it.link))}` : ""}</li>`).join("")}
        </ul>` : ""}
      </div>`).join("");
  return `
    <section class="card tb-card">
      <h2 class="tb-label">Daily summary</h2>
      ${sections}
    </section>`;
}

function renderDayNav(briefing) {
  const nav = document.querySelector(".day-nav");
  if (!briefing) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;
  const index = briefings.indexOf(briefing);
  const today = pacificISO();
  let when = "";
  if (briefing.day === today) when = "Today's briefing";
  else if (briefing.day === shiftISO(today, -1)) when = "Yesterday's briefing";
  else if (briefing.day > today) when = "Upcoming briefing";
  else when = "Earlier briefing";
  const made = pacificTime((briefing.data && briefing.data.generated_at) || briefing.updatedAt);
  $("dayTitle").textContent = dayText(briefing.day, { weekday: "long", month: "long", day: "numeric" });
  $("daySub").textContent = made ? `${when} · ${made}` : when;
  $("prevDay").disabled = index >= briefings.length - 1;
  $("nextDay").disabled = index <= 0;
}

function renderTracker() {
  updateTabCounts();
  if (activeTab !== "tracker") return;

  const body = $("trackerBody");
  const briefing = currentBriefing();
  renderDayNav(briefing);

  if (!briefing) {
    let message;
    if (briefingState === "loading" || briefingState === "idle") {
      message = "Loading your briefing…";
    } else if (briefingState === "error") {
      message = "Couldn't load your briefing. Check your connection and try again.";
    } else {
      message = "<strong>No briefing yet</strong>Your daily briefing shows up here each morning around 7 AM Las Vegas time. It's the same one that's emailed to you, with boxes you can tick off as you go.";
    }
    body.innerHTML = `<div class="empty tb-empty">${message}</div>`;
    return;
  }

  bindTaskItems(briefing);

  const data = briefing.data;
  const html = [];
  const today = pacificISO();
  const isLatest = briefing === briefings[0];

  if (isLatest && briefing.day < today) {
    html.push(`<div class="tb-note info">Today's briefing isn't in yet. It usually arrives around 7 AM Las Vegas time, so this is ${escapeHTML(dayText(briefing.day, { weekday: "long" }))}'s.</div>`);
  } else if (!isLatest) {
    html.push(`<div class="tb-note info"><span>You're looking at an earlier briefing.</span><button type="button" class="btn-link" data-action="latest">Go to the latest</button></div>`);
  }
  if (plain(data.notice)) html.push(`<div class="tb-note">${escapeHTML(plain(data.notice))}</div>`);

  if (plain(data.banner)) {
    html.push(`
      <div class="banner tb-banner">
        <span class="banner-icon" aria-hidden="true">&#128276;</span>
        <span class="tb-banner-text">${escapeHTML(plain(data.banner))}</span>
      </div>`);
  }

  html.push(statsHTML(data.stats));

  const total = briefing.items.length;
  const doneCount = briefing.items.filter((item) => isDone(briefing.day, item)).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  html.push(`
    <section class="card tb-card">
      <div class="tb-card-head">
        <h2 class="tb-label">Action items</h2>
        ${total ? `<span class="tb-progress-text"><strong>${doneCount}</strong> of ${total} done</span>` : ""}
      </div>
      ${total ? `<div class="tb-bar" aria-hidden="true"><div style="width:${pct}%"></div></div>
      <ul class="tb-items">${briefing.items.map((item) => itemHTML(briefing, item)).join("")}</ul>`
      : `<p class="tb-none">No action items in this briefing.</p>`}
    </section>`);

  html.push(summaryHTML(briefing));
  html.push(`<p class="tb-foot">Times are Las Vegas (Pacific) time</p>`);

  body.innerHTML = html.join("");
}

// ---- Tabs ----
function tabFromHash() {
  const hash = location.hash.replace(/^#/, "").toLowerCase();
  if (["tracker", "task-tracker", "briefing"].includes(hash)) return "tracker";
  if (["todo", "to-do", "tasks"].includes(hash)) return "todo";
  return null;
}

function setTab(name) {
  activeTab = name === "tracker" ? "tracker" : "todo";
  $("appView").dataset.tab = activeTab;
  document.querySelectorAll(".tab").forEach((btn) => {
    const on = btn.dataset.tab === activeTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.tabIndex = on ? 0 : -1;
  });
  $("trackerPanel").hidden = activeTab !== "tracker";
  $("todoPanel").hidden = activeTab !== "todo";
  try { localStorage.setItem(TAB_KEY, activeTab); } catch {}
  renderTracker();
}

function openTabFromHash() {
  const fromHash = tabFromHash();
  if (!fromHash) return false;
  setTab(fromHash);
  // Drop the #tracker from the address so the app opens normally next time
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

function initTracker() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = activeTab === "tracker" ? "todo" : "tracker";
    setTab(next);
    $(next === "tracker" ? "tabTracker" : "tabTodo").focus();
  });

  $("prevDay").addEventListener("click", () => {
    const index = briefings.indexOf(currentBriefing());
    if (index < briefings.length - 1) viewDay = briefings[index + 1].day;
    renderTracker();
  });
  $("nextDay").addEventListener("click", () => {
    const index = briefings.indexOf(currentBriefing());
    if (index > 0) viewDay = index - 1 === 0 ? null : briefings[index - 1].day;
    renderTracker();
  });

  const body = $("trackerBody");
  body.addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    const briefing = currentBriefing();
    const li = e.target.closest(".tb-item");
    const item = briefing && li && briefing.items.find((it) => it.key === li.dataset.key);
    if (item) toggleItem(briefing.day, item, e.target.checked);
  });
  body.addEventListener("click", (e) => {
    const button = e.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "latest") {
      viewDay = null;
      renderTracker();
      return;
    }
    const briefing = currentBriefing();
    const li = button.closest(".tb-item");
    const item = briefing && li && briefing.items.find((it) => it.key === li.dataset.key);
    if (item && button.dataset.action === "add") addItemToTodo(briefing.day, item);
  });

  window.addEventListener("hashchange", openTabFromHash);
  if (!openTabFromHash()) {
    let saved = null;
    try { saved = localStorage.getItem(TAB_KEY); } catch {}
    setTab(saved === "tracker" ? "tracker" : "todo");
  }
}

initTracker();
