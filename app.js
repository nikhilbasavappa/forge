/* app.js — Forge. No build step, no deps. Data lives in localStorage. */
"use strict";

const KEY = "forge.v1";
const DEFAULT_STATE = {
  v: 1,
  profile: { heightIn: 68, startWeight: 155, proteinTarget: 155, weeklyTarget: 4, restDefault: 90 },
  programIndex: 0,        // which session in SESSION_ORDER is next
  workouts: [],           // {id, date, sessionKey, entries:[{exId, variation, sets:[{reps,load,unit,rpe}]}], note}
  checkins: [],           // {date, energy(1-5), sleep(hrs), pains:[{area,sev(0-3)}], note}
  measurements: [],       // {date, weight, waist, chest, arm}
  nutrition: [],          // {date, protein(g), _m}
};

let S = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    const s = Object.assign(structuredClone(DEFAULT_STATE), parsed);
    s.profile = Object.assign({}, DEFAULT_STATE.profile, s.profile); // backfill new profile fields
    if (!Array.isArray(s.nutrition)) s.nutrition = [];
    return s;
  } catch (e) { return structuredClone(DEFAULT_STATE); }
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); scheduleSync(); }

/* ---------- cross-device sync (Cloudflare Worker, passphrase-gated) ---------- */
const SYNC_ENDPOINT = "https://forge-sync.nikvbas.workers.dev/state";
const SYNC_KEY = "forge.sync";
let SY = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { return {}; } })();
function saveSync() { localStorage.setItem(SYNC_KEY, JSON.stringify(SY)); }
function syncEndpoint() { return SY.url || SYNC_ENDPOINT; }
let syncState = "off"; // off | syncing | ok | err | offline
let syncMsg = "";

