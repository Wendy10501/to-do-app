// ============================================================
// To-Do App
// Tasks are stored online in Supabase, so they sync across every
// device and browser you sign in on. A copy is kept on the device
// so the list shows instantly and stays readable offline.
// ============================================================

// ---- Settings you can change ----
const LISTS = ["Work", "Personal", "Errands"];   // edit these names to suit you
const OLD_STORAGE_KEY = "todo-app.tasks";         // where the first version kept tasks

// ---- Supabase ----
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---- State ----
let user = null;
let tasks = [];
let currentFilter = "all";
let currentList = "";
let searchText = "";

// ---- Helpers ----
const $ = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDue(iso) {
  if (!iso) return "";
  if (iso === todayISO()) return "Today";
  if (iso === tomorrowISO()) return "Tomorrow";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Converting between the app and the database ----
function toRow(t) {
  return {
    id: t.id,
    title: t.title,
    due: t.due || null,
    priority: t.priority || "normal",
    list: t.list || null,
    done: !!t.done,
    created_at: t.createdAt || Date.now(),
    done_at: t.doneAt || null,
  };
}

function fromRow(r) {
  return {
    id: r.id,
    title: r.title,
    due: r.due || "",
    priority: r.priority || "normal",
    list: r.list || "",
    done: r.done,
    createdAt: Number(r.created_at),
    doneAt: r.done_at ? Number(r.done_at) : null,
  };
}

// ---- Device cache (for instant display / offline reading) ----
function cacheKey() { return user ? `todo-app.cache.${user.id}` : null; }

function saveCache() {
  try { localStorage.setItem(cacheKey(), JSON.stringify(tasks)); } catch {}
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(cacheKey())) || []; } catch { return []; }
}

// ---- Sync status ----
let pending = 0;
function setSync(state) {
  const el = $("syncStatus");
  if (state === "saving") el.textContent = "Saving…";
  else if (state === "error") el.textContent = "Not saved – offline?";
  else el.textContent = "Synced";
  el.className = `sync-status ${state || ""}`;
}

async function remote(fn) {
  pending++;
  setSync("saving");
  try {
    const { error } = await fn();
    if (error) throw error;
    pending--;
    if (!pending) setSync("ok");
    return true;
  } catch (err) {
    pending--;
    console.error(err);
    setSync("error");
    showToast("Couldn't save to the cloud. Check your connection.");
    return false;
  }
}

async function fetchTasks() {
  setSync("saving");
  const { data, error } = await db.from("tasks").select("*").order("created_at");
  if (error) {
    console.error(error);
    setSync("error");
    return;
  }
  tasks = data.map(fromRow);
  saveCache();
  setSync("ok");
  render();
}

// Move tasks saved by the old, device-only version into the cloud (once)
async function migrateOldTasks() {
  let old = [];
  try { old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY)) || []; } catch {}
  if (!old.length) return;
  const ok = await remote(() => db.from("tasks").upsert(old.filter((t) => t && t.title).map(toRow)));
  if (ok) {
    localStorage.setItem(OLD_STORAGE_KEY + ".migrated", localStorage.getItem(OLD_STORAGE_KEY));
    localStorage.removeItem(OLD_STORAGE_KEY);
    showToast(`Moved ${old.length} task${old.length === 1 ? "" : "s"} from this device to your account.`);
  }
}

// ---- Task actions ----
function addTask({ title, due, priority, list }) {
  const task = { id: newId(), title, due, priority, list, done: false, createdAt: Date.now(), doneAt: null };
  tasks.push(task);
  saveCache();
  render();
  remote(() => db.from("tasks").insert(toRow(task)));
}

function updateTask(id, changes) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, changes);
  saveCache();
  render();
  remote(() => db.from("tasks").update(toRow(task)).eq("id", id));
}

function deleteTask(id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = tasks.splice(index, 1);
  saveCache();
  render();
  remote(() => db.from("tasks").delete().eq("id", id));
  showToast("Task deleted.", () => {
    tasks.splice(index, 0, removed);
    saveCache();
    render();
    remote(() => db.from("tasks").insert(toRow(removed)));
  });
}

function clearCompleted() {
  const removed = tasks.filter((t) => t.done);
  if (!removed.length) return;
  tasks = tasks.filter((t) => !t.done);
  saveCache();
  render();
  remote(() => db.from("tasks").delete().in("id", removed.map((t) => t.id)));
  showToast(`Cleared ${removed.length} completed task${removed.length === 1 ? "" : "s"}.`, () => {
    tasks.push(...removed);
    saveCache();
    render();
    remote(() => db.from("tasks").insert(removed.map(toRow)));
  });
}

// ---- Sorting ----
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

function sortOpen(a, b) {
  const aDue = a.due || "9999-12-31";
  const bDue = b.due || "9999-12-31";
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  if (a.priority !== b.priority) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  return a.createdAt - b.createdAt;
}

