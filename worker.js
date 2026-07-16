/*
 * Tick — a small, ephemeral checklist.
 * Routes:
 *   GET  /                      index of lists
 *   GET  /:slug                 a list (created on first write)
 *   GET  /api/lists             list index data (from KV metadata)
 *   GET  /api/list/:slug        list state
 *   PUT  /api/list/:slug        save list state (POST allowed for sendBeacon)
 *   DELETE /api/list/:slug      delete a list
 * Lists expire after TTL_DAYS without a write; any write refreshes the clock.
 */

const TTL_DAYS = 30;
const SLUG_RE = /^[a-z0-9-]{1,64}$/;

const STYLE = `<style>
  :root {
    --paper: #FBFBF9;
    --ink: #21272E;
    --blue: #2E4E7E;
    --muted: #9AA0A6;
    --done: #8B929B;
    --line: #E8E8E2;
    --danger: #A3452F;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html { height: 100%; }

  body {
    min-height: 100%;
    background: var(--paper);
    color: var(--ink);
    font-family: "Inter", system-ui, sans-serif;
    font-size: 1rem;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    display: flex;
    justify-content: center;
    padding: clamp(2rem, 8vh, 5rem) 1.25rem 4rem;
  }

  main { width: 100%; max-width: 33rem; }

  /* ---------- Header ---------- */

  header {
    margin-bottom: 0.75rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }

  .home {
    display: inline-block;
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-size: 0.95rem;
    color: var(--muted);
    text-decoration: none;
    margin-bottom: 0.35rem;
    border-radius: 4px;
  }
  .home:hover { color: var(--blue); }
  .home:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  #title, .brand {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-weight: 400;
    font-size: clamp(1.4rem, 4vw, 1.75rem);
    line-height: 1.15;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  #title { cursor: text; border-radius: 4px; }
  #title:hover { color: var(--blue); }
  #title:focus-visible { outline: 2px solid var(--blue); outline-offset: 4px; }

  #title-input {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-size: clamp(1.4rem, 4vw, 1.75rem);
    line-height: 1.15;
    color: var(--ink);
    background: none;
    border: none;
    border-bottom: 1px solid var(--blue);
    width: 100%;
    padding: 0;
  }
  #title-input:focus { outline: none; }

  #count {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    white-space: nowrap;
  }

  /* ---------- Rows ---------- */

  #list, #lists { list-style: none; }

  .item {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    padding: 0.8rem 0.25rem;
    border-bottom: 1px solid var(--line);
  }

  /* Checkbox */
  .check {
    appearance: none;
    -webkit-appearance: none;
    flex: none;
    width: 1.15rem;
    height: 1.15rem;
    margin-top: 0.2rem;
    border: 1.5px solid var(--muted);
    border-radius: 4px;
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }
  .check:hover { border-color: var(--blue); }
  .check:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
  .check::after {
    content: "";
    width: 0.55rem;
    height: 0.3rem;
    margin-top: -0.1rem;
    border-left: 2px solid var(--paper);
    border-bottom: 2px solid var(--paper);
    transform: rotate(-45deg) scale(0);
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .check:checked { border-color: var(--blue); background: var(--blue); }
  .check:checked::after { transform: rotate(-45deg) scale(1); }

  .text {
    flex: 1;
    min-width: 0;
    cursor: text;
    overflow-wrap: anywhere;
    border-radius: 4px;
    transition: color 0.3s ease;
  }
  .text:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }

  .item.done .text { color: var(--done); }

  .edit-input {
    flex: 1;
    min-width: 0;
    font: inherit;
    color: var(--ink);
    background: none;
    border: none;
    border-bottom: 1px solid var(--blue);
    padding: 0;
  }
  .edit-input:focus { outline: none; }

  .delete {
    flex: none;
    background: none;
    border: none;
    color: var(--muted);
    font-size: 1.1rem;
    line-height: 1;
    padding: 0.25rem 0.35rem;
    margin-top: 0.05rem;
    cursor: pointer;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s ease, color 0.15s ease;
  }
  .item:hover .delete, .delete:focus-visible { opacity: 1; }
  .delete:hover { color: var(--danger); }
  .delete:focus-visible { outline: 2px solid var(--blue); }
  @media (hover: none) { .delete { opacity: 0.45; } }

  .drag {
    flex: none;
    display: grid;
    place-items: center;
    background: none;
    border: none;
    color: var(--muted);
    padding: 0.25rem 0.2rem;
    margin-top: 0.15rem;
    cursor: grab;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;
    touch-action: none;
  }
  .item:hover .drag { opacity: 1; }
  .drag:active { cursor: grabbing; }
  .item.dragging { opacity: 0.55; background: #F3F3EE; pointer-events: none; }
  @media (hover: none) { .drag { opacity: 0.45; } }

  /* Completed items: controls stay subdued, matching the finished text */
  .item.done .drag, .item.done .delete { color: var(--done); }
  .item.done:hover .drag, .item.done:hover .delete,
  .item.done .drag:focus-visible, .item.done .delete:focus-visible { opacity: 0.5; }
  .item.done .delete:hover { color: var(--danger); }
  @media (hover: none) { .item.done .drag, .item.done .delete { opacity: 0.3; } }

  /* ---------- Index rows ---------- */

  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    text-decoration: none;
    color: var(--ink);
    border-radius: 4px;
  }
  .row:hover .list-title { color: var(--blue); }
  .row:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
  .list-title {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-size: 1.15rem;
    overflow-wrap: anywhere;
  }
  .list-count {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    white-space: nowrap;
  }

  /* ---------- Add row ---------- */

  .add-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.8rem 0.25rem;
  }
  .add-row .plus {
    flex: none;
    width: 1.15rem;
    height: 1.15rem;
    color: var(--muted);
    display: grid;
    place-items: center;
    font-size: 1.1rem;
    line-height: 1;
    user-select: none;
  }
  .add-row input {
    flex: 1;
    font: inherit;
    color: var(--ink);
    background: none;
    border: none;
    padding: 0;
  }
  .add-row input::placeholder { color: var(--muted); }
  .add-row input:focus { outline: none; }
  .add-row:focus-within .plus { color: var(--blue); }

  .empty {
    padding: 2.25rem 0.25rem;
    color: var(--muted);
    font-size: 0.9rem;
    text-align: center;
    border-bottom: 1px solid var(--line);
  }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; }
  }
</style>`;