function setSyncStatus(s, msg) {
  syncState = s; syncMsg = msg || "";
  const el = document.getElementById("sync-status");
  if (el) el.textContent = syncStatusText();
}
function syncStatusText() {
  if (!SY.key) return "Not connected. Enter a passphrase to sync across devices.";
  const last = SY.lastSync ? `last synced ${daysAgo(toDate(SY.lastSync))}d ago` : "not synced yet";
  return ({
    off: `Connected · ${last}`,
    syncing: "Syncing…",
    ok: `Synced just now`,
    offline: `Offline · ${last}`,
    err: `Sync error: ${syncMsg} · ${last}`,
  })[syncState] || `Connected · ${last}`;
}
function toDate(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

async function pullRemote() {
  const r = await fetch(syncEndpoint(), { headers: { Authorization: "Bearer " + SY.key } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).state;
}
async function pushRemote(state) {
  const r = await fetch(syncEndpoint(), {
    method: "PUT",
    headers: { Authorization: "Bearer " + SY.key, "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function mergeByKey(a = [], b = [], key) {
  const m = {};
  [...a, ...b].forEach((r) => { const k = r[key]; const ex = m[k]; if (!ex || (r._m || 0) >= (ex._m || 0)) m[k] = r; });
  return Object.values(m).sort((x, y) => (x[key] < y[key] ? -1 : 1));
}
function mergeStates(a, b) {
  if (!b) return a; if (!a) return b;
  const out = structuredClone(a);
  const w = {};
  [...(a.workouts || []), ...(b.workouts || [])].forEach((x) => { const e = w[x.id]; if (!e || (x._m || 0) >= (e._m || 0)) w[x.id] = x; });
  out.workouts = Object.values(w).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id));
  out.checkins = mergeByKey(a.checkins, b.checkins, "date");
  out.measurements = mergeByKey(a.measurements, b.measurements, "date");
  out.nutrition = mergeByKey(a.nutrition, b.nutrition, "date");
  if ((b._m || 0) > (a._m || 0)) { out.profile = b.profile; out.programIndex = b.programIndex; out._m = b._m; }
  return out;
}

let syncing = false, syncT;
function scheduleSync() { if (!SY.key) return; clearTimeout(syncT); syncT = setTimeout(() => syncNow(), 1800); }
async function syncNow(opts = {}) {
  if (!SY.key || syncing) return;
  if (!navigator.onLine) { setSyncStatus("offline"); return; }
  syncing = true; setSyncStatus("syncing");
  try {
    const remote = await pullRemote();
    const merged = mergeStates(S, remote);
    S = merged; localStorage.setItem(KEY, JSON.stringify(S));
    await pushRemote(S);
    SY.lastSync = Date.now(); saveSync();
    setSyncStatus("ok");
    if (opts.rerender) setTab(current);
  } catch (e) {
    setSyncStatus("err", e.message);
  } finally { syncing = false; }
}

/* ---------- date / util ---------- */
const pad = (n) => String(n).padStart(2, "0");
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function prettyDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function daysAgo(s) {
  const [y, m, d] = s.split("-").map(Number);
  const then = new Date(y, m - 1, d); const now = new Date();
  return Math.round((now.setHours(0,0,0,0) - then.setHours(0,0,0,0)) / 86400000);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- domain helpers ---------- */
function nextSessionKey() { return SESSION_ORDER[S.programIndex % SESSION_ORDER.length]; }
function exFlat(sessionKey) { return SESSIONS[sessionKey].blocks.flatMap((b) => b.ex); }

function lastEntry(exId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const e = S.workouts[i].entries.find((x) => x.exId === exId);
    if (e) return { date: S.workouts[i].date, entry: e };
  }
  return null;
}
function todaysCheckin() { return S.checkins.find((c) => c.date === today()) || null; }

// Suggestion: looks at last performance + today's readiness.
function suggest(exId) {
  const ex = EXERCISES[exId];
  const last = lastEntry(exId);
  const ci = todaysCheckin();
  // readiness gates
  const lowEnergy = ci && ci.energy && ci.energy <= 2;
  const shoulderPain = ci && (ci.pains || []).some((p) =>
    p.sev >= 2 && /scapula|shoulder/i.test(p.area));
  if (shoulderPain && (ex.cat === "push" || exId === "pike_pushup")) {
    return { lvl: "bad", text: "Shoulder flagged: regress or skip" };
  }
  if (lowEnergy) return { lvl: "warn", text: "Low energy: 2 sets" };
  if (!last) return { lvl: "acc", text: "No history yet" };

  const sets = last.entry.sets.filter((s) => s.reps != null || s.load != null);
  if (!sets.length) return { lvl: "acc", text: "No history yet" };

  if (ex.load === "time") {
    const top = Math.max(...sets.map((s) => +s.reps || 0));
    if (top >= (ex.target.sec || 0)) return { lvl: "good", text: `${ex.target.sec}s reached: add time or variation` };
    return { lvl: "acc", text: `Target ${ex.target.sec}s` };
  }
  const topReps = Math.max(...sets.map((s) => +s.reps || 0));
  const allHit = sets.length >= (ex.target.sets || 1) && sets.every((s) => (+s.reps || 0) >= ex.target.hi);
  const lowRpe = sets.every((s) => !s.rpe || s.rpe <= 8);
  if (allHit && lowRpe) {
    return { lvl: "good", text: ex.ladder ? "Top of range: add load or variation" : "Top of range: +load or +1 rep/set" };
  }
  if (topReps < ex.target.lo) return { lvl: "warn", text: `Below ${ex.target.lo} reps: hold or regress` };
  return { lvl: "acc", text: `Add reps toward ${ex.target.hi}` };
}

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ---------- protein ---------- */
function todaysNutrition() { return S.nutrition.find((n) => n.date === today()) || null; }
function proteinToday() { const n = todaysNutrition(); return n ? (+n.protein || 0) : 0; }
function addProtein(g) {
  const i = S.nutrition.findIndex((n) => n.date === today());
  if (i >= 0) S.nutrition[i] = { ...S.nutrition[i], protein: Math.max(0, (+S.nutrition[i].protein || 0) + g), _m: Date.now() };
  else S.nutrition.push({ date: today(), protein: Math.max(0, g), _m: Date.now() });
  save();
}
function setProtein(g) {
  const i = S.nutrition.findIndex((n) => n.date === today());
  const rec = { date: today(), protein: Math.max(0, g), _m: Date.now() };
  if (i >= 0) S.nutrition[i] = rec; else S.nutrition.push(rec);
  save();
}

/* ---------- adherence (week math) ---------- */
function mondayOf(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0,0,0,0); x.setDate(x.getDate() - day); return x; }
function weekStartStr(d) { return toDate(mondayOf(d).getTime()); }
// sessions grouped by week-start; returns last `n` weeks oldest→newest as {week, count}
function weeklySessions(n) {
  const counts = {};
  S.workouts.forEach((w) => { const k = weekStartStr(new Date(w.date.replace(/-/g, "/"))); counts[k] = (counts[k] || 0) + 1; });
  const out = [];
  const base = mondayOf(new Date());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setDate(d.getDate() - i * 7);
    const k = toDate(d.getTime());
    out.push({ week: k, count: counts[k] || 0 });
  }
  return out;
}
function sessionsThisWeek() { const k = weekStartStr(new Date()); return S.workouts.filter((w) => weekStartStr(new Date(w.date.replace(/-/g, "/"))) === k).length; }
function targetStreakWeeks() {
  const tgt = S.profile.weeklyTarget || 4;
  const wk = weeklySessions(16);
  let streak = 0;
  for (let i = wk.length - 1; i >= 0; i--) {
    if (i === wk.length - 1 && wk[i].count < tgt) continue; // current week not yet met → don't break streak
    if (wk[i].count >= tgt) streak++; else break;
  }
  return streak;
}

/* ---------- rest timer ---------- */
let restInt = null, restEnd = 0;
function fmtClock(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; }
function restBeep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination); o.frequency.value = 880; o.type = "sine";
    g.gain.setValueAtTime(0.001, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
    o.start(); o.stop(ac.currentTime + 0.5);
  } catch (e) {}
}
function stopRest() { if (restInt) clearInterval(restInt); restInt = null; const b = document.getElementById("rest-bar"); if (b) b.remove(); }
function startRest(sec) {
  stopRest();
  restEnd = Date.now() + sec * 1000;
  let bar = document.createElement("div");
  bar.id = "rest-bar"; bar.className = "rest-bar";
  bar.innerHTML = `<button class="rest-x" id="rest-skip">SKIP</button>
    <span class="rest-t" id="rest-t">${fmtClock(sec)}</span>
    <button class="rest-x" id="rest-add">+30s</button>`;
  document.body.appendChild(bar);
  document.getElementById("rest-skip").onclick = stopRest;
  document.getElementById("rest-add").onclick = () => { restEnd += 30000; };
  const tick = () => {
    const left = (restEnd - Date.now()) / 1000;
    const t = document.getElementById("rest-t"); if (t) t.textContent = fmtClock(left);
    if (left <= 0) { restBeep(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); stopRest(); }
  };
  restInt = setInterval(tick, 250); tick();
}

