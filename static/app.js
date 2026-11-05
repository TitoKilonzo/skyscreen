"use strict";

/* SkyScreen front end. No libraries, no storage: everything stays in this tab. */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  info: null,
  threshold: 0.5,
  last: null,          // the last single-patient result
  history: [],         // this session only
  examples: [],
  batch: null,         // the last batch response
};

const GROUP_TITLES = {
  mean: ["Mean values", "average over the cell sample"],
  error: ["Standard errors", "how much each value varies"],
  worst: ["Worst values", "the largest of each measurement"],
};

/* ------------------------------------------------------------ helpers */

// Small element builder: h("div", {class: "x"}, "text", childElement)
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function pct(p) {
  if (p > 0 && p < 0.001) return "<0.1%";
  if (p < 1 && p > 0.999) return ">99.9%";
  return (p * 100).toFixed(1) + "%";
}

function labelFor(p) {
  return p >= state.threshold ? "malignant" : "benign";
}

function nice(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function shortName(name) {
  return nice(name.replace(/^(mean|worst) /, "").replace(/ error$/, ""));
}

function fmt(number) {
  if (!Number.isFinite(number)) return "";
  const a = Math.abs(number);
  return a >= 100 ? number.toFixed(0) : a >= 1 ? number.toFixed(2) : number.toPrecision(3);
}

function messageFrom(body) {
  if (body && typeof body.detail === "string") return body.detail;
  if (body && Array.isArray(body.detail)) {
    return body.detail.map((d) => (d.loc ? d.loc.slice(1).join(" ") + ": " : "") + d.msg).join(" ");
  }
  return "Something went wrong.";
}

async function api(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new Error("Cannot reach SkyScreen. Is it still running in your terminal?");
  }
  let body = null;
  try { body = await response.json(); } catch (err) { /* no JSON */ }
  if (!response.ok) throw new Error(messageFrom(body));
  return body;
}