const HEAD_COMMON = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Tick — a small, ephemeral checklist.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='4' y='4' width='24' height='24' rx='6' fill='%232E4E7E'/%3E%3Cpath d='M10.5 16.5l3.5 3.5 7-8' stroke='%23FBFBF9' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500&display=swap" rel="stylesheet">
${STYLE}`;

/* ---------------------------------------------------------------- */
/* Index page                                                        */
/* ---------------------------------------------------------------- */

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<title>Tick</title>
${HEAD_COMMON}
</head>
<body>
<main>
  <header>
    <div class="title-row">
      <h1 class="brand">Tick</h1>
    </div>
  </header>

  <ul id="lists"></ul>

  <div class="add-row">
    <span class="plus" aria-hidden="true">+</span>
    <input id="new-input" type="text" placeholder="Start a list…" autocomplete="off" aria-label="Start a list">
  </div>
</main>

<script>
(() => {
  let loaded = false;
  const listsEl = document.getElementById("lists");
  const input = document.getElementById("new-input");

  function slugify(v) {
    return v.toLowerCase().trim()
      .replace(/[^a-z0-9\\s-]/g, "")
      .replace(/[\\s-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  function render(lists) {
    listsEl.replaceChildren();

    if (!lists.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = loaded ? "Nothing here. Start a list below." : "Loading…";
      listsEl.appendChild(li);
      return;
    }

    for (const l of lists) {
      const li = document.createElement("li");
      li.className = "item";
      li.dataset.slug = l.slug;

      const a = document.createElement("a");
      a.className = "row";
      a.href = "/" + l.slug;

      const title = document.createElement("span");
      title.className = "list-title";
      title.textContent = l.title || l.slug;

      const count = document.createElement("span");
      count.className = "list-count";
      count.textContent = l.total ? l.done + " / " + l.total : "";

      a.append(title, count);

      const drag = document.createElement("button");
      drag.className = "drag";
      drag.tabIndex = -1;
      drag.setAttribute("aria-label", "Drag to reorder");
      drag.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

      const del = document.createElement("button");
      del.className = "delete";
      del.textContent = "\u00d7";
      del.setAttribute("aria-label", "Delete list: " + (l.title || l.slug));
      del.addEventListener("click", async () => {
        if (!confirm("Delete \u201c" + (l.title || l.slug) + "\u201d?")) return;
        await fetch("/api/list/" + encodeURIComponent(l.slug), { method: "DELETE" }).catch(() => {});
        load();
      });

      li.append(a, drag, del);
      listsEl.appendChild(li);
    }
  }

  function enableDrag(container, onCommit) {
    container.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(".drag");
      if (!handle) return;
      const li = handle.closest(".item");
      if (!li) return;
      e.preventDefault();
      li.classList.add("dragging");

      const move = (ev) => {
        ev.preventDefault();
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = over ? over.closest(".item") : null;
        if (!target || target === li || target.parentElement !== container) return;
        const rect = target.getBoundingClientRect();
        const before = ev.clientY < rect.top + rect.height / 2;
        container.insertBefore(li, before ? target : target.nextSibling);
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        li.classList.remove("dragging");
        onCommit();
      };
      // Listen on document, not the handle: moving the row via insertBefore
      // implicitly releases pointer capture, which would kill the drag
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  enableDrag(listsEl, () => {
    const order = [...listsEl.querySelectorAll(".item")]
      .map((li) => li.dataset.slug)
      .filter(Boolean);
    fetch("/api/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: order })
    }).catch(() => {});
  });

  async function load() {
    if (document.querySelector(".dragging")) return;
    try {
      const res = await fetch("/api/lists", { cache: "no-store" });
      const data = await res.json();
      loaded = true;
      render(Array.isArray(data.lists) ? data.lists : []);
    } catch {
      loaded = true;
      render([]);
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const raw = input.value.trim();
      const s = slugify(raw);
      if (s && s !== "api") location.href = "/" + s + "?t=" + encodeURIComponent(raw);
    }
    if (e.key === "Escape") input.value = "";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });

  // Back/forward-cache restores skip normal page load; refresh explicitly
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) load();
  });

  render([]);
  load();
})();
</script>
</body>
</html>`;