/* ---------- progress photos (IndexedDB; local-only, not synced) ---------- */
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("forge-media", 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("photos")) r.result.createObjectStore("photos", { keyPath: "date" }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbPut(p) { const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").put(p); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function idbAll() { const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction("photos", "readonly"); const q = t.objectStore("photos").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); }
async function idbDel(date) { const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").delete(date); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
function compressImage(file, maxDim = 1080, q = 0.72) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL("image/jpeg", q));
    };
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- bar chart (inline SVG) ---------- */
function barChart(items, color, target) {
  if (!items.length) return `<div class="chart-empty">No data yet.</div>`;
  const W = 320, H = 96, pb = 16, gap = 4;
  const max = Math.max(target || 0, ...items.map((i) => i.v), 1);
  const bw = (W - gap * (items.length - 1)) / items.length;
  let bars = "";
  items.forEach((it, i) => {
    const h = (it.v / max) * (H - pb);
    const x = i * (bw + gap);
    bars += `<rect x="${x.toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${it.hi ? color : "#C7BFAC"}"/>`;
    bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" fill="#837B6A" font-size="8" text-anchor="middle">${esc(it.label)}</text>`;
  });
  let tline = "";
  if (target) { const y = (H - pb) - (target / max) * (H - pb); tline = `<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}${tline}</svg>`;
}

/* ---------- router ---------- */
const VIEW = document.getElementById("view");
const TITLE = document.getElementById("screen-title");
const SUB = document.getElementById("screen-sub");
let current = "today";

function setTab(tab) {
  current = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ({ today: renderToday, checkin: renderCheckin, progress: renderProgress, more: renderMore }[tab])();
  VIEW.scrollTop = 0; window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

/* ---------- target label ---------- */
function targetLabel(ex) {
  if (ex.load === "time") return `${ex.target.sets}×${ex.target.sec}s`;
  return `${ex.target.sets}×${ex.target.lo}–${ex.target.hi}${ex.side ? "/side" : ""}`;
}
function demoLink(ex) {
  if (!ex.q) return "";
  const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(ex.q);
  return `<a class="lnk demo" href="${url}" target="_blank" rel="noopener">Demo ↗</a>`;
}
function lastLabel(exId) {
  const l = lastEntry(exId);
  if (!l) return null;
  const parts = l.entry.sets.filter((s) => s.reps != null).map((s) => {
    const u = s.load ? ` @ ${esc(String(s.load))}${s.unit ? esc(s.unit) : ""}` : "";
    return `${s.reps}${u}`;
  });
  if (!parts.length) return null;
  return `Last (${daysAgo(l.date)}d): ${parts.join(", ")}`;
}

/* ---------- TODAY ---------- */
function renderToday() {
  const key = nextSessionKey();
  const sess = SESSIONS[key];
  const ci = todaysCheckin();
  TITLE.textContent = "Today";
  SUB.textContent = prettyDate(today());

  const readiness = ci
    ? `<span class="pill ${ci.energy >= 4 ? "good" : ci.energy <= 2 ? "warn" : "acc"}">Energy ${ci.energy}/5</span>
       <span class="pill">Sleep ${ci.sleep ?? "–"}h</span>
       ${(ci.pains || []).filter((p) => p.sev > 0).length ? `<span class="pill bad">${(ci.pains || []).filter((p) => p.sev > 0).length} pain flag(s)</span>` : `<span class="pill good">No pain flags</span>`}`
    : `<span class="pill warn">No check-in</span>`;

  const title = sess.name.replace(/^[A-C] · /, "");
  const sw = sessionsThisWeek(), wt = S.profile.weeklyTarget || 4;
  const weekPill = `<span class="pill ${sw >= wt ? "good" : "acc"}">Week ${sw}/${wt}</span>`;
  let html = `
    <div class="masthead">
      <div class="mast-top">
        <span class="label">Next session</span>
        <button class="linkbtn" id="switch-sess">Switch →</button>
      </div>
      <div class="mast-main">
        <div class="mast-letter">${esc(key)}</div>
        <div class="mast-name">
          <div class="mast-title">${esc(title)}</div>
          <div class="mast-focus">${esc(sess.focus)}</div>
        </div>
      </div>
      <div class="mast-meta">${readiness}${weekPill}</div>
      <button class="btn good" id="start-log" style="margin-top:18px">Start &amp; log session →</button>
      ${ci ? "" : `<div class="tip">Check in first to adjust today's targets.</div>`}
    </div>`;

  // protein quick-logger
  const pt = proteinToday(), ptgt = S.profile.proteinTarget || 0;
  const ppct = ptgt ? Math.min(100, Math.round((pt / ptgt) * 100)) : 0;
  html += `
    <div class="blk-title"><span class="dot"></span>Protein today</div>
    <div class="card">
      <div class="row"><span class="bignum">${pt}<span class="unit"> / ${ptgt} g</span></span>
        <span class="pill ${pt >= ptgt && ptgt ? "good" : "acc"}">${ppct}%</span></div>
      <div class="pbar"><div class="pbar-fill" style="width:${ppct}%"></div></div>
      <div class="qadd">
        ${[20, 30, 40].map((g) => `<button class="qbtn" data-protein="${g}">+${g}</button>`).join("")}
        <input id="p-set" inputmode="numeric" placeholder="set exact" />
      </div>
    </div>`;

  for (const blk of sess.blocks) {
    html += `<div class="blk-title"><span class="dot"></span>${esc(blk.title)}</div><div class="card">`;
    for (const exId of blk.ex) {
      const ex = EXERCISES[exId];
      const sg = suggest(exId);
      const last = lastLabel(exId);
      html += `<div class="ex">
        <div class="row"><div class="name">${esc(ex.name)}</div><span class="pill">${targetLabel(ex)}</span></div>
        <div class="cue">${esc(ex.cue)}</div>
        <div class="meta">${sg.text === "No history yet" ? "" : `<span class="pill ${sg.lvl}">${esc(sg.text)}</span>`}${demoLink(ex)}</div>
        ${last ? `<div class="lastnote">${esc(last)}</div>` : ""}
      </div>`;
    }
    html += `</div>`;
  }
  VIEW.innerHTML = html;
  document.getElementById("start-log").onclick = () => openLog(key);
  document.getElementById("switch-sess").onclick = () => {
    const cur = SESSION_ORDER.indexOf(key);
    S.programIndex = (cur + 1) % SESSION_ORDER.length; S._m = Date.now(); save(); renderToday();
  };
  document.querySelectorAll("[data-protein]").forEach((b) => b.onclick = () => { addProtein(+b.dataset.protein); renderToday(); });
  const pset = document.getElementById("p-set");
  if (pset) pset.onchange = (e) => { const v = e.target.value.trim(); if (v !== "") { setProtein(Number(v)); renderToday(); } };
}

/* ---------- LOGGING ---------- */
function setRowHTML(ex, exId, i, prev) {
  const timed = ex.load === "time";
  const repsPh = timed ? (ex.target.sec || "") : "";
  const repsVal = prev && prev.reps != null ? prev.reps : "";
  const loadVal = prev && prev.load != null ? prev.load : "";
  let loadCell = "";
  if (ex.load === "band") loadCell = `<input data-ex="${exId}" data-set="${i}" data-f="load" placeholder="band" value="${esc(loadVal)}" />`;
  else if (ex.load === "weight" || ex.load === "reps+load") loadCell = `<input data-ex="${exId}" data-set="${i}" data-f="load" inputmode="decimal" placeholder="lb" value="${esc(loadVal)}" />`;
  else loadCell = `<div class="tiny muted center">BW</div>`;
  const rpe = prev && prev.rpe ? prev.rpe : "";
  return `<div class="setrow">
    <div class="idx">${i + 1}</div>
    <input data-ex="${exId}" data-set="${i}" data-f="reps" inputmode="numeric" placeholder="${timed ? "sec" : "reps"}" value="${esc(repsVal)}" />
    ${loadCell}
    <select data-ex="${exId}" data-set="${i}" data-f="rpe">
      <option value="">RPE</option>
      ${[6,7,8,9,10].map((n) => `<option ${rpe == n ? "selected" : ""}>${n}</option>`).join("")}
    </select>
  </div>`;
}

function openLog(key) {
  const sess = SESSIONS[key];
  TITLE.textContent = "Log · " + key;
  SUB.textContent = sess.name.replace(/^[A-C] · /, "");
  let html = `<div class="card tight small muted">Reps · load · RPE (6–10). Pre-filled with last session.</div>
    <div class="restchips"><span class="label">Rest timer</span>${[60, 90, 120].map((s) => `<button class="qbtn" data-rest="${s}">${fmtClock(s)}</button>`).join("")}</div>`;
  for (const blk of sess.blocks) {
    html += `<div class="blk-title"><span class="dot"></span>${esc(blk.title)}</div>`;
    for (const exId of blk.ex) {
      const ex = EXERCISES[exId];
      const last = lastEntry(exId);
      const prevSets = last ? last.entry.sets : [];
      let ladder = "";
      if (ex.ladder) {
        const cur = last && last.entry.variation;
        ladder = `<label class="fld"><span class="lt">Variation</span>
          <select data-ex="${exId}" data-var="1">
            ${ex.ladder.map((v) => `<option ${cur === v ? "selected" : ""}>${esc(v)}</option>`).join("")}
          </select></label>`;
      }
      let rows = "";
      for (let i = 0; i < ex.target.sets; i++) rows += setRowHTML(ex, exId, i, prevSets[i]);
      html += `<div class="card">
        <div class="row"><div class="name">${esc(ex.name)}</div><span class="pill">${targetLabel(ex)}</span></div>
        <div class="cue">${esc(ex.cue)}</div>
        <div class="meta">${demoLink(ex)}</div>
        ${ladder}
        <div class="sets">${rows}</div>
      </div>`;
    }
  }
  html += `<label class="fld"><span class="lt">Session note (optional)</span>
    <textarea id="log-note" rows="2" placeholder="Notes for the weekly review"></textarea></label>
    <button class="btn good" id="save-log" style="margin-top:14px">Finish &amp; save workout</button>
    <button class="btn ghost" id="cancel-log" style="margin-top:8px">Cancel</button>`;

  VIEW.innerHTML = `<div id="log-form">${html}</div>`;
  window.scrollTo(0, 0);
  document.getElementById("cancel-log").onclick = () => setTab("today");
  document.getElementById("save-log").onclick = () => saveLog(key);
  document.querySelectorAll("[data-rest]").forEach((b) => b.onclick = () => startRest(+b.dataset.rest));
}

function saveLog(key) {
  const byEx = {};
  document.querySelectorAll("#log-form .setrow input, #log-form .setrow select").forEach((inp) => {
    const { ex, set, f } = inp.dataset;
    if (ex == null) return;
    byEx[ex] = byEx[ex] || { exId: ex, sets: [] };
    const si = +set;
    byEx[ex].sets[si] = byEx[ex].sets[si] || { reps: null, load: null, unit: null, rpe: null };
    let val = inp.value.trim();
    if (f === "reps") byEx[ex].sets[si].reps = val === "" ? null : Number(val);
    else if (f === "load") byEx[ex].sets[si].load = val === "" ? null : val;
    else if (f === "rpe") byEx[ex].sets[si].rpe = val === "" ? null : Number(val);
  });
  document.querySelectorAll("#log-form select[data-var]").forEach((sel) => {
    if (byEx[sel.dataset.ex]) byEx[sel.dataset.ex].variation = sel.value;
  });

  const entries = Object.values(byEx)
    .map((e) => { e.sets = e.sets.filter((s) => s && (s.reps != null || s.load != null)); return e; })
    .filter((e) => e.sets.length);

  if (!entries.length) { toast("Log at least one set"); return; }

  const note = (document.getElementById("log-note").value || "").trim();
  S.workouts.push({ id: Date.now(), date: today(), sessionKey: key, entries, note, _m: Date.now() });
  S.programIndex = (SESSION_ORDER.indexOf(key) + 1) % SESSION_ORDER.length;
  S._m = Date.now();
  save();
  toast("Workout saved");
  setTab("today");
}

/* ---------- CHECK-IN ---------- */
function renderCheckin() {
  TITLE.textContent = "Daily check-in";
  SUB.textContent = prettyDate(today());
  const ci = todaysCheckin() || { energy: 0, sleep: "", pains: [], note: "" };
  const painSev = (area) => { const p = (ci.pains || []).find((x) => x.area === area); return p ? p.sev : 0; };

  let painHTML = "";
  for (const area of PAIN_AREAS) {
    const cur = painSev(area);
    painHTML += `<div style="margin-top:12px">
      <div class="small">${esc(area)}</div>
      <div class="seg pain" data-pain="${esc(area)}">
        ${["None","Mild","Mod","Sharp"].map((l, i) => `<button data-sev="${i}" class="${cur === i ? "on" : ""}">${l}</button>`).join("")}
      </div></div>`;
  }

  VIEW.innerHTML = `
    <div class="card">
      <div class="name">Energy today</div>
      <div class="tiny muted" style="margin-bottom:8px">1 = depleted, 5 = strong. Adjusts today's targets.</div>
      <div class="seg" id="seg-energy">
        ${[1,2,3,4,5].map((n) => `<button data-v="${n}" class="${ci.energy === n ? "on" : ""}">${n}</button>`).join("")}
      </div>
      <label class="fld"><span class="lt">Sleep last night (hours)</span>
        <input id="ci-sleep" inputmode="decimal" placeholder="e.g. 7" value="${esc(ci.sleep ?? "")}" /></label>
    </div>
    <div class="card">
      <div class="name">Pain check</div>
      <div class="tiny muted">Shoulder flags reduce pressing volume today.</div>
      ${painHTML}
    </div>
    <label class="fld"><span class="lt">Note (optional)</span>
      <textarea id="ci-note" rows="2" placeholder="Anything worth remembering…">${esc(ci.note || "")}</textarea></label>
    <button class="btn good" id="save-ci" style="margin-top:14px">Save check-in</button>`;

  let energy = ci.energy || 0;
  const pains = {};
  (ci.pains || []).forEach((p) => (pains[p.area] = p.sev));

  document.querySelectorAll("#seg-energy button").forEach((b) => b.onclick = () => {
    energy = +b.dataset.v;
    document.querySelectorAll("#seg-energy button").forEach((x) => x.classList.toggle("on", x === b));
  });
  document.querySelectorAll(".seg.pain").forEach((seg) => {
    seg.querySelectorAll("button").forEach((b) => b.onclick = () => {
      pains[seg.dataset.pain] = +b.dataset.sev;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
  });
  document.getElementById("save-ci").onclick = () => {
    const rec = {
      date: today(), energy,
      sleep: document.getElementById("ci-sleep").value.trim() === "" ? null : Number(document.getElementById("ci-sleep").value),
      pains: Object.entries(pains).map(([area, sev]) => ({ area, sev })).filter((p) => p.sev > 0),
      note: document.getElementById("ci-note").value.trim(),
      _m: Date.now(),
    };
    const i = S.checkins.findIndex((c) => c.date === today());
    if (i >= 0) S.checkins[i] = rec; else S.checkins.push(rec);
    save(); toast("Check-in saved"); setTab("today");
  };
}

/* ---------- charts (tiny inline SVG) ---------- */
function lineChart(points, color, opts = {}) {
  if (points.length < 2) return `<div class="chart-empty">Need 2+ entries to chart.</div>`;
  const W = 320, H = 110, pl = 6, pr = 6, pt = 10, pb = 16;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const sx = (x) => pl + ((x - minX) / (maxX - minX || 1)) * (W - pl - pr);
  const sy = (y) => pt + (1 - (y - minY) / (maxY - minY || 1)) * (H - pt - pb);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const dots = points.map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.5" fill="${color}"/>`).join("");
  const last = points[points.length - 1].y, first = points[0].y;
  const lbl = opts.fmt ? opts.fmt(last) : last;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}
    <text x="${W - pr}" y="12" fill="${color}" font-size="11" text-anchor="end">${esc(String(lbl))}</text>
    <text x="${pl}" y="${H - 3}" fill="#837B6A" font-size="9">${esc(opts.first || String(first))}</text>
  </svg>`;
}

/* ---------- PROGRESS ---------- */
function renderProgress() {
  TITLE.textContent = "Progress";
  SUB.textContent = `${S.workouts.length} workouts logged`;
  const m = S.measurements;
  const lastM = m[m.length - 1];

  const wPoints = m.filter((x) => x.weight != null).map((x, i) => ({ x: i, y: +x.weight }));
  const ePoints = S.checkins.filter((c) => c.energy).map((c, i) => ({ x: i, y: c.energy }));

  // a couple of key lift trends (top set reps)
  function liftPoints(exId) {
    const pts = [];
    S.workouts.forEach((w) => {
      const e = w.entries.find((x) => x.exId === exId);
      if (e) { const top = Math.max(...e.sets.map((s) => +s.reps || 0)); if (top) pts.push({ x: pts.length, y: top }); }
    });
    return pts;
  }
  const lifts = [["pullup_prog", "#16140F"], ["pushup_prog", "#8A2B22"], ["band_press", "#837B6A"]];

  const wt = S.profile.weeklyTarget || 4, sw = sessionsThisWeek(), streak = targetStreakWeeks();
  const weeks = weeklySessions(8).map((w) => ({ label: w.week.slice(5).replace("-", "/"), v: w.count, hi: w.count >= wt }));
  const np = S.nutrition.filter((n) => n.protein != null).slice(-14).map((n) => ({ label: n.date.slice(5).replace("-", "/"), v: +n.protein, hi: (+n.protein) >= (S.profile.proteinTarget || 0) }));

  VIEW.innerHTML = `
    <div class="blk-title"><span class="dot"></span>Adherence</div>
    <div class="card">
      <div class="row"><span class="bignum">${sw}<span class="unit"> / ${wt} this week</span></span>
        <span class="pill ${streak > 0 ? "good" : "acc"}">${streak} wk streak</span></div>
      ${barChart(weeks, "#8A2B22", wt)}
    </div>
    <div class="blk-title"><span class="dot"></span>Protein (g/day)</div>
    <div class="card">${barChart(np, "#16140F", S.profile.proteinTarget)}</div>
    <div class="card">
      <div class="row"><div class="name">Bodyweight</div>
        ${lastM ? `<span class="pill ${(+lastM.weight) < S.profile.startWeight ? "good" : "acc"}">${esc(lastM.weight)} lb</span>` : ""}</div>
      ${lineChart(wPoints, "#8A2B22", { fmt: (v) => v + " lb" })}
    </div>
    <div class="card">
      <div class="name">Energy trend</div>
      ${lineChart(ePoints, "#16140F")}
    </div>
    <div class="card">
      <div class="name">Top-set reps</div>
      ${lifts.map(([id, c]) => {
        const p = liftPoints(id);
        return `<div style="margin-top:10px"><div class="small muted">${esc(EXERCISES[id].name)}</div>${lineChart(p, c)}</div>`;
      }).join("")}
      <div class="legend">${lifts.map(([id, c]) => `<span><i style="background:${c}"></i>${esc(EXERCISES[id].name.split(" ")[0])}</span>`).join("")}</div>
    </div>
    <div class="blk-title"><span class="dot"></span>Log measurements</div>
    <div class="card">
      <div class="tiny muted">Weekly. Tape tracks recomposition better than scale weight.</div>
      <div class="grid2">
        <label class="fld"><span class="lt">Bodyweight (lb)</span><input id="m-weight" inputmode="decimal" placeholder="${esc(lastM?.weight ?? S.profile.startWeight)}"/></label>
        <label class="fld"><span class="lt">Waist (in)</span><input id="m-waist" inputmode="decimal" placeholder="${esc(lastM?.waist ?? "")}"/></label>
        <label class="fld"><span class="lt">Chest (in)</span><input id="m-chest" inputmode="decimal" placeholder="${esc(lastM?.chest ?? "")}"/></label>
        <label class="fld"><span class="lt">Arm (in)</span><input id="m-arm" inputmode="decimal" placeholder="${esc(lastM?.arm ?? "")}"/></label>
      </div>
      <button class="btn" id="save-m" style="margin-top:14px">Save measurements</button>
    </div>
    ${m.length ? `<div class="card tight"><div class="small muted">History</div>${
      m.slice().reverse().slice(0, 8).map((x) => `<div class="row small" style="padding:6px 0;border-top:1px solid var(--line)">
        <span class="muted">${prettyDate(x.date)}</span>
        <span>${[x.weight && x.weight + "lb", x.waist && "w" + x.waist, x.chest && "c" + x.chest, x.arm && "a" + x.arm].filter(Boolean).join(" · ")}</span></div>`).join("")
    }</div>` : ""}
    <div class="blk-title"><span class="dot"></span>Progress photos</div>
    <div class="card">
      <div class="tiny muted">Stored only on this device — not synced. Same time of day &amp; light for useful comparisons.</div>
      <label class="btn ghost" style="margin-top:12px;display:block;text-align:center">Add / replace today's photo
        <input type="file" id="photo-in" accept="image/*" style="display:none"/></label>
      <div id="photos"></div>
    </div>`;

  document.getElementById("photo-in").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    toast("Saving photo…");
    try { const img = await compressImage(file); await idbPut({ date: today(), img, _m: Date.now() }); toast("Photo saved"); renderPhotos(); }
    catch (err) { toast("Photo failed"); }
  };
  renderPhotos();

  document.getElementById("save-m").onclick = () => {
    const g = (id) => { const v = document.getElementById(id).value.trim(); return v === "" ? null : Number(v); };
    const rec = { date: today(), weight: g("m-weight"), waist: g("m-waist"), chest: g("m-chest"), arm: g("m-arm"), _m: Date.now() };
    if (rec.weight == null && rec.waist == null && rec.chest == null && rec.arm == null) { toast("Enter at least one"); return; }
    const i = S.measurements.findIndex((x) => x.date === today());
    if (i >= 0) S.measurements[i] = Object.assign(S.measurements[i], rec); else S.measurements.push(rec);
    save(); toast("Measurements saved"); renderProgress();
  };
}

async function renderPhotos() {
  const el = document.getElementById("photos"); if (!el) return;
  let ps;
  try { ps = await idbAll(); } catch (e) { el.innerHTML = `<div class="tiny muted">Photos unavailable on this browser.</div>`; return; }
  if (!ps.length) { el.innerHTML = `<div class="chart-empty">No photos yet.</div>`; return; }
  ps.sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = ps[0], last = ps[ps.length - 1];
  let html = "";
  if (ps.length >= 2) {
    html += `<div class="cmp">
      <figure><img src="${first.img}" alt=""/><figcaption>${prettyDate(first.date)}</figcaption></figure>
      <figure><img src="${last.img}" alt=""/><figcaption>${prettyDate(last.date)}</figcaption></figure>
    </div>`;
  }
  html += `<div class="pgrid">${ps.slice().reverse().map((p) => `<figure data-pdate="${p.date}"><img src="${p.img}" alt=""/><figcaption>${esc(p.date.slice(5))}</figcaption></figure>`).join("")}</div>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-pdate]").forEach((f) => f.onclick = () => {
    if (confirm("Delete photo from " + f.dataset.pdate + "?")) idbDel(f.dataset.pdate).then(renderPhotos);
  });
}