function show(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function download(filename, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/* ------------------------------------------------------------ tabs */

function selectTab(name) {
  for (const tab of $$(".tabs button")) {
    const active = tab.id === "t-" + name;
    tab.setAttribute("aria-selected", String(active));
    $("#" + tab.getAttribute("aria-controls")).hidden = !active;
  }
}

for (const tab of $$(".tabs button")) {
  tab.addEventListener("click", () => selectTab(tab.id.slice(2)));
}

/* ------------------------------------------------------------ single patient form */

function inputs() { return $$("#groups input"); }

function buildForm(info) {
  const root = $("#groups");
  for (const key of ["mean", "error", "worst"]) {
    const grid = h("div", { class: "grid" });
    for (const name of info.groups[key]) {
      const range = info.ranges[name];
      const input = h("input", { type: "number", step: "any", min: "0", "data-name": name, inputmode: "decimal" });
      if (range) {
        input.placeholder = fmt(range.mean);
        const low = Math.max(0, range.mean - 3 * range.std);
        input.title = `${nice(name)}\nTypical range: ${fmt(low)} to ${fmt(range.mean + 3 * range.std)}`;
      }
      input.addEventListener("input", () => input.classList.remove("bad"));
      grid.append(h("label", {}, h("span", { text: shortName(name) }), input));
    }
    const [title, note] = GROUP_TITLES[key];
    root.append(h("fieldset", {}, h("legend", {}, title + " ", h("small", { text: "(" + note + ")" })), grid));
  }
}

function fill(features) {
  for (const input of inputs()) {
    const value = features[input.dataset.name];
    input.value = value == null ? "" : String(value);
    input.classList.remove("bad");
  }
}

function readForm() {
  const values = {};
  let empty = 0;
  let negative = 0;
  for (const input of inputs()) {
    input.classList.remove("bad");
    const text = input.value.trim();
    if (text === "") { empty += 1; input.classList.add("bad"); continue; }
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0) { negative += 1; input.classList.add("bad"); continue; }
    values[input.dataset.name] = number;
  }
  return { values, empty, negative };
}

function clearAll() {
  for (const input of inputs()) { input.value = ""; input.classList.remove("bad"); }
  $("#form-error").hidden = true;
  $("#example-select").value = "";
  state.last = null;
  renderResult();
}

/* ------------------------------------------------------------ result */

function gaugeSVG(p, t) {
  const hot = p >= t;
  const angle = Math.PI * (1 - t);
  const x1 = (100 + 76 * Math.cos(angle)).toFixed(1), y1 = (100 - 76 * Math.sin(angle)).toFixed(1);
  const x2 = (100 + 104 * Math.cos(angle)).toFixed(1), y2 = (100 - 104 * Math.sin(angle)).toFixed(1);
  const color = hot ? "#be2a47" : "#0369a1";
  // all numbers here, no user text
  return `<svg class="gauge" viewBox="0 0 200 122" role="img" aria-label="Probability of malignant ${pct(p)}">
    <path d="M10 100 A90 90 0 0 1 190 100" pathLength="100" fill="none" stroke="#e0f2fe" stroke-width="16"/>
    <path d="M10 100 A90 90 0 0 1 190 100" pathLength="100" fill="none" stroke="${color}" stroke-width="16" stroke-dasharray="${(p * 100).toFixed(2)} 100"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0b2a40" stroke-width="2.5" stroke-linecap="round"/>
    <text x="100" y="92" text-anchor="middle" font-size="27" font-weight="800" fill="#0b2a40">${pct(p)}</text>
    <text x="100" y="113" text-anchor="middle" font-size="10" fill="#4b6b82">probability of malignant</text>
    <text x="10" y="118" text-anchor="middle" font-size="9" fill="#4b6b82">0</text>
    <text x="190" y="118" text-anchor="middle" font-size="9" fill="#4b6b82">100</text>
  </svg>`;
}

function hintFor(p) {
  const gap = Math.abs(p - state.threshold);
  if (gap < 0.15) return "Close to the decision line, so treat this result as uncertain.";
  return p >= state.threshold ? "The network leans clearly towards malignant." : "The network leans clearly towards benign.";
}

function driversBlock(drivers) {
  if (!drivers || drivers.length === 0) return null;
  const biggest = Math.max(...drivers.map((d) => Math.abs(d.effect)));
  const block = h("div", { class: "drivers" }, h("h3", { text: "What influenced this result" }));
  if (biggest < 0.05) {
    block.append(h("p", { class: "muted small", text: "No single measurement stands out. The result is steady." }));
    return block;
  }
  for (const d of drivers) {
    const share = Math.min(50, (Math.abs(d.effect) / biggest) * 50);
    const up = d.effect > 0;
    block.append(h("div", { class: "driver" },
      h("span", { class: "name", text: d.name }),
      h("div", { class: "track", title: up ? "Pushes the result towards malignant" : "Pushes the result towards benign" },
        h("span", { class: "fill " + (up ? "up" : "down"), style: `width:${share}%` })),
      h("span", { class: "vals", text: `yours ${fmt(d.value)} | typical ${fmt(d.typical)}` })));
  }
  block.append(h("div", { class: "legend" }, h("span", { text: "← towards benign" }), h("span", { text: "towards malignant →" })));
  return block;
}

function renderResult() {
  const r = state.last;
  $("#result-empty").hidden = !!r;
  $("#result").hidden = !r;
  $("#copy").hidden = !r;
  $("#print").hidden = !r;
  if (!r) return;

  const p = r.malignant_probability;
  const label = labelFor(p);
  const box = $("#result");
  box.textContent = "";
  box.insertAdjacentHTML("beforeend", gaugeSVG(p, state.threshold));
  box.append(
    h("div", { class: "verdict" },
      h("span", { class: "badge " + label, text: label === "malignant" ? "Malignant" : "Benign" }),
      h("p", { class: "hint", text: hintFor(p) })));
  if (r.warnings.length) {
    box.append(h("ul", { class: "warnings" }, r.warnings.map((w) => h("li", { text: w }))));
  }
  const drivers = driversBlock(r.drivers);
  if (drivers) box.append(drivers);
}

function summaryText() {
  const r = state.last;
  const p = r.malignant_probability;
  const lines = [
    "SkyScreen result (teaching model, not for medical decisions)",
    `Probability of malignant: ${pct(p)}`,
    `Result at a ${Math.round(state.threshold * 100)}% threshold: ${labelFor(p)}`,
  ];
  if (r.drivers && r.drivers.length) {
    lines.push("Main influences: " + r.drivers.slice(0, 3).map((d) => `${d.name} (towards ${d.effect > 0 ? "malignant" : "benign"})`).join(", "));
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------ history */

function addHistory(result) {
  state.history.unshift({
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    result,
  });
  state.history = state.history.slice(0, 8);
  renderHistory();
}

function renderHistory() {
  const list = $("#history");
  list.textContent = "";
  $("#history-card").hidden = state.history.length === 0;
  for (const entry of state.history) {
    const p = entry.result.malignant_probability;
    const label = labelFor(p);
    list.append(h("li", {},
      h("span", { class: "time", text: entry.time }),
      h("span", { class: "tag " + label, text: label === "malignant" ? "Malignant" : "Benign" }),
      h("span", { class: "p", text: pct(p) }),
      h("button", { type: "button", text: "Reload", onclick: () => { fill(entry.result.features); state.last = entry.result; renderResult(); } })));
  }
}

/* ------------------------------------------------------------ predicting */

async function predict(event) {
  event.preventDefault();
  const error = $("#form-error");
  error.hidden = true;
  const { values, empty, negative } = readForm();
  if (empty || negative) {
    const parts = [];
    if (empty) parts.push(`${empty} box${empty > 1 ? "es are" : " is"} empty`);
    if (negative) parts.push(`${negative} value${negative > 1 ? "s are" : " is"} negative or not a number`);
    show(error, parts.join(" and ") + ". Fix the red boxes, or load an example.");
    return;
  }
  const button = $("#predict");
  button.disabled = true;
  try {
    state.last = await api("/api/predict", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ features: values }),
    });
    renderResult();
    addHistory(state.last);
    if (window.matchMedia("(max-width: 900px)").matches) $(".result-card").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    show(error, err.message);
  } finally {
    button.disabled = false;
  }
}