/* ---------------------------------------------------------------- */
/* List page                                                         */
/* ---------------------------------------------------------------- */

const LIST_HTML = `<!doctype html>
<html lang="en">
<head>
<title>Tick</title>
${HEAD_COMMON}
</head>
<body>
<main>
  <header>
    <a class="home" href="/">Tick</a>
    <div class="title-row">
      <h1 id="title" tabindex="0" title="Click to rename"></h1>
      <span id="count" aria-live="polite"></span>
    </div>
  </header>

  <ul id="list"></ul>

  <div class="add-row">
    <span class="plus" aria-hidden="true">+</span>
    <input id="add-input" type="text" placeholder="Add an item…" autocomplete="off" aria-label="Add an item">
  </div>
</main>

<script>
(() => {
  const slug = decodeURIComponent(location.pathname.slice(1)).toLowerCase();
  const API = "/api/list/" + encodeURIComponent(slug);

  // Title exactly as typed on the index page, carried over once via ?t=
  const createdTitle = new URLSearchParams(location.search).get("t");
  if (createdTitle !== null) history.replaceState(null, "", location.pathname);

  function defaultTitle() {
    if (createdTitle && createdTitle.trim()) return createdTitle.trim().slice(0, 200);
    const s = slug.replace(/-+/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Today";
  }

  let state = { title: defaultTitle(), items: [] };
  let loaded = false;
  let saveTimer = null;

  const $ = (sel) => document.querySelector(sel);
  const listEl = $("#list");
  const titleEl = $("#title");
  const countEl = $("#count");
  const addInput = $("#add-input");

  /* ---------- Sync ---------- */

  async function loadRemote() {
    if (document.querySelector(".dragging")) return;
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.items)) state = data;
      } else if (res.status === 404 && createdTitle !== null) {
        // Just created from the index: persist via the debounced save so
        // it coalesces with a quickly-added first item into one write
        save();
      }
    } catch { /* offline: keep what we have */ }
    loaded = true;
    render();
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fetch(API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state)
      }).catch(() => {});
    }, 400);
  }

  // Refresh when the tab comes back into focus (unless mid-edit)
  document.addEventListener("visibilitychange", () => {
    const editing = document.querySelector(".edit-input, #title-input");
    if (document.visibilityState === "visible" && !editing && !saveTimer) loadRemote();
  });

  // Flush a pending write if the page is closed before the debounce fires
  window.addEventListener("pagehide", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      navigator.sendBeacon(API, new Blob([JSON.stringify(state)], { type: "application/json" }));
    }
  });

  // Back/forward-cache restores skip normal page load; refresh explicitly
  window.addEventListener("pageshow", (e) => {
    const editing = document.querySelector(".edit-input, #title-input");
    if (e.persisted && !editing && !saveTimer) loadRemote();
  });

  /* ---------- Render ---------- */

  function render() {
    titleEl.textContent = state.title;
    document.title = state.title + " — Tick";

    listEl.replaceChildren();

    if (state.items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = loaded ? "Nothing yet. Add your first item below." : "Loading…";
      listEl.appendChild(li);
    }

    for (const item of state.items) {
      const li = document.createElement("li");
      li.className = "item" + (item.done ? " done" : "");
      li.dataset.id = item.id;

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "check";
      check.checked = item.done;
      check.setAttribute("aria-label", (item.done ? "Uncheck: " : "Check off: ") + item.text);
      check.addEventListener("change", () => toggle(item.id));

      const text = document.createElement("span");
      text.className = "text";
      text.textContent = item.text;
      text.tabIndex = 0;
      text.title = "Click to edit";
      text.addEventListener("click", () => startEdit(li, item));
      text.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); startEdit(li, item); }
      });

      const drag = document.createElement("button");
      drag.className = "drag";
      drag.tabIndex = -1;
      drag.setAttribute("aria-label", "Drag to reorder");
      drag.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

      const del = document.createElement("button");
      del.className = "delete";
      del.textContent = "\u00d7";
      del.setAttribute("aria-label", "Delete: " + item.text);
      del.addEventListener("click", () => remove(item.id));

      li.append(check, text, drag, del);
      listEl.appendChild(li);
    }

    const done = state.items.filter(i => i.done).length;
    const total = state.items.length;
    countEl.textContent = total ? done + " / " + total : "";
  }

  /* ---------- Actions ---------- */

  function add(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    state.items.push({ id: crypto.randomUUID(), text: trimmed, done: false });
    save();
    render();
  }

  function toggle(id) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    item.done = !item.done;
    save();
    render();
  }

  function remove(id) {
    state.items = state.items.filter(i => i.id !== id);
    save();
    render();
  }

  function startEdit(li, item) {
    const textEl = li.querySelector(".text");
    if (!textEl) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-input";
    input.value = item.text;
    input.setAttribute("aria-label", "Edit item");
    textEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    let cancelled = false;
    const commit = () => {
      const next = input.value.trim();
      if (!cancelled && next) item.text = next;
      save();
      render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { cancelled = true; input.blur(); }
    });
    input.addEventListener("blur", commit);
  }

  /* ---------- Title editing ---------- */

  function startTitleEdit() {
    const input = document.createElement("input");
    input.id = "title-input";
    input.type = "text";
    input.value = state.title;
    input.setAttribute("aria-label", "List title");
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let cancelled = false;
    const commit = () => {
      const next = input.value.trim();
      if (!cancelled && next) state.title = next;
      save();
      input.replaceWith(titleEl);
      render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { cancelled = true; input.blur(); }
    });
    input.addEventListener("blur", commit);
  }

  titleEl.addEventListener("click", startTitleEdit);
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); startTitleEdit(); }
  });

  /* ---------- Add ---------- */

  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { add(addInput.value); addInput.value = ""; }
    if (e.key === "Escape") addInput.value = "";
  });

  /* ---------- Reorder ---------- */

  function enableDrag(container, onCommit) {
    container.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(".drag");
      if (!handle) return;
      const li = handle.closest(".item");
      if (!li) return;
      e.preventDefault();
      li.classList.add("dragging");

      const move = (ev) => {
        ev.preventDefault();
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = over ? over.closest(".item") : null;
        if (!target || target === li || target.parentElement !== container) return;
        const rect = target.getBoundingClientRect();
        const before = ev.clientY < rect.top + rect.height / 2;
        container.insertBefore(li, before ? target : target.nextSibling);
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        li.classList.remove("dragging");
        onCommit();
      };
      // Listen on document, not the handle: moving the row via insertBefore
      // implicitly releases pointer capture, which would kill the drag
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  enableDrag(listEl, () => {
    const order = [...listEl.querySelectorAll(".item")].map((li) => li.dataset.id);
    state.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    save();
    render();
  });

  render();
  loadRemote();
})();
</script>
</body>
</html>`;