/* ---------- MORE / export ---------- */
function buildExport() {
  const cutoff = 8; // last ~week+
  const recentW = S.workouts.filter((w) => daysAgo(w.date) <= cutoff);
  const recentC = S.checkins.filter((c) => daysAgo(c.date) <= cutoff);
  let md = `# Forge — weekly review (${today()})\n\n`;
  const lastM = S.measurements[S.measurements.length - 1];
  const firstM = S.measurements[0];
  md += `**Profile:** ${S.profile.heightIn}in, start ${S.profile.startWeight}lb. `;
  if (lastM) md += `Latest: ${[lastM.weight && lastM.weight + "lb", lastM.waist && "waist " + lastM.waist, lastM.chest && "chest " + lastM.chest, lastM.arm && "arm " + lastM.arm].filter(Boolean).join(", ")}`;
  if (firstM && lastM && firstM !== lastM && firstM.weight && lastM.weight) md += ` (Δ ${(lastM.weight - firstM.weight).toFixed(1)}lb from first measure)`;
  md += `\n\n## Check-ins (last week)\n`;
  if (!recentC.length) md += `_none logged_\n`;
  recentC.forEach((c) => {
    const pains = (c.pains || []).filter((p) => p.sev > 0).map((p) => `${p.area}=${["none","mild","mod","sharp"][p.sev]}`).join(", ");
    md += `- ${c.date}: energy ${c.energy}/5, sleep ${c.sleep ?? "?"}h${pains ? `, PAIN: ${pains}` : ""}${c.note ? ` — ${c.note}` : ""}\n`;
  });
  md += `\n## Workouts (last week)\n`;
  if (!recentW.length) md += `_none logged_\n`;
  recentW.forEach((w) => {
    md += `\n**${w.date} — ${SESSIONS[w.sessionKey].name}**\n`;
    w.entries.forEach((e) => {
      const ex = EXERCISES[e.exId];
      const sets = e.sets.map((s) => `${s.reps ?? "?"}${s.load ? "@" + s.load : ""}${s.rpe ? " (RPE" + s.rpe + ")" : ""}`).join(", ");
      md += `- ${ex.name}${e.variation ? ` [${e.variation}]` : ""}: ${sets}\n`;
    });
    if (w.note) md += `  _note: ${w.note}_\n`;
  });
  md += `\n## Adherence & nutrition\n`;
  md += `- This week: ${sessionsThisWeek()}/${S.profile.weeklyTarget} sessions, ${targetStreakWeeks()} wk on-target streak\n`;
  const recentN = S.nutrition.filter((n) => daysAgo(n.date) <= 8 && n.protein != null);
  if (recentN.length) {
    const avg = Math.round(recentN.reduce((s, n) => s + (+n.protein || 0), 0) / recentN.length);
    md += `- Protein: avg ${avg} g/day over ${recentN.length} logged days (target ${S.profile.proteinTarget})\n`;
  } else { md += `- Protein: not logged\n`; }
  md += `\n---\n_Paste this back to Claude for the weekly re-tune._\n`;
  return md;
}