async function readSingleFile(event) {
  const file = event.target.files[0];
  event.target.value = "";                      // lets the same file be chosen again
  if (!file) return;
  const error = $("#form-error");
  error.hidden = true;
  try {
    const result = await api("/api/predict/csv", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text() });
    fill(result.features);
    state.last = result;
    renderResult();
    addHistory(result);
  } catch (err) {
    show(error, err.message);
  }
}

/* ------------------------------------------------------------ batch */

function batchRows() {
  const rows = state.batch.rows.map((r) => ({
    ...r,
    // label follows the slider, not the server's default threshold
    shown: r.status === "ok" ? labelFor(r.malignant_probability) : "invalid",
  }));
  const filter = $("#filter").value;
  const kept = filter === "all" ? rows : rows.filter((r) => r.shown === filter);
  const sort = $("#sort").value;
  if (sort === "high") kept.sort((a, b) => (b.malignant_probability ?? -1) - (a.malignant_probability ?? -1));
  if (sort === "low") kept.sort((a, b) => (a.malignant_probability ?? 2) - (b.malignant_probability ?? 2));
  return { all: rows, kept };
}

function renderBatch() {
  if (!state.batch) return;
  const { all, kept } = batchRows();
  const count = (label) => all.filter((r) => r.shown === label).length;
  const farOut = all.filter((r) => r.far_out > 0).length;

  const stats = $("#stats");
  stats.textContent = "";
  const card = (cls, value, text) => h("div", { class: "stat " + cls }, h("b", { text: value }), h("span", { text }));
  stats.append(
    card("", all.length, "patients in the file"),
    card("", count("benign"), "called benign"),
    card("alert", count("malignant"), "called malignant"),
    card(count("invalid") || farOut ? "warn" : "", count("invalid") + farOut, "rows with problems or warnings"));

  $("#batch-title").textContent = `Results for ${state.batch.filename}`;
  const body = $("#batch-body");
  body.textContent = "";
  for (const r of kept) {
    const p = r.malignant_probability;
    let notes = "";
    if (r.status === "invalid") notes = r.error;
    else if (r.far_out) notes = `${r.far_out} value${r.far_out > 1 ? "s" : ""} far outside the training range`;
    body.append(h("tr", {},
      h("td", { text: r.row }),
      h("td", { text: r.id }),
      h("td", {}, p == null ? "" : [pct(p), h("span", { class: "bar" }, h("i", { class: p >= state.threshold ? "hot" : "", style: `width:${p * 100}%` }))]),
      h("td", {}, h("span", { class: "tag " + r.shown, text: r.shown === "invalid" ? "Not scored" : r.shown === "malignant" ? "Malignant" : "Benign" })),
      h("td", { text: notes })));
  }
  $("#batch-note").textContent = `Showing ${kept.length} of ${all.length} rows at a ${Math.round(state.threshold * 100)}% threshold. Change the threshold on the Single patient tab.`;
  $("#batch-results").hidden = false;
}

async function runBatch(file) {
  const error = $("#batch-error");
  error.hidden = true;
  if (!file) return;
  if (file.size > 1_000_000) { show(error, "That file is over 1 MB. Split it into smaller files."); return; }
  try {
    const result = await api("/api/predict/batch", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text() });
    state.batch = { ...result, filename: file.name };
    $("#filter").value = "all";
    $("#sort").value = "row";
    renderBatch();
  } catch (err) {
    $("#batch-results").hidden = true;
    state.batch = null;
    show(error, err.message);
  }
}

