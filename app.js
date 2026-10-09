"use strict";
const $ = (s, el = document) => el.querySelector(s);
const PHASES = ["1. Get things going (oven, boiling, long cooks)", "2. Prep & chop", "3. Cook", "4. Cool, portion & pack"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------- state (saved in localStorage) ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
// plan used to be { id: portions }; it is now { id: { portions, days: { Mon: meals, ... } } }
const migratePlan = p => {
  const out = {};
  for (const [id, v] of Object.entries(p && typeof p === "object" ? p : {})) {
    if (typeof v === "number") out[id] = { portions: Math.max(1, v), days: {} };
    else if (v && typeof v.portions === "number") out[id] = { portions: Math.max(1, v.portions), days: v.days && typeof v.days === "object" ? v.days : {} };
  }
  return out;
};
const state = {
  custom: load("sp.custom", []),          // user-added recipes
  plan: migratePlan(load("sp.plan", {})), // { recipeId: { portions, days } }
  checked: load("sp.checked", {}),        // shopping, ingredient and cooking ticks
  fav: load("sp.fav", {}),                // { recipeId: true }
  timers: load("sp.timers", {}),          // { stepId: end timestamp (ms) }
  tab: "recipes",
  search: "",                             // recipe search text
  favOnly: false,                         // show only favourites
  serv: {},                               // { recipeId: servings shown on recipe card }
  open: {},                               // { recipeId: true } expanded recipe cards
  suggest: null,                          // notes shown after "Suggest a plan"
  tmin: {},                               // { stepId: minutes chosen before starting a timer }
};
const save = () => {
  try {
    for (const k of ["custom", "plan", "checked", "fav", "timers"]) localStorage.setItem("sp." + k, JSON.stringify(state[k]));
  } catch { /* storage unavailable */ }
};
const allRecipes = () => [...STARTER_RECIPES, ...state.custom];
const byId = id => allRecipes().find(r => r.id === id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const planned = () => Object.entries(state.plan).map(([id, v]) => ({ r: byId(id), portions: v.portions, days: v.days })).filter(x => x.r);
const scale = x => x.portions / x.r.servings;
const assigned = days => Object.values(days).reduce((a, b) => a + b, 0);

// ---------- how long cooked food lasts ----------
// Cooking happens on Sunday evening, so Mon is 1 day later, Sun is 7 days later.
const fridgeDays = r => (Number(r.fridgeDays) > 0 ? Number(r.fridgeDays) : 2);
const dayAge = d => DAYS.indexOf(d) + 1;
const dayRange = (from, to) => (from === to ? DAYS[from - 1] : `${DAYS[from - 1]}–${DAYS[to - 1]}`);
function shelfHtml(x) {
  const fd = Math.min(fridgeDays(x.r), 7), frz = x.r.freezable;
  const late = Object.entries(x.days).filter(([d]) => dayAge(d) > fd).sort((a, b) => dayAge(a[0]) - dayAge(b[0]));
  const lateMeals = late.reduce((s, [, n]) => s + n, 0), a = assigned(x.days), open = x.portions - a;
  const lines = [`Keeps ${fd} day${fd > 1 ? "s" : ""} in the fridge (${dayRange(1, fd)}).`];
  let cls = "ok";
  if (lateMeals) {
    if (frz === true) { cls = "freeze"; lines.push(`❄ Freeze ${lateMeals} portion${lateMeals > 1 ? "s" : ""} on Sunday night for ${late.map(([d, n]) => `${d} (${n})`).join(", ")}, and move each to the fridge the night before.`); }
    else { cls = "bad"; lines.push(`⚠ ${lateMeals} meal${lateMeals > 1 ? "s" : ""} (${late.map(([d]) => d).join(", ")}) fall after the fridge limit${frz === false ? " and this recipe isn't marked as freezable" : " and I don't know if this can be frozen"}. Cook a second batch mid-week or pick another recipe for those days.`); }
  } else if (a) lines.push("✅ Every meal you've assigned is within the fridge limit.");
  if (open > 0) lines.push(`${open} cooked meal${open > 1 ? "s" : ""} not given a day yet.`);
  else if (open < 0) lines.push(`You've given days to ${-open} more meal${-open > 1 ? "s" : ""} than you're cooking.`);
  if (!a) lines.push(frz === true ? "To cover the whole week you can eat the first " + fd + " days fresh and freeze the rest." : "Give it some days below to check it lasts.");
  return `<div class="shelf ${cls}">${lines.map(l => `<div>${l}</div>`).join("")}</div>`;
}

// One meal a day, Mon–Sun, from the recipes already in the plan.
// Fresh days (inside the fridge limit) go to recipes that can't be frozen or freeze less well;
// later days come from the freezer, favouring recipes whose notes say they freeze well.
function suggestPlan() {
  const items = planned();
  const tier = r => (r.freezable !== true ? 0 : r.freezesWell ? 2 : 1);
  const count = {}, days = {}, notes = [], fresh = [], frozen = [];
  items.forEach(x => { count[x.r.id] = 0; days[x.r.id] = {}; });
  let prev = null;
  DAYS.forEach((d, i) => {
    const age = i + 1;
    let pool = items.filter(x => fridgeDays(x.r) >= age).sort((a, b) => tier(a.r) - tier(b.r) || count[a.r.id] - count[b.r.id]);
    const isFresh = pool.length > 0;
    if (!isFresh) {
      const w = x => count[x.r.id] / (x.r.freezesWell ? 2 : 1);
      pool = items.filter(x => x.r.freezable === true).sort((a, b) => w(a) - w(b) || tier(b.r) - tier(a.r));
    }
    if (!pool.length) { notes.push(`${d}: nothing in your selection can be frozen to cover this day.`); return; }
    const pick = pool.find(x => x.r.id !== prev) || pool[0];
    days[pick.r.id][d] = 1; count[pick.r.id]++; prev = pick.r.id;
    (isFresh ? fresh : frozen).push(`${d} ${pick.r.name}`);
  });
  items.forEach(x => {
    const n = count[x.r.id];
    state.plan[x.r.id].days = days[x.r.id];
    if (n) state.plan[x.r.id].portions = n;
    else notes.push(`${x.r.name} wasn't needed, so it has no days. Remove it from the plan or add days yourself.`);
  });
  if (fresh.length) notes.unshift(`Fresh from the fridge: ${fresh.join(", ")}.`);
  if (frozen.length) notes.splice(fresh.length ? 1 : 0, 0, `From the freezer: ${frozen.join(", ")}.`);
  state.suggest = notes;
}

// ---------- recipes tab ----------
const round = (n, unit) => (unit === "g" || unit === "ml" ? Math.round(n) : Math.round(n * 100) / 100);
// q is a number or [low, high]; f scales it
const qtyText = (q, f, unit) => {
  const [lo, hi] = Array.isArray(q) ? q : [q, q];
  const a = round(lo * f, unit), b = round(hi * f, unit);
  return a === b ? String(a) : `${a}–${b}`;
};
const amountText = (q, unit, f) => `${qtyText(q, f, unit)}${unit ? (unit === "g" || unit === "ml" ? "" : " ") + esc(unit) : ""}`;

const ingredientRow = (r, i, idx, f) => {
  const [q, unit, name] = i, id = `ck:${r.id}:${idx}`, done = state.checked[id];
  const text = q == null ? esc(name) : `${amountText(q, unit, f)} ${esc(name)}`;
  return `<label class="check ${done ? "done" : ""}"><input type="checkbox" data-check="${esc(id)}" ${done ? "checked" : ""}><span>${text}</span></label>`;
};
const servingsFor = r => state.serv[r.id] || r.servings;
const matches = r => {
  if (state.favOnly && !state.fav[r.id]) return false;
  const q = state.search.trim().toLowerCase();
  if (!q) return true;
  const hay = [r.name, ...(r.tags || []), ...r.ingredients.map(i => i[2])].join(" ").toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
};

function cardsHtml() {
  const list = allRecipes().filter(matches);
  if (!list.length) {
    const msg = !allRecipes().length ? "No recipes yet. Add your first one below."
      : state.favOnly && !Object.keys(state.fav).length ? "No favourites yet. Tap ☆ on a recipe."
      : "No recipes match.";
    return `<div class="empty">${msg}</div>`;
  }
  return list.map(r => {
    const rid = esc(r.id), inPlan = r.id in state.plan, n = servingsFor(r), f = n / r.servings, fav = state.fav[r.id];
    const rows = r.ingredients.map((i, idx) => [i, idx]);
    const main = rows.filter(([i]) => !i[4]), opt = rows.filter(([i]) => i[4]);
    return `<div class="card">
      <div class="row between"><h3>${esc(r.name)}</h3>
        <div class="row">
          <button class="btn star ${fav ? "on" : ""}" data-act="fav" data-id="${rid}" aria-label="${fav ? "Remove favourite" : "Add favourite"}">${fav ? "★" : "☆"}</button>
          <button class="btn ${inPlan ? "" : "primary"}" data-act="toggle" data-id="${rid}">${inPlan ? "✓ In plan" : "+ Add to plan"}</button></div></div>
      <div class="meta">${r.servings} servings · ~${r.minutes} min · fridge ${fridgeDays(r)} days${r.freezable ? " · freezable" : ""} ${(r.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      <details data-open="${rid}" ${state.open[r.id] ? "open" : ""}><summary>Ingredients &amp; steps</summary>
        <div class="row stepper"><b>Ingredients for</b>
          <button class="btn" data-act="sdec" data-id="${rid}" aria-label="Fewer servings">−</button>
          <b>${n}</b>
          <button class="btn" data-act="sinc" data-id="${rid}" aria-label="More servings">+</button>
          <span class="meta">servings</span></div>
        <div>${main.map(([i, idx]) => ingredientRow(r, i, idx, f)).join("")}</div>
        ${opt.length ? `<div class="meta">Optional</div><div>${opt.map(([i, idx]) => ingredientRow(r, i, idx, f)).join("")}</div>` : ""}
        <p><button class="btn" data-act="clear" data-prefix="ck:${rid}:">Untick ingredients</button></p>
        <h4>Method</h4>
        <ol>${r.steps.map(s => `<li>${esc(s.t)}</li>`).join("")}</ol>
        ${r.storage ? `<div class="storage"><h4>Storage &amp; reheating</h4><ul>${r.storage.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
        ${r.custom ? `<button class="btn danger" data-act="delete" data-id="${rid}">Delete recipe</button>` : ""}
      </details></div>`;
  }).join("");
}

function recipesView() {
  return `<div class="row searchrow">
      <input type="search" id="search" placeholder="Search: chicken, bbq, pasta..." value="${esc(state.search)}">
      <button class="btn ${state.favOnly ? "primary" : ""}" data-act="favonly">${state.favOnly ? "★" : "☆"} Favourites</button></div>
    <div id="cards">${cardsHtml()}</div>
    <details class="card" ${allRecipes().length ? "" : "open"}><summary>+ Add your own recipe</summary>
    <form id="addForm">
      <label>Name</label><input name="name" required>
      <label>Servings it makes</label><input name="servings" type="number" min="1" value="4" required>
      <label>Total minutes</label><input name="minutes" type="number" min="1" value="45" required>
      <label>Keeps in the fridge (days)</label><input name="fridgeDays" type="number" min="1" max="7" value="2" required>
      <label class="check"><input type="checkbox" name="freezable" checked><span>Can be frozen</span></label>
      <label>Ingredients (one per line: <i>qty unit name</i>, e.g. "200 g chicken")</label>
      <textarea name="ingredients" rows="5" required></textarea>
      <label>Steps (one per line; start with <b>start:</b>, <b>prep:</b>, <b>cook:</b> or <b>pack:</b> to place it in the timeline)</label>
      <textarea name="steps" rows="5" required></textarea>
      <p><button class="btn primary">Save recipe</button></p>
    </form></details>
    <details class="card"><summary>Backup &amp; restore</summary>
      <p class="meta">Your recipes, plan, ticks and favourites are stored only in this browser. Export a file to back them up or move them to another device.</p>
      <div class="row"><button class="btn" data-act="export">Export backup</button>
        <button class="btn" data-act="import">Import backup</button>
        <input type="file" id="importFile" accept="application/json,.json" hidden></div>
    </details>`;
}

// ---------- plan tab ----------
function planView() {
  const items = planned();
  if (!items.length) return `<div class="empty">Nothing planned yet.<br>Add recipes from the Recipes tab.</div>`;
  const total = items.reduce((s, x) => s + x.portions, 0);
  const batches = items.map(x => {
    const a = assigned(x.days), rid = esc(x.r.id);
    return `<div class="card"><div class="row between">
      <div class="grow"><h3>${esc(x.r.name)}</h3>
        <div class="meta ${a > x.portions ? "warn" : ""}">${a} of ${x.portions} meals given a day</div></div>
      <div class="row">
        <button class="btn" data-act="dec" data-id="${rid}" aria-label="Cook fewer">−</button>
        <b>${x.portions}</b> <span class="meta">meals</span>
        <button class="btn" data-act="inc" data-id="${rid}" aria-label="Cook more">+</button>
        <button class="btn danger" data-act="toggle" data-id="${rid}" aria-label="Remove from plan">✕</button>
      </div></div>${shelfHtml(x)}</div>`;
  }).join("");
  const week = DAYS.map(d => {
    const here = items.filter(x => x.days[d]);
    return `<div class="card day"><div class="row between"><b>${d}</b><span class="meta">${here.reduce((s, x) => s + x.days[d], 0)} meals</span></div>
      ${here.map(x => `<div class="row between chip"><span>${esc(x.r.name)}${dayAge(d) > fridgeDays(x.r) ? (x.r.freezable ? ' <span class="tag">❄ from freezer</span>' : ' <span class="tag bad">⚠ past fridge limit</span>') : ""}</span><span class="row">
        <button class="btn" data-act="daydec" data-id="${esc(x.r.id)}" data-day="${d}" aria-label="One less">−</button><b>${x.days[d]}</b>
        <button class="btn" data-act="dayinc" data-id="${esc(x.r.id)}" data-day="${d}" aria-label="One more">+</button></span></div>`).join("")}
      <select data-dayadd="${d}" aria-label="Add a meal on ${d}"><option value="">+ Add a meal…</option>
        ${items.map(x => `<option value="${esc(x.r.id)}">${esc(x.r.name)}</option>`).join("")}</select></div>`;
  }).join("");
  const suggest = `<div class="row"><button class="btn primary" data-act="suggest">✨ Suggest a plan (1 meal a day)</button></div>
    <p class="meta">Spreads the recipes above over Mon–Sun, one meal a day, and sets how many of each to cook.</p>
    ${state.suggest ? `<div class="shelf freeze">${state.suggest.map(n => `<div>${esc(n)}</div>`).join("")}</div>` : ""}`;
  return `${suggest}<p class="meta">${total} meals cooked this week.</p>${batches}<h2>This week</h2>${week}`;
}

// ---------- shopping tab ----------
function shopView() {
  const items = planned();
  if (!items.length) return `<div class="empty">Plan some recipes to build your shopping list.</div>`;
  const agg = {};
  for (const x of items) {
    const f = scale(x);
    x.r.ingredients.forEach(([q, u, n, aisle, opt]) => {
      const key = `${opt ? "opt" : "main"}|${n.toLowerCase()}|${u}`;
      const e = (agg[key] ??= { n, u, lo: 0, hi: 0, has: false, aisle: opt ? "Optional" : aisle || "Other" });
      if (q != null) { const [lo, hi] = Array.isArray(q) ? q : [q, q]; e.lo += lo * f; e.hi += hi * f; e.has = true; }
    });
  }
  const groups = {};
  for (const [key, v] of Object.entries(agg)) (groups[v.aisle] ??= []).push([key, v]);
  const order = a => (a === "Optional" ? "~" : a);
  const html = Object.keys(groups).sort((a, b) => order(a).localeCompare(order(b))).map(a => `<h2>${esc(a)}</h2>` +
    groups[a].sort((x, y) => x[1].n.localeCompare(y[1].n)).map(([key, v]) => {
      const id = "shop:" + key, done = state.checked[id];
      const text = v.has ? `${amountText([v.lo, v.hi], v.u, 1)} ${esc(v.n)}` : esc(v.n);
      return `<label class="check ${done ? "done" : ""}"><input type="checkbox" data-check="${esc(id)}" ${done ? "checked" : ""}><span>${text}</span></label>`;
    }).join("")).join("");
  return `<p class="meta">Scaled to the meals you're cooking. Optional items aren't needed unless you want them.</p>${html}
    <p><button class="btn" data-act="clear" data-prefix="shop:">Clear ticks</button></p>`;
}

// ---------- cook tab (with timers) ----------
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const stepInfo = id => { const [, rid, i] = id.split(":"); const r = byId(rid); return r && r.steps[+i] ? { r, s: r.steps[+i] } : null; };

function timerHtml(s) {
  if (!s.timer) return "";
  const end = state.timers[s.id], id = esc(s.id);
  if (end) {
    const left = end - Date.now();
    return left > 0
      ? `<div class="row timer"><span class="timerchip">⏱ <b data-timer="${id}">${clock(left)}</b></span><button class="btn" data-act="tcancel" data-id="${id}">Cancel</button></div>`
      : `<div class="row timer"><span class="timerchip done">⏰ Time's up!</span><button class="btn" data-act="tcancel" data-id="${id}">Dismiss</button></div>`;
  }
  const m = state.tmin[s.id] ?? s.timer;
  return `<div class="row timer"><button class="btn" data-act="tless" data-id="${id}" aria-label="One minute less">−</button>
    <button class="btn primary" data-act="tstart" data-id="${id}">⏱ Start ${m} min</button>
    <button class="btn" data-act="tmore" data-id="${id}" aria-label="One minute more">+</button></div>`;
}

function cookView() {
  const items = planned();
  if (!items.length) return `<div class="empty">Plan some recipes to get a Sunday cooking timeline.</div>`;
  const steps = [];
  for (const x of items) x.r.steps.forEach((s, i) => steps.push({ ...s, name: x.r.name, id: `cook:${x.r.id}:${i}` }));
  const done = steps.filter(s => state.checked[s.id]).length;
  const mins = steps.reduce((s, x) => s + x.m, 0);
  let html = `<p class="meta">${steps.length} steps · ${done} done · ~${Math.round(mins / 60 * 10) / 10} h of work if done back to back (less when oven/stove tasks overlap)</p>
    <div class="progress"><div style="width:${done / steps.length * 100}%"></div></div>
    <p class="meta">Timers beep only while this page is open, so keep the tab visible.</p>`;
  PHASES.forEach((title, p) => {
    const list = steps.filter(s => s.p === p);
    if (!list.length) return;
    html += `<h2>${title}</h2>` + list.map(s => `<div class="step">
      <label class="check ${state.checked[s.id] ? "done" : ""}"><input type="checkbox" data-check="${esc(s.id)}" ${state.checked[s.id] ? "checked" : ""}>
      <span><b>${esc(s.name)}:</b> ${esc(s.t)}${s.m ? ` <span class="meta">(${s.m} min)</span>` : ""}</span></label>${timerHtml(s)}</div>`).join("");
  });
  return html + `<p><button class="btn" data-act="clear" data-prefix="cook:">Reset for next Sunday</button></p>`;
}

const views = { recipes: recipesView, plan: planView, shop: shopView, cook: cookView };

function render() {
  $("#view").innerHTML = views[state.tab]();
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
  const n = Object.keys(state.plan).length;
  $("#planCount").textContent = n ? `(${n})` : "";
}

// ---------- timer ticking, beep and toast ----------
let actx;
const audio = () => {
  try { actx ??= new (window.AudioContext || window.webkitAudioContext)(); actx.resume && actx.resume(); } catch { /* no audio */ }
  return actx;
};
function beep() {
  const c = audio();
  if (c) [0, 0.35, 0.7].forEach(t => {
    const o = c.createOscillator(), g = c.createGain(), at = c.currentTime + t;
    o.frequency.value = 880; o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.2, at); o.start(at); o.stop(at + 0.2);
  });
  if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
}
function toast(text) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = text; t.onclick = () => t.remove();
  document.body.appendChild(t);
}
const rang = new Set(Object.entries(state.timers).filter(([, end]) => end <= Date.now()).map(([id]) => id));
setInterval(() => {
  let finished = false;
  for (const [id, end] of Object.entries(state.timers)) {
    const left = end - Date.now();
    if (left > 0) { document.querySelectorAll("[data-timer]").forEach(el => { if (el.dataset.timer === id) el.textContent = clock(left); }); continue; }
    if (rang.has(id)) continue;
    rang.add(id); finished = true; beep();
    const info = stepInfo(id);
    toast(`⏰ Timer done${info ? ` – ${info.r.name}: ${info.s.t}` : ""} (tap to dismiss)`);
  }
  if (finished && state.tab === "cook") render();
}, 1000);

// ---------- backup ----------
const validRecipe = r => r && typeof r === "object" && typeof r.id === "string" && typeof r.name === "string" &&
  Number(r.servings) > 0 && Array.isArray(r.ingredients) && Array.isArray(r.steps) &&
  r.ingredients.every(i => Array.isArray(i) && typeof i[2] === "string" && (i[0] == null || typeof i[0] === "number" || (Array.isArray(i[0]) && i[0].every(Number.isFinite)))) &&
  r.steps.every(s => s && typeof s.t === "string");

function exportBackup() {
  const data = { app: "sunday-prep", version: 1, custom: state.custom, plan: state.plan, checked: state.checked, fav: state.fav };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = "sunday-prep-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d || d.app !== "sunday-prep") throw new Error("not a backup");
    if (!confirm("Replace your saved recipes, plan, ticks and favourites with this backup?")) return;
    state.custom = (Array.isArray(d.custom) ? d.custom : []).filter(validRecipe).map(r => ({ ...r, custom: true }));
    state.plan = migratePlan(d.plan);
    state.checked = d.checked && typeof d.checked === "object" ? d.checked : {};
    state.fav = d.fav && typeof d.fav === "object" ? d.fav : {};
    save(); render();
  } catch { alert("That file isn't a valid Sunday Prep backup."); }
}

// ---------- events ----------
function parseIngredient(line) {
  const m = line.trim().match(/^([\d./]+)\s*(\S+)?\s*(.*)$/);
  if (!m) return [1, "", line.trim(), "Other"];
  let q = m[1].includes("/") ? m[1].split("/").reduce((a, b) => a / b) : parseFloat(m[1]);
  const units = /^(g|kg|ml|l|tsp|tbsp|cup|cups|cans?|cloves?|oz|lb|pinch)$/i;
  let u = "", n = m[3];
  if (m[2] && units.test(m[2])) u = m[2]; else n = [m[2], m[3]].filter(Boolean).join(" ");
  return [q || 1, u, n || line.trim(), "Other"];
}
function parseStep(line) {
  const m = line.match(/^(start|prep|cook|pack):\s*(.*)$/i);
  const p = m ? { start: 0, prep: 1, cook: 2, pack: 3 }[m[1].toLowerCase()] : 2;
  return { p, t: (m ? m[2] : line).trim(), m: 0 };
}
const stepTimerMinutes = id => { const info = stepInfo(id); return state.tmin[id] ?? (info && info.s.timer) ?? 5; };

document.addEventListener("click", e => {
  const tab = e.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; render(); return; }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const { act, id, day } = b.dataset, r = byId(id), p = state.plan[id];
  if (act === "suggest") {
    if (planned().some(x => assigned(x.days)) && !confirm("Replace the days you've already set?")) return;
    suggestPlan(); save(); render(); return;
  }
  state.suggest = null;
  if (act === "export") { exportBackup(); return; }
  if (act === "import") { $("#importFile").click(); return; }
  if (act === "favonly") state.favOnly = !state.favOnly;
  if (act === "fav") state.fav[id] ? delete state.fav[id] : (state.fav[id] = true);
  if (act === "toggle") { p ? delete state.plan[id] : (state.plan[id] = { portions: r.servings, days: {} }); }
  if (act === "sinc") state.serv[id] = Math.min(24, servingsFor(r) + 1);
  if (act === "sdec") state.serv[id] = Math.max(1, servingsFor(r) - 1);
  if (act === "inc") p.portions += 1;
  if (act === "dec") p.portions = Math.max(1, p.portions - 1);
  if (act === "dayinc") p.days[day] = (p.days[day] || 0) + 1;
  if (act === "daydec") { p.days[day] = (p.days[day] || 0) - 1; if (p.days[day] <= 0) delete p.days[day]; }
  if (act === "delete" && confirm(`Delete "${r.name}"?`)) { state.custom = state.custom.filter(c => c.id !== id); delete state.plan[id]; delete state.fav[id]; }
  if (act === "clear") for (const k of Object.keys(state.checked)) if (k.startsWith(b.dataset.prefix)) delete state.checked[k];
  if (act === "tstart") { audio(); state.timers[id] = Date.now() + stepTimerMinutes(id) * 60000; rang.delete(id); }
  if (act === "tcancel") { delete state.timers[id]; rang.delete(id); }
  if (act === "tmore") state.tmin[id] = Math.min(180, stepTimerMinutes(id) + 1);
  if (act === "tless") state.tmin[id] = Math.max(1, stepTimerMinutes(id) - 1);
  save(); render();
});