function renderMore() {
  TITLE.textContent = "More";
  SUB.textContent = "Sync · export · backup";
  VIEW.innerHTML = `
    <div class="blk-title"><span class="dot"></span>Sync across devices</div>
    <div class="card">
      <div class="small muted" id="sync-status">${esc(syncStatusText())}</div>
      <label class="fld"><span class="lt">Passphrase (same on every device)</span>
        <input id="sync-key" type="password" placeholder="8+ characters" value="${esc(SY.key || "")}"/></label>
      <button class="btn" id="sync-connect" style="margin-top:12px">${SY.key ? "Sync now" : "Connect & sync"}</button>
      ${SY.key ? `<button class="btn ghost" id="sync-off" style="margin-top:8px">Disconnect this device</button>` : ""}
      <div class="tiny muted" style="margin-top:10px">Use the same passphrase on each device to share data. Anyone with it can read your log, so make it long. Data syncs on open, on change, and when you return to the app.</div>
    </div>
    <div class="blk-title"><span class="dot"></span>Weekly review export</div>
    <div class="card">
      <div class="small muted">Copies a summary of the week to paste back for re-tuning.</div>
      <button class="btn good" id="exp-copy" style="margin-top:12px">Copy weekly summary</button>
      <button class="btn ghost" id="exp-view" style="margin-top:8px">Preview it</button>
    </div>
    <div class="blk-title"><span class="dot"></span>Backup</div>
    <div class="card">
      <div class="small muted">Data is stored only on this device. Download a backup periodically.</div>
      <button class="btn ghost" id="bk-down" style="margin-top:12px">Download backup (.json)</button>
      <label class="btn ghost" style="margin-top:8px;display:block;text-align:center">Restore from backup
        <input type="file" id="bk-file" accept="application/json" style="display:none"/></label>
    </div>
    <div class="blk-title"><span class="dot"></span>Profile</div>
    <div class="card">
      <div class="grid2">
        <label class="fld"><span class="lt">Height (in)</span><input id="p-h" inputmode="decimal" value="${esc(S.profile.heightIn)}"/></label>
        <label class="fld"><span class="lt">Start weight (lb)</span><input id="p-w" inputmode="decimal" value="${esc(S.profile.startWeight)}"/></label>
        <label class="fld"><span class="lt">Protein target (g)</span><input id="p-prot" inputmode="numeric" value="${esc(S.profile.proteinTarget)}"/></label>
        <label class="fld"><span class="lt">Sessions / week</span><input id="p-wk" inputmode="numeric" value="${esc(S.profile.weeklyTarget)}"/></label>
      </div>
      <button class="btn" id="p-save" style="margin-top:12px">Save profile</button>
    </div>
    <div class="card tight center tiny muted">
      Forge · program v${PROGRAM_VERSION} · ${S.workouts.length} workouts, ${S.checkins.length} check-ins<br/>
      <a class="lnk" id="reset">Reset all data</a>
    </div>
    <div id="exp-out"></div>`;

  document.getElementById("exp-copy").onclick = async () => {
    const md = buildExport();
    try { await navigator.clipboard.writeText(md); toast("Copied — paste to Claude"); }
    catch (e) { document.getElementById("exp-out").innerHTML = `<div class="card"><textarea rows="12" style="width:100%">${esc(md)}</textarea></div>`; toast("Select & copy"); }
  };
  document.getElementById("exp-view").onclick = () => {
    document.getElementById("exp-out").innerHTML = `<div class="card"><pre style="white-space:pre-wrap;font-size:0.8rem;margin:0">${esc(buildExport())}</pre></div>`;
  };
  document.getElementById("bk-down").onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `forge-backup-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  document.getElementById("bk-file").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { const data = JSON.parse(r.result); S = Object.assign(structuredClone(DEFAULT_STATE), data); save(); toast("Restored"); setTab("today"); }
      catch (err) { toast("Invalid backup file"); }
    };
    r.readAsText(f);
  };
  document.getElementById("p-save").onclick = () => {
    S.profile.heightIn = Number(document.getElementById("p-h").value) || S.profile.heightIn;
    S.profile.startWeight = Number(document.getElementById("p-w").value) || S.profile.startWeight;
    S.profile.proteinTarget = Number(document.getElementById("p-prot").value) || S.profile.proteinTarget;
    S.profile.weeklyTarget = Number(document.getElementById("p-wk").value) || S.profile.weeklyTarget;
    S._m = Date.now();
    save(); toast("Profile saved");
  };
  document.getElementById("sync-connect").onclick = async () => {
    const k = document.getElementById("sync-key").value.trim();
    if (k.length < 8) { toast("Passphrase: 8+ characters"); return; }
    SY.key = k; SY.url = SY.url || SYNC_ENDPOINT; saveSync();
    await syncNow();
    toast(syncState === "ok" ? "Synced" : "Sync: " + syncMsg);
    renderMore();
  };
  const offBtn = document.getElementById("sync-off");
  if (offBtn) offBtn.onclick = () => {
    SY = { url: SY.url }; saveSync(); setSyncStatus("off"); toast("Disconnected"); renderMore();
  };
  document.getElementById("reset").onclick = () => {
    if (confirm("Erase ALL workouts, check-ins, and measurements? This cannot be undone.")) {
      S = structuredClone(DEFAULT_STATE); save(); toast("Reset"); setTab("today");
    }
  };
}

/* ---------- boot ---------- */
setTab("today");
if (SY.key) syncNow({ rerender: true });
window.addEventListener("online", () => syncNow({ rerender: true }));
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow({ rerender: true }); });
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