function downloadBatch() {
  const { all } = batchRows();
  const lines = [["row", "patient", "malignant_probability", "result", "note"].join(",")];
  for (const r of all) {
    const note = r.status === "invalid" ? r.error : r.far_out ? `${r.far_out} value(s) far outside training range` : "";
    lines.push([r.row, r.id, r.malignant_probability ?? "", r.shown === "invalid" ? "not scored" : r.shown, note].map(csvCell).join(","));
  }
  download("skyscreen_results.csv", lines.join("\n") + "\n");
}

function downloadTemplate() {
  const names = state.info.feature_names;
  const lines = [["patient_id", ...names].map(csvCell).join(",")];
  state.examples.forEach((example, i) => lines.push([example.label, ...names.map((n) => example.features[n] ?? "")].join(",")));
  download("skyscreen_template.csv", lines.join("\n") + "\n");
}

/* ------------------------------------------------------------ about tab */

function renderAbout(info) {
  const rows = [
    ["Model saved", info.saved_on],
    ["Saved with scikit-learn", info.saved_with_scikit_learn],
    ["Installed scikit-learn", info.installed_scikit_learn],
    ["Measurements", info.feature_names.length],
    ["Default threshold", Math.round(info.threshold * 100) + "%"],
    ["Model type", info.demo ? "Built-in demo model" : "Your Colab model"],
  ];
  const facts = $("#facts");
  for (const [term, value] of rows) facts.append(h("dt", { text: term }), h("dd", { text: value }));
}

/* ------------------------------------------------------------ start up */

async function start() {
  try {
    const info = await api("/api/model-info");
    state.info = info;
    state.threshold = info.threshold;
    $("#threshold").value = Math.round(info.threshold * 100);
    $("#threshold-value").textContent = Math.round(info.threshold * 100) + "%";
    $("#max-rows").textContent = info.max_rows;
    buildForm(info);
    renderAbout(info);

    const pill = $("#model-pill");
    pill.textContent = info.demo ? "Demo model" : "Colab model";
    pill.hidden = false;

    if (info.saved_with_scikit_learn !== info.installed_scikit_learn) {
      show($("#version-warning"), `Version mismatch: the model was saved with scikit-learn ${info.saved_with_scikit_learn}, but ${info.installed_scikit_learn} is installed. Results may be wrong. Rebuild the environment from requirements.txt.`);
    }
    if (!info.explanations) {
      $("#footer-line").textContent = "This model has no scaler step, so the influence chart is turned off.";
    }

    state.examples = await api("/api/examples");
    const select = $("#example-select");
    state.examples.forEach((example, i) => select.append(h("option", { value: i, text: example.label })));
    select.addEventListener("change", () => {
      if (select.value === "") return;
      fill(state.examples[Number(select.value)].features);
      $("#form-error").hidden = true;
    });
    if (state.examples.length === 0) select.disabled = true;
  } catch (err) {
    show($("#fatal"), err.message);
  }
}

$("#form").addEventListener("submit", predict);
$("#clear").addEventListener("click", clearAll);
$("#single-file").addEventListener("change", readSingleFile);
$("#copy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try { await navigator.clipboard.writeText(summaryText()); button.textContent = "Copied"; }
  catch (err) { button.textContent = "Copy failed"; }
  setTimeout(() => { button.textContent = "Copy summary"; }, 1500);
});
$("#print").addEventListener("click", () => window.print());
$("#history-clear").addEventListener("click", () => { state.history = []; renderHistory(); });

$("#threshold").addEventListener("input", (event) => {
  state.threshold = Number(event.target.value) / 100;
  $("#threshold-value").textContent = event.target.value + "%";
  renderResult();
  renderHistory();
  renderBatch();
});

$("#batch-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  runBatch(file);
});
const drop = $("#drop");
for (const name of ["dragenter", "dragover"]) drop.addEventListener(name, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const name of ["dragleave", "drop"]) drop.addEventListener(name, (e) => { e.preventDefault(); drop.classList.remove("over"); });
drop.addEventListener("drop", (e) => runBatch(e.dataTransfer.files[0]));
$("#filter").addEventListener("change", renderBatch);
$("#sort").addEventListener("change", renderBatch);
$("#download").addEventListener("click", downloadBatch);
$("#template").addEventListener("click", downloadTemplate);

start();