// ---- Rendering ----
function taskHTML(task) {
  const today = todayISO();
  let dueClass = "";
  if (task.due && !task.done) {
    if (task.due < today) dueClass = "overdue";
    else if (task.due === today) dueClass = "today";
  }

  const tags = [];
  if (task.priority === "high") tags.push(`<span class="tag high">&#128293; High Priority</span>`);
  if (task.priority === "low") tags.push(`<span class="tag low">Low Priority</span>`);
  if (task.due) tags.push(`<span class="tag date ${dueClass}">${dueClass === "overdue" ? "Overdue · " : "Due "}${formatDue(task.due)}</span>`);
  if (task.list) tags.push(`<span class="tag normal">${escapeHTML(task.list)}</span>`);

  const classes = ["task"];
  if (task.done) classes.push("done");
  if (task.priority === "high" && !task.done) classes.push("high");

  return `
    <li class="${classes.join(" ")}" data-id="${escapeHTML(task.id)}">
      <input type="checkbox" ${task.done ? "checked" : ""} aria-label="Mark done">
      <div class="body">
        <div class="meta">${tags.join("")}</div>
        <div class="title" title="Click to edit">${escapeHTML(task.title)}</div>
      </div>
      <div class="actions">
        <button class="icon-btn priority${task.priority === "high" ? " on" : ""}" title="Toggle high priority" aria-label="Toggle high priority">&#9873;</button>
        <button class="icon-btn delete" title="Delete" aria-label="Delete task">&#10005;</button>
      </div>
    </li>`;
}

function groupHTML(title, items, extraClass = "") {
  if (!items.length) return "";
  return `<section class="group ${extraClass}"><h2>${title}</h2><ul class="tasks">${items.map(taskHTML).join("")}</ul></section>`;
}

function emptyHTML(message) {
  return `<div class="empty">${message}</div>`;
}

function render() {
  const today = todayISO();

  let visible = tasks;
  if (currentList) visible = visible.filter((t) => t.list === currentList);
  if (searchText) visible = visible.filter((t) => t.title.toLowerCase().includes(searchText));

  const open = visible.filter((t) => !t.done).sort(sortOpen);
  const done = visible.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const overdue = open.filter((t) => t.due && t.due < today);
  const dueToday = open.filter((t) => t.due === today);
  const upcoming = open.filter((t) => t.due && t.due > today);
  const noDate = open.filter((t) => !t.due);

  // Summary counts (across all tasks, not just filtered)
  const allOpen = tasks.filter((t) => !t.done);
  $("countOpen").textContent = allOpen.length;
  $("countOverdue").textContent = allOpen.filter((t) => t.due && t.due < today).length;
  $("countDone").textContent = tasks.length - allOpen.length;

  // Filter badges (respect the list + search filters)
  const counts = { all: open.length, today: overdue.length + dueToday.length, upcoming: upcoming.length, done: done.length };
  document.querySelectorAll("[data-count]").forEach((el) => { el.textContent = counts[el.dataset.count]; });

  // Progress bar
  const pct = tasks.length ? Math.round(((tasks.length - allOpen.length) / tasks.length) * 100) : 0;
  $("progressBar").style.width = pct + "%";
  $("progressPct").textContent = pct + "%";

  // Daily banner
  const dueNow = allOpen.filter((t) => t.due && t.due <= today).length;
  const bannerKey = "todo-app.banner-dismissed";
  let dismissed = "";
  try { dismissed = sessionStorage.getItem(bannerKey) || ""; } catch {}
  if (dueNow && dismissed !== today) {
    $("bannerText").textContent = `Let's go! You've got ${dueNow} task${dueNow === 1 ? "" : "s"} due today.`;
    $("banner").hidden = false;
  } else {
    $("banner").hidden = true;
  }

  let html = "";
  if (currentFilter === "all") {
    html = groupHTML("Overdue", overdue, "overdue") + groupHTML("Today", dueToday) +
           groupHTML("Upcoming", upcoming) + groupHTML("No date", noDate);
    if (!html) html = emptyHTML(done.length ? "All done. Nice work." : "No tasks yet. Add one above.");
  } else if (currentFilter === "today") {
    html = groupHTML("Overdue", overdue, "overdue") + groupHTML("Today", dueToday);
    if (!html) html = emptyHTML("Nothing due today.");
  } else if (currentFilter === "upcoming") {
    html = groupHTML("Upcoming", upcoming);
    if (!html) html = emptyHTML("Nothing scheduled ahead.");
  } else if (currentFilter === "done") {
    html = groupHTML("Completed", done);
    if (!html) html = emptyHTML("No completed tasks yet.");
  }

  $("taskList").innerHTML = html;
  $("clearDone").hidden = !tasks.some((t) => t.done);
}

// ---- Inline editing ----
function startEditing(li, task) {
  const titleEl = li.querySelector(".title");
  const input = document.createElement("input");
  input.className = "title-edit";
  input.value = task.title;
  input.maxLength = 200;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (save && value && value !== task.title) updateTask(task.id, { title: value });
    else render();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

// ---- Toast with undo ----
let toastTimer = null;
let undoAction = null;

function showToast(message, undo = null) {
  $("toastMsg").textContent = message;
  undoAction = undo;
  $("toastUndo").hidden = !undo;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; undoAction = null; }, 5000);
}