/* ---------------------------------------------------------------- */
/* Worker                                                            */
/* ---------------------------------------------------------------- */

function isValid(data) {
  return (
    data &&
    typeof data.title === "string" &&
    data.title.length <= 200 &&
    Array.isArray(data.items) &&
    data.items.length <= 500 &&
    data.items.every(
      (i) =>
        i &&
        typeof i.id === "string" &&
        typeof i.text === "string" &&
        i.text.length <= 1000 &&
        typeof i.done === "boolean"
    )
  );
}

function listMetadata(data) {
  return {
    title: data.title.slice(0, 100),
    done: data.items.filter((i) => i.done).length,
    total: data.items.length,
    updated: Date.now()
  };
}

const json = (body) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

const html = (body) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Index data
    if (path === "/api/lists") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const [result, orderRaw] = await Promise.all([
        env.TICK_KV.list({ prefix: "list:" }),
        env.TICK_KV.get("order")
      ]);
      let order = [];
      try {
        const parsed = JSON.parse(orderRaw);
        if (Array.isArray(parsed)) order = parsed;
      } catch { /* no saved order */ }
      const pos = new Map(order.map((s, i) => [s, i]));
      const lists = result.keys
        .map((k) => ({ slug: k.name.slice(5), ...(k.metadata || {}) }))
        .sort((a, b) => {
          const ha = pos.has(a.slug);
          const hb = pos.has(b.slug);
          if (ha && hb) return pos.get(a.slug) - pos.get(b.slug);
          if (ha !== hb) return ha ? 1 : -1; // unordered (new) lists float to the top
          return (b.updated || 0) - (a.updated || 0);
        });
      return json({ lists });
    }

    // Manual list ordering
    if (path === "/api/order") {
      if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
      let data;
      try {
        data = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const order = data && data.order;
      if (
        !Array.isArray(order) ||
        order.length > 500 ||
        !order.every((s) => typeof s === "string" && SLUG_RE.test(s))
      ) {
        return new Response("Invalid payload", { status: 400 });
      }
      await env.TICK_KV.put("order", JSON.stringify(order));
      return new Response(null, { status: 204 });
    }

    // List API
    const api = path.match(/^\/api\/list\/([^/]+)$/);
    if (api) {
      const slug = decodeURIComponent(api[1]).toLowerCase();
      if (!SLUG_RE.test(slug)) return new Response("Invalid list name", { status: 400 });
      const key = "list:" + slug;

      if (request.method === "GET") {
        const data = await env.TICK_KV.get(key);
        if (data === null) return new Response("Not found", { status: 404 });
        return new Response(data, {
          headers: { "content-type": "application/json", "cache-control": "no-store" }
        });
      }

      // PUT from the app; POST allowed for the sendBeacon flush on page close
      if (request.method === "PUT" || request.method === "POST") {
        let data;
        try {
          data = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!isValid(data)) return new Response("Invalid payload", { status: 400 });
        await env.TICK_KV.put(key, JSON.stringify(data), {
          expirationTtl: TTL_DAYS * 86400,
          metadata: listMetadata(data)
        });
        return new Response(null, { status: 204 });
      }

      if (request.method === "DELETE") {
        await env.TICK_KV.delete(key);
        return new Response(null, { status: 204 });
      }

      return new Response("Method not allowed", { status: 405 });
    }

    // Pages
    if (path === "/") return html(INDEX_HTML);

    const page = path.match(/^\/([^/]+)$/);
    if (page) {
      const slug = decodeURIComponent(page[1]).toLowerCase();
      if (SLUG_RE.test(slug) && slug !== "api") return html(LIST_HTML);
    }

    return new Response("Not found", { status: 404 });
  }
};
