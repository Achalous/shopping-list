"use strict";
const $ = s => document.querySelector(s);
const AISLES = ["Produce", "Meat & fish", "Dairy & eggs", "Bakery", "Pantry", "Frozen", "Drinks", "Household", "Other"];

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const state = {
  items: load("sl.items", []),            // { id, name, qty, aisle, done }
  seen: load("sl.seen", []),              // item names used before, for suggestions
};
const save = () => {
  try { for (const k of ["items", "seen"]) localStorage.setItem("sl." + k, JSON.stringify(state[k])); } catch { /* storage unavailable */ }
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render() {
  const left = state.items.filter(i => !i.done).length;
  $("#summary").textContent = state.items.length ? `${left} to buy · ${state.items.length - left} in the basket` : "";
  $("#aisle").innerHTML = AISLES.map(a => `<option>${a}</option>`).join("");
  $("#aisle").value = lastAisle;
  $("#seen").innerHTML = state.seen.map(n => `<option value="${esc(n)}">`).join("");

  if (!state.items.length) {
    $("#list").innerHTML = `<div class="empty">Your list is empty.<br>Add your first item above.</div>`;
    $("#actions").innerHTML = "";
    return;
  }
  $("#list").innerHTML = AISLES.filter(a => state.items.some(i => i.aisle === a)).map(a =>
    `<h2>${esc(a)}</h2>` + state.items.filter(i => i.aisle === a)
      .sort((x, y) => x.done - y.done || x.name.localeCompare(y.name))
      .map(i => `<div class="item ${i.done ? "done" : ""}">
        <label><input type="checkbox" data-id="${i.id}" ${i.done ? "checked" : ""}>
        <span>${esc(i.name)}${i.qty ? ` <span class="meta">· ${esc(i.qty)}</span>` : ""}</span></label>
        <button class="x" data-del="${i.id}" aria-label="Remove ${esc(i.name)}">✕</button></div>`).join("")).join("");
  $("#actions").innerHTML = `${left < state.items.length ? `<button class="btn" data-act="clearDone">Remove ticked items</button>` : ""}
    <button class="btn danger" data-act="clearAll">Clear whole list</button>`;
}

let lastAisle = AISLES[0];
document.addEventListener("submit", e => {
  if (e.target.id !== "addForm") return;
  e.preventDefault();
  const name = $("#name").value.trim();
  if (!name) return;
  lastAisle = $("#aisle").value;
  state.items.push({ id: Date.now() + Math.random(), name, qty: $("#qty").value.trim(), aisle: lastAisle, done: false });
  if (!state.seen.some(n => n.toLowerCase() === name.toLowerCase())) state.seen = [...state.seen, name].slice(-200);
  $("#name").value = ""; $("#qty").value = "";
  save(); render(); $("#name").focus();
});

document.addEventListener("change", e => {
  const id = e.target.dataset.id;
  if (!id) return;
  const item = state.items.find(i => String(i.id) === id);
  if (item) item.done = e.target.checked;
  save(); render();
});

document.addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) { state.items = state.items.filter(i => String(i.id) !== del.dataset.del); save(); render(); return; }
  const act = e.target.closest("[data-act]");
  if (!act) return;
  if (act.dataset.act === "clearDone") state.items = state.items.filter(i => !i.done);
  if (act.dataset.act === "clearAll" && confirm("Clear the whole list?")) state.items = [];
  save(); render();
});

render();