document.addEventListener("input", e => {
  if (e.target.id !== "search") return;
  state.search = e.target.value;
  $("#cards").innerHTML = cardsHtml();
});

document.addEventListener("toggle", e => {
  const id = e.target.dataset && e.target.dataset.open;
  if (id) e.target.open ? (state.open[id] = true) : delete state.open[id];
}, true);

document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "importFile") { if (t.files[0]) importBackup(t.files[0]); t.value = ""; return; }
  if (t.dataset.dayadd) {
    const p = state.plan[t.value];
    if (p) { p.days[t.dataset.dayadd] = (p.days[t.dataset.dayadd] || 0) + 1; save(); }
    render(); return;
  }
  const c = t.dataset.check;
  if (!c) return;
  t.checked ? (state.checked[c] = true) : delete state.checked[c];
  save(); render();
});

document.addEventListener("submit", e => {
  if (e.target.id !== "addForm") return;
  e.preventDefault();
  const f = new FormData(e.target), lines = k => f.get(k).split("\n").map(s => s.trim()).filter(Boolean);
  const r = {
    id: "c" + Date.now(), custom: true, name: f.get("name").trim(),
    servings: +f.get("servings"), minutes: +f.get("minutes"), tags: ["custom"],
    fridgeDays: +f.get("fridgeDays") || 2, freezable: f.get("freezable") === "on",
    ingredients: lines("ingredients").map(parseIngredient), steps: lines("steps").map(parseStep),
  };
  state.custom.push(r); save(); render();
});

render();
