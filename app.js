// ============================================================
// To-Do App
// Tasks are saved in the browser (localStorage), so they stay
// between visits on the same computer and browser.
// ============================================================

// ---- Settings you can change ----
const LISTS = ["Work", "Personal", "Errands"];   // edit these names to suit you
const STORAGE_KEY = "todo-app.tasks";

// ---- State ----
let tasks = loadTasks();
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

// ---- Storage ----
function loadTasks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    showToast("Couldn't save. Your browser may be blocking storage.");
  }
}

// ---- Task actions ----
function addTask({ title, due, priority, list }) {
  tasks.push({ id: newId(), title, due, priority, list, done: false, createdAt: Date.now(), doneAt: null });
  saveTasks();
  render();
}

function updateTask(id, changes) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, changes);
  saveTasks();
  render();
}

function deleteTask(id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = tasks.splice(index, 1);
  saveTasks();
  render();
  showToast("Task deleted.", () => {
    tasks.splice(index, 0, removed);
    saveTasks();
    render();
  });
}

function clearCompleted() {
  const removed = tasks.filter((t) => t.done);
  if (!removed.length) return;
  tasks = tasks.filter((t) => !t.done);
  saveTasks();
  render();
  showToast(`Cleared ${removed.length} completed task${removed.length === 1 ? "" : "s"}.`, () => {
    tasks.push(...removed);
    saveTasks();
    render();
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
  if (task.due) tags.push(`<span class="tag ${dueClass}">${formatDue(task.due)}</span>`);
  if (task.priority === "high") tags.push(`<span class="tag high">High</span>`);
  if (task.priority === "low") tags.push(`<span class="tag">Low</span>`);
  if (task.list) tags.push(`<span class="tag">${escapeHTML(task.list)}</span>`);

  const classes = ["task"];
  if (task.done) classes.push("done");
  if (task.priority === "high" && !task.done) classes.push("high");

  return `
    <li class="${classes.join(" ")}" data-id="${task.id}">
      <input type="checkbox" ${task.done ? "checked" : ""} aria-label="Mark done">
      <div class="body">
        <div class="title" title="Click to edit">${escapeHTML(task.title)}</div>
        <div class="meta">${tags.join("")}</div>
      </div>
      <div class="actions">
        <button class="icon-btn priority" title="Toggle high priority" aria-label="Toggle high priority">&#9873;</button>
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
      const added = data.filter((t) => t && t.title && !existing.has(t.id));
      tasks.push(...added.map((t) => ({ id: t.id || newId(), ...t })));
      saveTasks();
      render();
      showToast(`Imported ${added.length} task${added.length === 1 ? "" : "s"}.`);
    } catch {
      showToast("That file isn't a valid task export.");
    }
  };
  reader.readAsText(file);
}

// ---- Setup ----
function init() {
  $("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  $("listInput").innerHTML = LISTS.map((l) => `<option>${escapeHTML(l)}</option>`).join("");
  $("listFilter").innerHTML = `<option value="">All lists</option>` +
    LISTS.map((l) => `<option>${escapeHTML(l)}</option>`).join("");

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

  render();
}

init();