// ---- Export / Import ----
function exportTasks() {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tasks-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importTasks(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error();
      const existing = new Set(tasks.map((t) => t.id));
      const added = data
        .filter((t) => t && t.title && !existing.has(t.id))
        .map((t) => ({ ...t, id: t.id || newId() }));
      tasks.push(...added);
      saveCache();
      render();
      if (added.length) remote(() => db.from("tasks").upsert(added.map(toRow)));
      showToast(`Imported ${added.length} task${added.length === 1 ? "" : "s"}.`);
    } catch {
      showToast("That file isn't a valid task export.");
    }
  };
  reader.readAsText(file);
}

// ---- Screens ----
function showView(name) {
  $("loadingView").hidden = name !== "loading";
  $("authView").hidden = name !== "auth";
  $("appView").hidden = name !== "app";
}

function authMessage(text, isError = false) {
  const el = $("authMsg");
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle("error", isError);
}

async function onSignedIn(sessionUser) {
  const firstLoad = !user || user.id !== sessionUser.id;
  user = sessionUser;
  $("accountLabel").textContent = `Signed in as ${user.email}`;
  const name = (user.email || "").split("@")[0].split(/[._\-+0-9]/).filter(Boolean)[0] || "";
  const pretty = name ? name[0].toUpperCase() + name.slice(1).toLowerCase() : "";
  $("avatarBtn").textContent = (pretty[0] || "?").toUpperCase();
  $("avatarBtn").title = user.email;
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  $("greeting").textContent = pretty ? `${part}, ${pretty}` : part;
  showView("app");
  if (firstLoad) {
    tasks = loadCache();
    render();
    await migrateOldTasks();
    await fetchTasks();
  }
}

function onSignedOut() {
  user = null;
  tasks = [];
  showView("auth");
}

// ---- Setup ----
function init() {
  $("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  $("listInput").innerHTML = LISTS.map((l) => `<option>${escapeHTML(l)}</option>`).join("");
  $("listFilter").innerHTML = `<option value="">All lists</option>` +
    LISTS.map((l) => `<option>${escapeHTML(l)}</option>`).join("");

  // Sign in / sign up
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    authMessage("Signing in…");
    const { error } = await db.auth.signInWithPassword({
      email: $("authEmail").value.trim(),
      password: $("authPassword").value,
    });
    if (error) authMessage(error.message, true);
    else authMessage("");
  });

  $("signUpBtn").addEventListener("click", async () => {
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    if (!email || password.length < 6) {
      authMessage("Enter your email and a password (at least 6 characters), then tap Create account again.", true);
      return;
    }
    authMessage("Creating your account…");
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) authMessage(error.message, true);
    else if (!data.session) authMessage("Check your email and click the confirmation link, then come back and sign in.");
    else authMessage("");
  });

  $("signOutBtn").addEventListener("click", () => db.auth.signOut());

  $("bannerClose").addEventListener("click", () => {
    try { sessionStorage.setItem("todo-app.banner-dismissed", todayISO()); } catch {}
    $("banner").hidden = true;
  });

  // Add task
  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("titleInput").value.trim();
    if (!title) return;
    addTask({
      title,
      due: $("dueInput").value,
      priority: $("priorityInput").value,
      list: $("listInput").value,
    });
    $("titleInput").value = "";
    $("dueInput").value = "";
    $("priorityInput").value = "normal";
    $("titleInput").focus();
  });

  // Filters
  document.querySelectorAll(".filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter;
      document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  });
  $("listFilter").addEventListener("change", (e) => { currentList = e.target.value; render(); });
  $("searchInput").addEventListener("input", (e) => { searchText = e.target.value.trim().toLowerCase(); render(); });

  // Task interactions
  $("taskList").addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    const id = e.target.closest(".task").dataset.id;
    updateTask(id, { done: e.target.checked, doneAt: e.target.checked ? Date.now() : null });
  });

  $("taskList").addEventListener("click", (e) => {
    const li = e.target.closest(".task");
    if (!li) return;
    const task = tasks.find((t) => t.id === li.dataset.id);
    if (!task) return;

    if (e.target.closest(".delete")) deleteTask(task.id);
    else if (e.target.closest(".priority")) updateTask(task.id, { priority: task.priority === "high" ? "normal" : "high" });
    else if (e.target.classList.contains("title")) startEditing(li, task);
  });

  // Footer
  $("clearDone").addEventListener("click", clearCompleted);
  $("exportBtn").addEventListener("click", exportTasks);
  $("importInput").addEventListener("change", (e) => {
    if (e.target.files[0]) importTasks(e.target.files[0]);
    e.target.value = "";
  });

  // Toast undo
  $("toastUndo").addEventListener("click", () => {
    if (undoAction) undoAction();
    $("toast").hidden = true;
    undoAction = null;
  });

  // Pull fresh tasks whenever you come back to the app (e.g. switching from phone to computer)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && user && !pending) fetchTasks();
  });

  // Session handling
  db.auth.onAuthStateChange((_event, session) => {
    // Defer so Supabase finishes its own work before we query
    setTimeout(() => (session ? onSignedIn(session.user) : onSignedOut()), 0);
  });
}

init();
