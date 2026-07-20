/* app.js — Forge. No build step, no deps. Data lives in localStorage. */
"use strict";

const KEY = "forge.v1";
const DEFAULT_STATE = {
  v: 1,
  profile: { heightIn: 68, startWeight: 155, proteinTarget: 155, weeklyTarget: 4, restDefault: 90, walkTarget: 30, dumbbellStep: 5 },
  todaySession: null,     // {date, sess} — cached generated session so it doesn't reshuffle on every re-render (see getTodaySession)
  recentTopMuscles: [],   // rolling list of muscles that got session-title billing recently — cooldown so the same 2-3 don't dominate every title (see generateSession)
  workouts: [],           // {id, date, sessionKey, entries:[{exId, variation, sets:[{reps,load,unit,rpe}]}], note} — sessionKey now holds a generated title string, not a fixed A/B/C key
  checkins: [],           // {date, energy(1-5), sleep(hrs), pains:[{area,sev(0-3)}], note}
  measurements: [],       // {date, weight, waist, chest, arm}
  nutrition: [],          // {date, protein(g), _m}
  walks: [],              // {date, min, _m}
  activity: [],           // {id, date, type:'prehab'|'mobility', title, entries:[{exId, variation, sets}], _m} — off-day rehab/mobility, logged separately from real sessions
  equipment: { dumbbells: false, suspension: false }, // bands + pull-up bar + rower assumed
  swaps: {},              // exId -> replacement exId (persistent)
  ladders: {},            // exId -> current rung index (which variation the app has assigned)
  deloadWeek: null,       // weekStart string when a deload week is active
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
    if (!Array.isArray(s.walks)) s.walks = [];
    if (!Array.isArray(s.activity)) s.activity = [];
    s.equipment = Object.assign({}, DEFAULT_STATE.equipment, s.equipment);
    if (!s.swaps || typeof s.swaps !== "object") s.swaps = {};
    if (!s.ladders || typeof s.ladders !== "object") s.ladders = {};
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
let syncEmptyWarn = false; // true right after connecting to a passphrase with zero remote data — see sync-connect handler

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
  out.walks = mergeByKey(a.walks, b.walks, "date");
  const ac = {};
  [...(a.activity || []), ...(b.activity || [])].forEach((x) => { const e = ac[x.id]; if (!e || (x._m || 0) >= (e._m || 0)) ac[x.id] = x; });
  out.activity = Object.values(ac).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id));
  // Ladder rungs are monotonic progress, not a setting — last-writer-wins is wrong here.
  // _m is one timestamp for the WHOLE state blob, bumped by any save on either device (a
  // measurement, a walk, anything), completely unrelated to whether ladders changed. Wholesale-
  // replacing ladders by that timestamp meant a stale device doing something unrelated could
  // silently revert a rung another device had just advanced — take the higher rung per exercise
  // instead, so a real advance can never be clobbered by an unrelated, later-timestamped save.
  const ladderIds = new Set([...Object.keys(a.ladders || {}), ...Object.keys(b.ladders || {})]);
  out.ladders = {};
  ladderIds.forEach((id) => { out.ladders[id] = Math.max((a.ladders || {})[id] || 0, (b.ladders || {})[id] || 0); });
  if ((b._m || 0) > (a._m || 0)) { out.profile = b.profile; out.equipment = b.equipment; out.swaps = b.swaps; out.deloadWeek = b.deloadWeek; out._m = b._m; }
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
    publishSummary();
    SY.lastSync = Date.now(); saveSync();
    setSyncStatus("ok");
    if (opts.rerender) { if (RUN) renderRunner(); else setTab(current); }
  } catch (e) {
    setSyncStatus("err", e.message);
  } finally { syncing = false; }
}

/* ---------- buddy accountability ---------- */
function groupEndpoint() { return (SY.url || SYNC_ENDPOINT).replace(/\/state$/, "/group"); }
function pokeEndpoint() { return (SY.url || SYNC_ENDPOINT).replace(/\/state$/, "/poke"); }
const VAPID_PUBLIC = "BJLYgTutp5l4DiFz00NSF0kAnlj5Q9zL5_1tdkLCJJvlGcTaaNZGkvWRbGjtfO8t4memHTeM907mrIa0rteN4Bk";
function urlB64ToU8(b64) { const pad = "=".repeat((4 - b64.length % 4) % 4); const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/"); const raw = atob(s); const u = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i); return u; }
function idbPutIdentity(id) { return new Promise((res, rej) => { const r = indexedDB.open("forge-buddy", 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("id")) r.result.createObjectStore("id"); }; r.onsuccess = () => { const tx = r.result.transaction("id", "readwrite"); tx.objectStore("id").put(id, "me"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); }); }
async function enablePush() {
  if (!("Notification" in window) || !navigator.serviceWorker) { toast("Notifications not supported"); return; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("Notifications blocked — allow in settings"); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(VAPID_PUBLIC) });
    SY.sub = sub.toJSON(); saveSync();
    await idbPutIdentity({ group: SY.group, name: SY.name });
    await publishSummary();
    toast("Buddy notifications on");
  } catch (e) { toast("Couldn't enable: " + e.message); }
}
async function pokeBuddy(name) {
  try { await fetch(pokeEndpoint(), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group: SY.group, from: SY.name, to: name }) }); toast("Poked " + name); }
  catch (e) { toast("Poke failed"); }
}
function buildSummary() {
  const m = S.measurements.filter((x) => x.weight != null);
  const lastW = m.length ? +m[m.length - 1].weight : null;
  const firstW = m.length ? +m[0].weight : null;
  const rn = S.nutrition.filter((n) => daysAgo(n.date) <= 8 && n.protein != null);
  const rw = S.walks.filter((w) => daysAgo(w.date) <= 8 && w.min != null);
  return {
    weekSessions: sessionsThisWeek(),
    weekTarget: S.profile.weeklyTarget || 4,
    streak: targetStreakWeeks(),
    totalWorkouts: S.workouts.length,
    lastSession: S.workouts.length ? S.workouts[S.workouts.length - 1].date : null,
    proteinAvg: rn.length ? Math.round(rn.reduce((s, n) => s + (+n.protein || 0), 0) / rn.length) : null,
    proteinTarget: S.profile.proteinTarget || null,
    walkAvg: rw.length ? Math.round(rw.reduce((s, w) => s + (+w.min || 0), 0) / rw.length) : null,
    weight: lastW,
    weightDelta: m.length > 1 ? +(lastW - firstW).toFixed(1) : null,
  };
}
async function publishSummary() {
  if (!SY.group || !SY.name) return;
  try {
    await fetch(groupEndpoint(), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Group": SY.group },
      body: JSON.stringify({ name: SY.name, summary: buildSummary(), sub: SY.sub || undefined }),
    });
  } catch (e) {}
}
async function fetchGroup() {
  const r = await fetch(groupEndpoint(), { headers: { "X-Group": SY.group } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).members || {};
}

function renderBuddy() {
  TITLE.textContent = "Buddy";
  SUB.textContent = SY.group ? `Group · ${SY.group}` : "Accountability";
  if (!SY.group || !SY.name) {
    VIEW.innerHTML = `
      <div class="card">
        <div class="name">Train with a buddy</div>
        <div class="small muted">Pick a shared group code — you both enter the same one, with your names. Then you each see the other's week: sessions, streak, protein, walking, weight. No raw data, just the scoreboard.</div>
        <label class="fld"><span class="lt">Your name</span><input id="b-name" placeholder="Nikhil" value="${esc(SY.name || "")}"/></label>
        <label class="fld"><span class="lt">Group code (6+ chars — share it with your buddy)</span><input id="b-group" placeholder="e.g. nikpetro25" value="${esc(SY.group || "")}"/></label>
        <button class="btn good" id="b-join" style="margin-top:12px">Join group</button>
        ${SY.key ? "" : `<div class="tiny muted" style="margin-top:10px">Tip: turn on Sync (More) too, so your progress publishes automatically.</div>`}
      </div>`;
    document.getElementById("b-join").onclick = () => {
      const name = document.getElementById("b-name").value.trim();
      const group = document.getElementById("b-group").value.trim();
      if (!name) { toast("Enter your name"); return; }
      if (group.length < 6) { toast("Group code 6+ chars"); return; }
      SY.name = name; SY.group = group; saveSync();
      publishSummary(); toast("Joined"); renderBuddy();
    };
    return;
  }
  VIEW.innerHTML = `<div class="card tight small muted">Loading group…</div>`;
  publishSummary();
  fetchGroup().then((members) => {
    const names = Object.keys(members).sort((a, b) => (a === SY.name ? -1 : b === SY.name ? 1 : 0));
    let html = `<div class="card tight"><div class="row"><span class="small">Group code: <b>${esc(SY.group)}</b></span><button class="linkbtn" id="b-refresh">Refresh</button></div>
      <div class="tiny muted" style="margin-top:5px">Share that code with your buddy so they can join.</div></div>`;
    html += SY.sub
      ? `<div class="tiny muted" style="margin:0 0 12px">Notifications on — you'll be pinged when a buddy trains or pokes you.</div>`
      : `<button class="btn ghost" id="b-notif" style="margin-bottom:12px">Enable buddy notifications</button>`;
    if (!names.length) html += `<div class="chart-empty">No members yet — share your code.</div>`;
    for (const n of names) {
      const s = (members[n] && members[n].summary) || {};
      const at = members[n] && members[n].at;
      const you = n === SY.name;
      const wk = s.weekSessions ?? 0, wt = s.weekTarget ?? 4;
      const wpct = wt ? Math.min(100, Math.round((wk / wt) * 100)) : 0;
      const lastAgo = s.lastSession != null ? daysAgo(s.lastSession) : null;
      const stale = lastAgo == null || lastAgo >= 3;
      const lastTxt = lastAgo == null ? "no sessions yet" : lastAgo === 0 ? "trained today" : lastAgo + "d since session";
      html += `<div class="blk-title"><span class="dot"></span>${esc(n)}${you ? " · you" : ""}</div>
        <div class="card">
          <div class="row"><span class="bignum">${wk}<span class="unit"> / ${wt} this week</span></span>
            <span class="pill ${wk >= wt ? "good" : "acc"}">${s.streak || 0} wk streak</span></div>
          <div class="pbar"><div class="pbar-fill" style="width:${wpct}%"></div></div>
          <div class="meta" style="margin-top:10px">
            <span class="pill ${stale ? "warn" : "good"}">${lastTxt}</span>
            ${s.proteinAvg != null ? `<span class="pill">protein ${s.proteinAvg}${s.proteinTarget ? "/" + s.proteinTarget : ""}g</span>` : ""}
            ${s.walkAvg != null ? `<span class="pill">walk ${s.walkAvg}m/d</span>` : ""}
            ${s.weight != null ? `<span class="pill">${s.weight}lb${s.weightDelta != null ? ` (${s.weightDelta > 0 ? "+" : ""}${s.weightDelta})` : ""}</span>` : ""}
          </div>
          <div class="tiny muted" style="margin-top:8px">${s.totalWorkouts || 0} total workouts${at ? " · updated " + daysAgo(toDate(at)) + "d ago" : ""}</div>
          ${you ? "" : `<button class="btn ghost sm" data-poke="${esc(n)}" style="margin-top:12px">Poke ${esc(n)}</button>`}
        </div>`;
    }
    html += `<button class="btn ghost" id="b-leave" style="margin-top:16px">Leave group</button>`;
    VIEW.innerHTML = html;
    document.getElementById("b-refresh").onclick = () => renderBuddy();
    document.getElementById("b-leave").onclick = () => { SY.group = null; saveSync(); renderBuddy(); };
    const bn = document.getElementById("b-notif"); if (bn) bn.onclick = () => enablePush().then(() => renderBuddy());
    document.querySelectorAll("[data-poke]").forEach((b) => b.onclick = () => pokeBuddy(b.dataset.poke));
  }).catch((e) => {
    VIEW.innerHTML = `<div class="card"><div class="small">Couldn't load group: ${esc(e.message)}</div><button class="btn ghost" id="b-retry" style="margin-top:10px">Retry</button></div>`;
    document.getElementById("b-retry").onclick = () => renderBuddy();
  });
}

/* ---------- date / util ---------- */
const pad = (n) => String(n).padStart(2, "0");
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function yesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
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
function blocksFlat(sess) { return sess.blocks.flatMap((b) => b.ex); }
function resolveEx(exId) { return (S.swaps && S.swaps[exId]) || exId; }
// Which rung of a progression the app has assigned (it assigns; it doesn't ask the user to choose).
function assignedRung(exId) {
  const ex = EXERCISES[exId];
  if (!ex || !ex.ladder) return 0;
  return Math.max(0, Math.min(ex.ladder.length - 1, (S.ladders && S.ladders[exId]) || 0));
}
function assignedVariation(exId) {
  const ex = EXERCISES[exId];
  return ex && ex.ladder ? ex.ladder[assignedRung(exId)] : null;
}
// A rung is timed either because the whole exercise is (ex.load === "time" — e.g. every rung
// of the standalone dead_hang routine, even ones whose text doesn't literally say "(time)" or
// "dead hang", like "Active scapular hang") or because a normally rep-based ladder has ONE
// timed rung called out by name (chinup_prog/pullup_prog's "Dead hang (time)" starting rung).
function isTimedVariation(v, ex) { return !!(ex && ex.load === "time") || !!(v && /\(time\)|dead hang/i.test(v)); }
function setRung(exId, rung) {
  const ex = EXERCISES[exId]; if (!ex || !ex.ladder) return;
  S.ladders[exId] = Math.max(0, Math.min(ex.ladder.length - 1, rung));
  S._m = Date.now(); save();
}
function isBodyweightMode() { return typeof BW_SWAPS !== "undefined" && S.swaps && S.swaps.band_curl === BW_SWAPS.band_curl && S.swaps.band_press === BW_SWAPS.band_press; }
// noDumbbellMode marks exercises whose resistance direction a dumbbell (gravity only) can't
// replicate at all — anchor-resisted diagonal/lateral paths like band_fly's low-to-high
// crossover or pallof's side anchor. The regex alone can't tell "this band move happens to
// share a verb with a real dumbbell exercise" from "this band move IS a real dumbbell
// exercise," so exercises that fail that distinction opt out explicitly.
function dumbbellMode(ex) { return S.equipment && S.equipment.dumbbells && ex.load === "band" && !ex.noDumbbellMode && /curl|press|fly|row|squat|rdl|pressdown/i.test(ex.name + " " + (ex.cat || "")); }
// Numeric-load exercises are the ones the weight-progression engine can auto-step:
// dumbbell-mode band moves once dumbbells are on, plus anything already tracked in lb (backpack curl).
function isNumericLoad(ex) { return dumbbellMode(ex) || ex.load === "weight"; }
function loadStep(ex) { return (S.profile && +S.profile.dumbbellStep) || 5; }

/* ---------- smart engine: readiness, momentum, stalls, cadence ---------- */
function daysBetween(a, b) { return Math.round((new Date(b.replace(/-/g, "/")) - new Date(a.replace(/-/g, "/"))) / 86400000); }
function trainingDates() { return [...new Set(S.workouts.map((w) => w.date))].sort(); }
function consecutiveTrainingDays() {
  const dates = trainingDates(); if (!dates.length) return 0;
  const set = new Set(dates);
  if (daysAgo(dates[dates.length - 1]) > 1) return 0;
  let count = 0, cur = new Date(dates[dates.length - 1].replace(/-/g, "/"));
  while (set.has(toDate(cur.getTime()))) { count++; cur.setDate(cur.getDate() - 1); }
  return count;
}
function medianGap() {
  const dates = trainingDates(); if (dates.length < 3) return 3;
  const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  gaps.sort((a, b) => a - b); return gaps[Math.floor(gaps.length / 2)] || 3;
}
// variation, when passed, restricts history to entries logged under that SAME ladder rung.
// Without this, a laddered exercise's history is contaminated across rungs that don't even
// share units — e.g. pullup_prog's "Dead hang" rung logs SECONDS held, but "Scapular pull" (the
// very next rung) logs REPS. Without filtering, the day you advance rungs, the app reads last
// session's 45 seconds-held as if it were "45 reps you did last time" on the new movement,
// which corrupts momentum/isStalled/the beat-last-time target and the 20-rep volume floor all
// at once (a 45 "rep" baseline blows past any real rep target instantly).
function exHistory(exId, variation) {
  const out = [];
  S.workouts.forEach((w) => {
    const e = w.entries.find((x) => x.exId === exId && (!variation || x.variation === variation)); if (!e) return;
    const sets = e.sets.filter((s) => s.reps != null); if (!sets.length) return;
    const top = Math.max(...sets.map((s) => +s.reps || 0));
    const topSet = sets.find((s) => +s.reps === top) || sets[0];
    const loadNum = topSet && topSet.load != null && topSet.load !== "" && isFinite(+topSet.load) ? +topSet.load : null;
    // RPE here excludes the LAST set — that one's meant to be pushed near failure by design,
    // so it shouldn't count against "were the working sets otherwise comfortable" (momentum()
    // reads this to decide whether to add volume; gating it on the intentional-failure set
    // would mean it could basically never fire for anyone following the per-set guidance).
    const earlySets = sets.slice(0, -1);
    const rpe = earlySets.length ? (Math.max(0, ...earlySets.map((s) => +s.rpe || 0)) || null) : null;
    out.push({ date: w.date, top, rpe, load: loadNum });
  });
  return out;
}
function momentum(exId, ex) {
  if (ex.load === "time" || ex.load === "cardio") return false;
  const h = exHistory(exId, ex.ladder ? assignedVariation(exId) : undefined); if (h.length < 2) return false;
  return h.slice(-2).every((s) => s.top >= ex.target.hi && (!s.rpe || s.rpe <= 8));
}
// Stalled = no rep PR AND no load increase across 3 sessions — weight-aware so a session
// right after a load step-up (reps intentionally reset to the low end) isn't misread as a plateau.
function isStalled(exId, ex) {
  if (ex.load === "time" || ex.load === "cardio") return false;
  const h = exHistory(exId, ex.ladder ? assignedVariation(exId) : undefined); if (h.length < 3) return false;
  const w = h.slice(-3);
  const noRepPR = Math.max(...w.map((s) => s.top)) <= w[0].top;
  const loadRose = w.some((s, i) => i > 0 && s.load != null && w[i - 1].load != null && s.load > w[i - 1].load);
  return noRepPR && !loadRose;
}
// Blended daily readiness 0–100 from energy, sleep, quality, pain, accumulated fatigue.
// Average RPE across the most recent logged session — an implicit fatigue signal.
function recentAvgRpe() {
  const w = S.workouts[S.workouts.length - 1];
  if (!w) return null;
  const rs = [];
  w.entries.forEach((e) => e.sets.forEach((s) => { if (s.rpe) rs.push(+s.rpe); }));
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}
function readiness() {
  const ci = todaysCheckin();
  let s, implicit = false;
  if (ci && ci.energy) {
    s = 60 + (ci.energy - 3) * 12;
    if (ci.sleep != null) s += Math.max(-24, Math.min(8, (ci.sleep - 7) * 6));
    if (ci.sleepQuality) s += (ci.sleepQuality - 3) * 6;
    (ci.pains || []).forEach((p) => { s -= (p.sev || 0) * (/scapula|shoulder/i.test(p.area) ? 9 : 6); });
  } else {
    // No check-in — infer readiness from training-load signals so targets still adapt.
    implicit = true;
    s = 66; // neutral baseline
    const rpe = recentAvgRpe();
    if (rpe) s += Math.max(-12, Math.min(10, (8 - rpe) * 5)); // brutal last session -> lower
    const dsl = daysSinceLastWorkout();
    if (dsl != null) { if (dsl >= 3) s += 6; else if (dsl === 0) s -= 4; } // rested up vs. back-to-back
  }
  const consec = consecutiveTrainingDays();
  if (consec >= 4) s -= (consec - 3) * 6;
  s = Math.max(0, Math.min(100, Math.round(s)));
  const band = s >= 75 ? "primed" : s >= 58 ? "ready" : s >= 44 ? "moderate" : "low";
  return { score: s, band, implicit };
}

/* ---------- session generator ---------- */
// exId -> muscle, derived once from EXERCISES so the pool can't drift out of sync with the data.
const MUSCLE_POOLS = (() => {
  const pools = {};
  for (const [id, ex] of Object.entries(EXERCISES)) if (ex.muscle) (pools[ex.muscle] = pools[ex.muscle] || []).push(id);
  return pools;
})();
// Most bodyweight-mode swap targets (chin-ups, split-stance work) are genuinely different
// movements worth keeping in rotation regardless of equipment. backpack_curl is the one
// exception — it's not a distinct movement, it's the same curl as hammer_curl with a backpack
// standing in for a dumbbell, so it only earns a slot when there's genuinely no alternative.
const EQUIP_SUBSTITUTE_ONLY = new Set(["backpack_curl"]);
function equipFilteredPool(pool) {
  if (isBodyweightMode()) {
    // band_pull_apart and face_pull now both fall back to the same bodyweight substitute
    // (prone_ytw — the only genuinely floor-only rear-delt option; see BW_SWAPS). Without
    // deduping by the RESOLVED id, a muscle that earns 2 priority slots could pick both raw
    // ids and end up with the identical exercise listed twice in the same session.
    const seen = new Set();
    return pool.filter((id) => { const r = resolveEx(id); if (seen.has(r)) return false; seen.add(r); return true; });
  }
  const filtered = pool.filter((id) => !EQUIP_SUBSTITUTE_ONLY.has(id));
  return filtered.length ? filtered : pool;
}
function daysSinceExercise(exId) {
  const l = lastEntry(exId);
  return l ? daysAgo(l.date) : 999;
}
// Scans real sessions + off-day activity for the most recent time ANY exercise tagged with
// this muscle was trained — so daily prehab/mobility work (which overlaps some muscle pools)
// counts toward freshness too, not just full sessions.
function daysSinceMuscle(muscle) {
  let best = Infinity;
  const scan = (arr) => (arr || []).forEach((w) => (w.entries || []).forEach((e) => {
    const ex = EXERCISES[e.exId];
    if (ex && ex.muscle === muscle) best = Math.min(best, daysAgo(w.date));
  }));
  scan(S.workouts); scan(S.activity);
  return best === Infinity ? 999 : best;
}
// Reads a measurement field off a record, averaging L/R for the two-sided ones.
function measurementValue(rec, field) {
  if (field === "armAvg") { const v = [rec.armL, rec.armR].filter((x) => x != null).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
  if (field === "thighAvg") { const v = [rec.thighL, rec.thighR].filter((x) => x != null).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
  return rec[field] != null ? +rec[field] : null;
}
// Sorted (date, value) pairs for a measurement field, most recent last.
function measurementSeries(field) {
  return S.measurements.map((r) => ({ date: r.date, v: measurementValue(r, field) }))
    .filter((p) => p.v != null).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
// Has a muscle's real-world measurement proxy failed to grow over ~3 weeks despite him
// actually training it? A real trainer would notice a plateau and adjust the program, not
// just keep running the same volume and hoping — but only if he actually put the work in;
// otherwise the fix is training more consistently, not more program cleverness.
function muscleStalled(muscle) {
  const field = MUSCLE_MEASUREMENT[muscle];
  if (!field) return false;
  const pts = measurementSeries(field);
  if (pts.length < 2) return false;
  const latest = pts[pts.length - 1];
  if (daysAgo(latest.date) > 10) return false; // no recent reading, don't act on stale data
  const baseline = [...pts].reverse().find((p) => daysBetween(p.date, latest.date) >= 14);
  if (!baseline) return false;
  if (latest.v > baseline.v + 0.1) return false; // real growth beyond measurement noise
  const windowDays = daysBetween(baseline.date, latest.date);
  const sessionsHit = S.workouts.filter((w) => daysBetween(w.date, latest.date) <= windowDays
    && w.entries.some((e) => EXERCISES[e.exId] && EXERCISES[e.exId].muscle === muscle)).length;
  return sessionsHit >= 4;
}
// Fat-loss/recomp progress (weight, waist, belly) is a nutrition signal, not a training-volume
// one -- a real trainer wouldn't add more chest sets because your waist isn't shrinking. Flags
// it as a distinct nudge rather than feeding it into exercise selection at all.
function bodyCompStalled() {
  const checks = [{ field: "weight", margin: 1 }, { field: "waist", margin: 0.3 }, { field: "belly", margin: 0.3 }];
  const readable = checks.filter(({ field }) => {
    const pts = measurementSeries(field);
    if (pts.length < 2) return false;
    const latest = pts[pts.length - 1];
    if (daysAgo(latest.date) > 10) return false;
    const baseline = [...pts].reverse().find((p) => daysBetween(p.date, latest.date) >= 14);
    return !!baseline;
  });
  if (!readable.length) return null;
  const anyImproved = readable.some(({ field, margin }) => {
    const pts = measurementSeries(field);
    const latest = pts[pts.length - 1];
    const baseline = [...pts].reverse().find((p) => daysBetween(p.date, latest.date) >= 14);
    return latest.v <= baseline.v - margin; // real decrease, not noise
  });
  if (anyImproved) return null;
  const windowDays = Math.max(...readable.map(({ field }) => {
    const pts = measurementSeries(field);
    const latest = pts[pts.length - 1];
    const baseline = [...pts].reverse().find((p) => daysBetween(p.date, latest.date) >= 14);
    return daysBetween(baseline.date, latest.date);
  }));
  const sessionsInWindow = S.workouts.filter((w) => daysBetween(w.date, today()) <= windowDays).length;
  if (sessionsInWindow < 6) return null; // hasn't trained enough to draw a conclusion either way
  return "Weight/waist hasn't moved in a few weeks despite consistent training — that's usually a nutrition signal (protein, portions, deficit), not a reason to add more volume.";
}
// Least-recently-used pick from a pool, with a random tie-break so equally-stale options
// (most commonly "never done") don't always resolve to the same exercise.
function pickLRU(pool, n) {
  return pool.map((id) => ({ id, days: daysSinceExercise(id), r: Math.random() }))
    .sort((a, b) => (b.days - a.days) || (b.r - a.r))
    .slice(0, Math.min(n, pool.length))
    .map((s) => s.id);
}
function joinNice(arr) {
  if (arr.length <= 1) return arr.join("");
  if (arr.length === 2) return arr.join(" & ");
  return arr.slice(0, -1).join(", ") + " & " + arr[arr.length - 1];
}
// Assembles today's session live from what's actually due — no fixed deck. Looks at which
// muscles haven't been trained recently (weighted by MUSCLE_TARGETS priority), today's
// readiness, and pain flags, the same way a trainer would eyeball you before picking the day's
// work. Always returns the same {title, focus, blocks, reasons} shape the old fixed SESSIONS
// table did, so the rest of the app (renderToday, sessionEquip, etc.) doesn't need to know
// sessions are generated rather than looked up.
function generateSession() {
  const ci = todaysCheckin();
  const rd = readiness();
  const shoulderPain = ci && (ci.pains || []).some((p) => p.sev >= 2 && /scapula|shoulder/i.test(p.area));
  const reasons = [];

  // In bodyweight mode, prone_ytw is ALSO the rear-delt strength fallback (band_pull_apart and
  // face_pull both resolve to it — see BW_SWAPS). Picking it here independently for Prehab too
  // risks the same exercise appearing twice in one session under two different framings, so it
  // sits out of the prehab pool specifically while it's doing double duty as a strength swap.
  const prehabPool = isBodyweightMode() ? PREHAB_BLOCK_POOL.filter((id) => id !== "prone_ytw") : PREHAB_BLOCK_POOL;
  const prehabEx = pickLRU(prehabPool, 3);

  let candidates = Object.keys(MUSCLE_TARGETS);
  if (shoulderPain) {
    candidates = candidates.filter((m) => m !== "chest" && m !== "triceps");
    reasons.push("Shoulder flagged today — chest and triceps pressing skipped.");
  }
  // Random tie-break: back/chest/biceps share the same target cadence, so without this a
  // stable sort would deterministically favor whichever comes first in MUSCLE_TARGETS
  // (back) every time they're tied — which, run over weeks, meant back was quietly getting
  // 2-3x the weekly volume of chest/biceps instead of a roughly even share.
  // A muscle whose real-world measurement hasn't moved in ~3 weeks despite real training gets
  // a priority bump — this is what closes the loop between logged progress and what gets
  // trained, instead of that being a manual weekly re-tune.
  // Cooldown: back/chest/biceps share the SAME (smallest) cadence, so once training frequency
  // is roughly balanced across muscles, they mathematically dominate the ranking every single
  // time — dividing by the smallest number always wins, it's not a coincidence or a tie-break
  // glitch. That produced 3 sessions running with an identical "Back, Chest & Biceps" title
  // even though the underlying exercise pool was rotating fine underneath it. A muscle that
  // got session-title billing recently is discounted (not excluded) so a genuinely overdue
  // repeat can still win, but a repeat has to actually earn it instead of winning by default.
  const recentTop = S.recentTopMuscles || [];
  const ranked = candidates
    .map((m) => {
      const stalled = muscleStalled(m);
      let due = (daysSinceMuscle(m) / MUSCLE_TARGETS[m]) * (stalled ? 1.5 : 1);
      const recentCount = recentTop.filter((x) => x === m).length;
      if (recentCount > 0) due *= Math.pow(0.7, recentCount);
      return { m, due, r: Math.random(), stalled };
    })
    .sort((a, b) => (b.due - a.due) || (b.r - a.r));

  // Total exercise SLOTS, not muscle count. Readiness no longer touches this at all — it has
  // exactly one lever for volume (prescribe() trims sets-per-exercise on a genuinely low day),
  // not two. Pre-workout subjective state predicts in-session capacity poorly; real fatigue
  // shows up as underperforming actual sets, which RPE-gated progression already responds to.
  const strengthSlots = 6;

  // The single most-overdue muscle gets TWO exercises (different angles) when its pool
  // allows — matching how a real session concentrates volume on today's priority instead
  // of spreading one exercise per muscle so thin it can't do much. Everyone else gets one.
  const chosenMuscles = [];
  let remaining = strengthSlots;
  ranked.forEach(({ m, stalled }, i) => {
    if (remaining <= 0) return;
    const n = (i === 0 && (MUSCLE_POOLS[m] || []).length >= 2 && remaining >= 2) ? 2 : 1;
    chosenMuscles.push({ m, n, stalled });
    remaining -= n;
  });
  const strengthEx = chosenMuscles.flatMap(({ m, n }) => pickLRU(equipFilteredPool(MUSCLE_POOLS[m] || []), n));

  chosenMuscles.slice(0, 2).forEach(({ m, n, stalled }) => {
    const d = daysSinceMuscle(m);
    const angle = n === 2 ? " (2 exercises)" : "";
    if (stalled) reasons.unshift(`${MUSCLE_DISPLAY[m]} — measurement hasn't moved in ~3 weeks despite real training, priority bumped${angle}.`);
    else reasons.unshift(d >= 999 ? `${MUSCLE_DISPLAY[m]} — never trained, prioritized${angle}.` : `${MUSCLE_DISPLAY[m]} — ${d}d since last trained, prioritized${angle}.`);
  });

  const corePool = Object.keys(EXERCISES).filter((id) => EXERCISES[id].cat === "core");
  const coreEx = pickLRU(equipFilteredPool(corePool), 2);

  const condPool = Object.keys(EXERCISES).filter((id) => EXERCISES[id].cat === "cond");
  const condEx = rd.band === "low" ? [] : pickLRU(equipFilteredPool(condPool), 1);
  if (rd.band === "low") reasons.push("Low readiness — conditioning skipped, rest it out.");

  const blocks = [
    { title: "Prehab", ex: prehabEx },
    { title: "Strength", ex: strengthEx },
    { title: "Core", ex: coreEx },
    { title: "Conditioning", ex: condEx },
  ].filter((b) => b.ex.length);

  const titleMuscles = chosenMuscles.slice(0, 3).map(({ m }) => m);
  const title = joinNice(titleMuscles.map((m) => MUSCLE_DISPLAY[m])) || "Full Body";
  const focusParts = chosenMuscles.map(({ m }) => MUSCLE_DISPLAY[m].toLowerCase());
  focusParts.push("core");
  if (condEx.length) focusParts.push("conditioning");
  const focus = focusParts.join(", ").replace(/^./, (c) => c.toUpperCase());

  // topMuscles isn't displayed — regenerateSession() reads it to update the cooldown list above.
  return { title, focus, blocks, reasons, topMuscles: titleMuscles };
}
// Cached per calendar day so the exercise list doesn't reshuffle every time Today re-renders
// (which happens on nearly every tap — protein, walk, etc). Regenerating is an explicit action.
function getTodaySession() {
  if (S.todaySession && S.todaySession.date === today()) return S.todaySession.sess;
  return regenerateSession();
}
function regenerateSession() {
  const sess = generateSession();
  S.todaySession = { date: today(), sess };
  // Remember today's title muscles for the cooldown discount above — capped to roughly the
  // last 2 sessions' worth so a muscle recovers its normal priority after sitting out briefly,
  // rather than being suppressed indefinitely.
  S.recentTopMuscles = [...(S.recentTopMuscles || []), ...(sess.topMuscles || [])].slice(-6);
  S._m = Date.now(); save();
  return sess;
}

function strokeRate(strokes, timeSec) {
  if (!strokes || !timeSec) return null;
  return `${Math.round((strokes / timeSec) * 60)} spm`;
}
// setIndex, when passed, looks up that SPECIFIC round's prior stroke count by position rather
// than always the first logged set — interval output naturally decays round to round (that's
// normal, expected fatigue, not a problem to fix), so comparing round 6 against round 1's
// number is backwards. Omitted (row_steady, one continuous piece) keeps the old behavior.
function lastCardio(exId, setIndex) {
  const l = lastEntry(exId); if (!l) return null;
  const set = setIndex != null ? l.entry.sets[setIndex] : l.entry.sets.find((s) => s.dist != null);
  return (set && set.dist != null) ? { dist: +set.dist, time: +set.reps || null } : null;
}
function cardioTarget(exId, ex, setIndex, setsCount) {
  const lc = lastCardio(exId, setIndex);
  // Repeating the identical text on every one of N identical-looking rows reads as the app not
  // tracking anything at all — label which round it is so it's clear each row IS distinct, even
  // when (as on a first session) there's nothing yet to compare it against.
  const roundLabel = setsCount > 1 ? `Round ${setIndex + 1} of ${setsCount} — ` : "";
  if (lc) { const p = strokeRate(lc.dist, lc.time || ex.target.sec); return `${roundLabel}beat ${lc.dist} strokes in ${fmtDur(ex.target.sec)}${p ? " · " + p : ""}`; }
  return `${roundLabel}${fmtDur(ex.target.sec)} — log your strokes`;
}

// Safety net: a rep-based prescription under ~20 total reps isn't much of a stimulus
// regardless of how many exercises make up the session. Adds sets (at the same target as the
// last) rather than inflating any single set beyond the exercise's own range — loops because a
// single extra set isn't always enough once readiness has already cut the starting count down.
// Capped so a low-rep-ceiling movement (e.g. an early pull-up rung) can't balloon into 8+ sets.
// Skipped for time/cardio work, which isn't measured in reps.
function applyVolumeFloor(setsCount, perSet, ex) {
  // Excludes prehab specifically (corrective, not a muscle-building movement by design — a
  // 1-set thoracic rotation shouldn't triple into 3 sets chasing an arbitrary rep total).
  // Core stays IN scope even without a muscle tag: it's a real training priority, not
  // corrective filler, and deserves the same volume guarantee as tagged strength work.
  if (ex.cat === "prehab" || ex.load === "time" || ex.load === "cardio" || !perSet.length) return { setsCount, perSet };
  const out = [...perSet];
  let sets = setsCount, total = out.reduce((s, p) => s + (+p.reps || 0), 0), added = 0;
  while (total < 20 && added < 3) {
    const extra = { ...out[out.length - 1] };
    out.push(extra); sets++; total += (+extra.reps || 0); added++;
  }
  return { setsCount: sets, perSet: out };
}
// Auto-progression: per-set targets scaled by readiness (both directions) + momentum.
function prescribe(exId) {
  const ex = EXERCISES[exId];
  if (ex.load === "cardio") {
    // Multiple sets means repeated hard efforts (rower intervals), not one continuous piece
    // (rower steady-state) — the baseline note shouldn't call an interval "steady pace."
    const baseNote = ex.target.sets > 1 ? "Hard effort — log your strokes" : "Steady pace — log your strokes";
    return { setsCount: ex.target.sets, perSet: Array.from({ length: ex.target.sets }, () => ({ reps: ex.target.sec })), note: lastCardio(exId) ? "Beat last stroke count in the same time" : baseNote };
  }
  // Prehab, and REPS-based mobility work (cat_cow — the only one), are movement-quality drills,
  // not a lift to progressively overload — "stalled"/"cruising" doesn't apply to a stretch or a
  // scapular drill with a fixed target. (showRpe elsewhere already groups prehab+mobility for
  // the same underlying reason — this exemption originally only checked "prehab" and missed
  // that cat_cow could still trigger "Stalled 3 sessions" through the exact same gap.) TIME-based
  // mobility (dead_hang, doorway_pec, hip_flexor, deep_squat_hold) is deliberately excluded from
  // this exemption — holding a stretch longer as flexibility improves is real, legitimate
  // progression (same pattern already used for plank/hollow_hold), and those were never exposed
  // to the stalled/cruising bug anyway since momentum()/isStalled() already bail on
  // ex.load === "time". This has to be a full early return, not just different wording on the
  // note: momentum()/isStalled() were still being COMPUTED and FED INTO the set count below (a
  // "primed + cruising" day silently added an extra set to a stretch) and the rep target was
  // still running the same climb-to-hi/reset-to-lo progression math as a real lift, just with
  // neutral text slapped on top. None of that machinery runs here now — sets are always the
  // exercise's own count (deload still trims them), reps are always the midpoint of its range.
  if (ex.cat === "prehab" || (ex.cat === "mobility" && ex.load !== "time")) {
    const setsCount = deloadActive() ? Math.max(1, Math.ceil(ex.target.sets * 0.6)) : ex.target.sets;
    const reps = Math.round((ex.target.lo + ex.target.hi) / 2);
    return {
      setsCount,
      perSet: Array.from({ length: setsCount }, () => ({ reps, load: null })),
      note: "Controlled reps through a full, comfortable range — quality over quantity",
    };
  }
  const last = lastEntry(exId, ex.ladder ? assignedVariation(exId) : undefined);
  const deload = deloadActive();
  const rd = readiness();
  const mo = momentum(exId, ex);
  // A ladder rung can be timed (chinup_prog/pullup_prog's "Dead hang (time)" starting rung)
  // even though the exercise's own load type is "reps" for its later rungs — ex.load alone
  // doesn't know that. Without this check, the reps-shaped machinery below ran on the raw
  // held-seconds number: the 20-rep volume floor forced extra sets chasing "20 reps" out of a
  // number that's actually seconds, and "beat last time" chased your raw hold time upward with
  // no ceiling, every set, every session. The 45s advance-off-this-rung bar already lives in
  // advanceLadders and only needs ONE clean hold to fire — this doesn't need to hunt a new max
  // every set, so it gets a flat, modest, un-inflated target instead.
  if (ex.ladder && isTimedVariation(ex.ladder[assignedRung(exId)], ex) && ex.load !== "time") {
    const setsCount = deload ? Math.max(1, Math.ceil(ex.target.sets * 0.6)) : ex.target.sets;
    const lastSets = last ? last.entry.sets.filter((s) => s.reps != null) : [];
    const bestLast = lastSets.length ? Math.max(...lastSets.map((s) => +s.reps || 0)) : null;
    return {
      setsCount,
      perSet: Array.from({ length: setsCount }, () => ({ reps: 30, last: bestLast, load: null })),
      note: "Hold ~30s with good form — one clean 45s hold on any set levels you up, no need to max every set",
    };
  }
  // Readiness cuts volume far more mildly than it used to. Pre-workout subjective state (how
  // tired you feel before starting) is a weak predictor of in-session capacity — real fatigue
  // shows up as not being able to hit reps once a set actually gets hard, which RPE-gated
  // progression (below) already catches and responds to next session. A "moderate" day is a
  // normal day, not an impaired one, so it no longer touches volume at all; "low" (usually
  // driven by real pain flags or bad sleep, not just feeling tired) trims one set, not ~40%.
  let setsCount = ex.target.sets;
  if (deload) setsCount = Math.max(1, Math.ceil(ex.target.sets * 0.6));
  else if (rd && rd.band === "low") setsCount = Math.max(1, ex.target.sets - 1);
  else if (rd && rd.band === "primed" && mo && ex.load !== "time") setsCount = ex.target.sets + 1;

  if (!last) {
    // Seed at the MIDPOINT of the rep range, not the bottom — the bottom is the easiest
    // possible number in the range, not a real calibration attempt. Still self-corrects:
    // clear it clean and next time's target moves toward the top.
    const base = ex.load === "time" ? ex.target.sec : Math.round((ex.target.lo + ex.target.hi) / 2);
    // A plain band (no dumbbell mode) has adjustable TENSION, not a "weight" to find — telling
    // someone to "find a clean working weight" for a resistance band doesn't match what they're
    // actually holding. isNumericLoad(ex) covers both a genuine weight-tracked exercise
    // (backpack_curl) and a band exercise currently running in dumbbell mode.
    const baseNote = ex.load === "time" ? "Baseline — see how long you can hold"
      : (ex.load === "reps" || !ex.load) ? "Baseline — see how many clean reps you can do"
      : (ex.load === "weight" || isNumericLoad(ex)) ? "Baseline — find a clean working weight"
      : "Baseline — find a band you feel by the last few reps";
    let baseSets = setsCount, basePerSet = Array.from({ length: setsCount }, () => ({ reps: base, last: null, load: null }));
    ({ setsCount: baseSets, perSet: basePerSet } = applyVolumeFloor(baseSets, basePerSet, ex));
    return { setsCount: baseSets, perSet: basePerSet, note: baseNote };
  }
  const lastSets = last.entry.sets.filter((s) => s.reps != null || s.load != null);
  const numericLoad = isNumericLoad(ex);
  const step = loadStep(ex);
  const perSet = [];
  let anyAdd = false, steppedTo = null;
  for (let i = 0; i < setsCount; i++) {
    const ls = lastSets[i] || lastSets[lastSets.length - 1] || {};
    const lastReps = ls.reps != null ? +ls.reps : null;
    if (ex.load === "time") {
      const t = lastReps || ex.target.sec;
      perSet.push({ reps: t >= ex.target.sec ? t + 10 : ex.target.sec, last: lastReps, load: ls.load ?? null });
    } else {
      const r = lastReps || ex.target.lo;
      // The last set of an exercise is intentionally pushed close to failure now (see the
      // per-set target guidance in the runner) — clearing the range ON that set is a stronger
      // signal to progress, not a weaker one, so only earlier sets get the RPE<=8 gate.
      const hitTop = r >= ex.target.hi && (i === setsCount - 1 || !ls.rpe || ls.rpe <= 8);
      if (hitTop) anyAdd = true;
      // Double progression: climb reps to the top of the range, then on the NEXT session
      // reset reps to the bottom and step the weight up — for numeric-load exercises this
      // is computed and pre-filled automatically; you can still type over it.
      const lastLoadNum = numericLoad && ls.load != null && ls.load !== "" && isFinite(+ls.load) ? +ls.load : null;
      let nextLoad = ls.load ?? null, loadStepped = false;
      if (hitTop && numericLoad && lastLoadNum != null) { nextLoad = lastLoadNum + step; loadStepped = true; steppedTo = nextLoad; }
      perSet.push({ reps: hitTop ? ex.target.lo : Math.min(ex.target.hi, r + 1), last: lastReps, load: nextLoad, addLoad: hitTop, loadStepped, prevLoad: lastLoadNum });
    }
  }
  if (deload) {
    perSet.forEach((p) => { p.addLoad = false; p.loadStepped = false; if (p.last != null) p.reps = p.last; });
    return { setsCount, perSet, note: "Deload — lighter, leave 2–3 reps in reserve" };
  }
  // "Add load" only makes physical sense when a numeric load actually exists (dumbbells on,
  // or a genuine weight-tracked movement). For a bodyweight exercise with no ladder either
  // (prone row, bird dog, etc.) there's no mechanical way to progress difficulty in-app beyond
  // more reps/sets — and "add tempo or pause reps" was fabricated advice for a feature that
  // doesn't exist (the app tracks neither). The real lever for that case is the rep-range cycle
  // itself (reps reset to lo and climb back to hi, computed above) — that already runs
  // automatically with no user action, so there's nothing else honest to suggest.
  // A plain band (not in dumbbell mode) has tension to firm up, not a numeric "load" to add —
  // isNumericLoad(ex) is true for a genuine weight-tracked exercise or a band running in
  // dumbbell mode; a band outside that is bandOnly and gets band-appropriate phrasing instead.
  const hasNumericLoad = ex.load === "weight" || isNumericLoad(ex);
  const bandOnly = ex.load === "band" && !isNumericLoad(ex);
  const harderText = ex.ladder ? "move up to a harder variation" : hasNumericLoad ? "add load" : bandOnly ? "use a firmer band" : "";
  let note;
  if (rd && rd.band === "low") note = "Low readiness — one fewer set, but push the ones you do";
  else if (mo) note = rd && rd.band === "primed" ? `Primed + cruising — add a set${harderText ? " and " + harderText : ""}` : (harderText ? `Cruising — ${harderText}` : "Cruising");
  else if (anyAdd) note = steppedTo != null ? `Cleared the range — stepped up to ${steppedTo}lb` : (harderText ? `Cleared the range — ${harderText}` : "Cleared the range");
  else note = ex.load === "time" ? "Beat last time's hold" : "Beat last time's reps";
  let finalSets = setsCount, finalPerSet = perSet;
  ({ setsCount: finalSets, perSet: finalPerSet } = applyVolumeFloor(finalSets, finalPerSet, ex));
  return { setsCount: finalSets, perSet: finalPerSet, note };
}

// Keeps S.workouts date-ordered so lastEntry()/recentAvgRpe() (which read by array position)
// stay correct even when a session is logged out of order (backdating a missed day).
function insertWorkoutSorted(w) {
  let i = S.workouts.length;
  while (i > 0 && S.workouts[i - 1].date > w.date) i--;
  S.workouts.splice(i, 0, w);
}
function insertActivitySorted(a) {
  let i = S.activity.length;
  while (i > 0 && S.activity[i - 1].date > a.date) i--;
  S.activity.splice(i, 0, a);
}
// Looks across real sessions AND off-day prehab/mobility — an exercise done on a rest day
// still sets the bar for "last time" and still feeds progression next time it's prescribed.
function lastEntry(exId, variation) {
  let best = null;
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const e = S.workouts[i].entries.find((x) => x.exId === exId && (!variation || x.variation === variation));
    if (e) { best = { date: S.workouts[i].date, m: S.workouts[i]._m || 0, entry: e }; break; }
  }
  for (let i = (S.activity || []).length - 1; i >= 0; i--) {
    const e = S.activity[i].entries.find((x) => x.exId === exId && (!variation || x.variation === variation));
    if (e) {
      const cand = { date: S.activity[i].date, m: S.activity[i]._m || 0, entry: e };
      if (!best || cand.date > best.date || (cand.date === best.date && cand.m > best.m)) best = cand;
      break;
    }
  }
  return best;
}
function todaysCheckin() { return S.checkins.find((c) => c.date === today()) || null; }

// Suggestion: looks at last performance + today's readiness.
function suggest(exId) {
  const ex = EXERCISES[exId];
  // Prehab, and REPS-based mobility (cat_cow), aren't progression-tracked lifts — "stalled"/
  // "cruising" commentary doesn't apply to a movement-quality drill with a fixed target, so
  // they get no badge at all (matches the note text already suppressed elsewhere). TIME-based
  // mobility (dead_hang, doorway_pec, etc.) is excluded from this — it gets a real, useful
  // "Target Xs" / "Xs reached" badge further below, same as plank/hollow_hold.
  if (ex.cat === "prehab" || (ex.cat === "mobility" && ex.load !== "time")) return { lvl: "acc", text: "" };
  const last = lastEntry(exId, ex.ladder ? assignedVariation(exId) : undefined);
  const ci = todaysCheckin();
  // readiness gates
  const rd = readiness();
  const shoulderPain = ci && (ci.pains || []).some((p) =>
    p.sev >= 2 && /scapula|shoulder/i.test(p.area));
  if (shoulderPain && (ex.cat === "push" || exId === "pike_pushup")) {
    return { lvl: "bad", text: "Shoulder flagged: regress or skip" };
  }
  if (isStalled(exId, ex)) return { lvl: "warn", text: "Stalled 3 sessions: swap or deload this lift" };
  if (rd && rd.band === "low") return { lvl: "warn", text: "Low readiness: cut sets, keep form" };
  if (momentum(exId, ex)) {
    const hasNumericLoad = ex.load === "weight" || isNumericLoad(ex);
    const bandOnly = ex.load === "band" && !isNumericLoad(ex);
    const text = ex.ladder ? "Cruising: move up to a harder variation" : hasNumericLoad ? "Cruising: push load" : bandOnly ? "Cruising: use a firmer band" : "Cruising";
    return { lvl: "good", text };
  }
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
  // Same last-set-is-meant-to-be-near-failure reasoning as prescribe()/advanceLadders — only
  // the earlier sets need to have stayed comfortable.
  const lowRpe = sets.slice(0, -1).every((s) => !s.rpe || s.rpe <= 8);
  if (allHit && lowRpe) {
    // A laddered bodyweight exercise never has a numeric load to add — only bands/weights do,
    // and a plain (non-dumbbell-mode) band has tension to firm up, not a numeric load.
    const hasNumericLoad = ex.load === "weight" || isNumericLoad(ex);
    const bandOnly = ex.load === "band" && !isNumericLoad(ex);
    const text = ex.ladder ? "Top of range: move up to a harder variation" : hasNumericLoad ? "Top of range: +load or +1 rep/set" : bandOnly ? "Top of range: firmer band or +1 rep/set" : "Top of range: +1 rep or +1 set";
    return { lvl: "good", text };
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

/* ---------- walking (NEAT) ---------- */
function walkToday() { const w = S.walks.find((x) => x.date === today()); return w ? (+w.min || 0) : 0; }
function inclineToday() { const w = S.walks.find((x) => x.date === today()); return w && w.incline != null ? +w.incline : null; }
function addWalk(m) {
  const i = S.walks.findIndex((x) => x.date === today());
  if (i >= 0) S.walks[i] = { ...S.walks[i], min: Math.max(0, (+S.walks[i].min || 0) + m), _m: Date.now() };
  else S.walks.push({ date: today(), min: Math.max(0, m), _m: Date.now() });
  save();
}
function setWalk(m) {
  const i = S.walks.findIndex((x) => x.date === today());
  if (i >= 0) S.walks[i] = { ...S.walks[i], min: Math.max(0, m), _m: Date.now() };
  else S.walks.push({ date: today(), min: Math.max(0, m), _m: Date.now() });
  save();
}
function setIncline(v) {
  const i = S.walks.findIndex((x) => x.date === today());
  if (i >= 0) S.walks[i] = { ...S.walks[i], incline: Math.max(0, v), _m: Date.now() };
  else S.walks.push({ date: today(), min: 0, incline: Math.max(0, v), _m: Date.now() });
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
function activityThisWeek() { const k = weekStartStr(new Date()); return (S.activity || []).filter((a) => weekStartStr(new Date(a.date.replace(/-/g, "/"))) === k).length; }
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

/* ---------- deload / auto-regulation ---------- */
function deloadActive() { return S.deloadWeek && S.deloadWeek === weekStartStr(new Date()); }
function deloadReason() {
  if (deloadActive()) return null;
  const recent = S.checkins.filter((c) => daysAgo(c.date) <= 7);
  const painDays = recent.filter((c) => (c.pains || []).some((p) => p.sev >= 2 && /scapula|shoulder/i.test(p.area))).length;
  const lowDays = recent.filter((c) => c.energy && c.energy <= 2).length;
  if (painDays >= 3) return "Shoulder flagged 3+ days this week — back off a week";
  if (lowDays >= 3) return "Low energy 3+ days this week — take a lighter week";
  const ws = weeklySessions(8);
  let streak = 0;
  for (let i = ws.length - 1; i >= 0; i--) { if (ws[i].count > 0) streak++; else break; }
  if (streak >= 4) return `${streak} weeks straight — a deload will let you grow`;
  return null;
}
function daysSinceLastWorkout() {
  if (!S.workouts.length) return null;
  return Math.min(...S.workouts.map((w) => daysAgo(w.date)));
}

const PREHAB_ROUTINE = ["wall_slides", "scap_pushup", "band_pull_apart", "face_pull", "prone_ytw", "thoracic_open"];
const MOBILITY_ROUTINE = ["dead_hang", "thoracic_open", "doorway_pec", "hip_flexor", "deep_squat_hold", "cat_cow"];

/* ---------- rest timer ---------- */
let restInt = null, restEnd = 0;
function fmtClock(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; }
function fmtDur(sec) { return sec >= 60 ? fmtClock(sec) : sec + "s"; }
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

/* count-up hold timer for timed moves (dead hang, plank...) — fills the seconds on stop */
let holdInt = null, holdStart = 0;
function stopHoldTimer() { if (holdInt) clearInterval(holdInt); holdInt = null; const b = document.getElementById("hold-bar"); if (b) b.remove(); }
function startHold(exId, setIdx) {
  stopHoldTimer(); stopRest();
  holdStart = Date.now();
  const bar = document.createElement("div");
  bar.id = "hold-bar"; bar.className = "rest-bar hold";
  bar.innerHTML = `<span class="rest-t" id="hold-t">0:00</span><button class="rest-x" id="hold-stop">STOP · LOG</button>`;
  document.body.appendChild(bar);
  const tick = () => { const t = document.getElementById("hold-t"); if (t) t.textContent = fmtClock((Date.now() - holdStart) / 1000); };
  holdInt = setInterval(tick, 200); tick();
  document.getElementById("hold-stop").onclick = () => {
    const sec = Math.max(1, Math.round((Date.now() - holdStart) / 1000));
    stopHoldTimer();
    captureRun(exId);
    RUN.data[exId] = RUN.data[exId] || [];
    RUN.data[exId][setIdx] = RUN.data[exId][setIdx] || { reps: null, load: null, dist: null, unit: null, rpe: null, done: false };
    RUN.data[exId][setIdx].reps = sec;
    RUN.data[exId][setIdx].done = true;
    saveRun();
    if (navigator.vibrate) navigator.vibrate(80);
    startRest(S.profile.restDefault || 90);
    renderRunner();
  };
}
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
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${bars}${tline}</svg>`;
}

/* ---------- router ---------- */
const VIEW = document.getElementById("view");
const TITLE = document.getElementById("screen-title");
const SUB = document.getElementById("screen-sub");
let current = "today";

function setTab(tab) {
  current = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ({ today: renderToday, checkin: renderCheckin, progress: renderProgress, buddy: renderBuddy, more: renderMore }[tab])();
  VIEW.scrollTop = 0; window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

/* ---------- target label ---------- */
function targetLabel(ex) {
  if (ex.load === "cardio") return `${fmtDur(ex.target.sec)} · strokes`;
  if (ex.load === "time") return `${ex.target.sets}×${fmtDur(ex.target.sec)}`;
  return `${ex.target.sets}×${ex.target.lo}–${ex.target.hi}${ex.side ? "/side" : ""}`;
}
function demoLink(ex) {
  if (!ex.q) return "";
  const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(ex.q);
  return `<a class="lnk demo" href="${url}" target="_blank" rel="noopener">Demo ↗</a>`;
}
// When a demo video exists, the full cue (form + rationale + tips, often 2-3 sentences) is
// redundant with it and just clutters the page — collapse to ~2 lines with a tap-to-expand
// rather than trimming the text itself, so a safety note buried in the 2nd/3rd sentence
// (e.g. "stop if the shoulder feels unstable") is never silently lost.
function cueBlock(ex, text) {
  text = text ?? activeCue(ex);
  if (!ex.q) return `<div class="cue">${esc(text)}</div>`;
  const id = "cue-" + Math.random().toString(36).slice(2, 9);
  return `<div class="cue clamped" id="${id}">${esc(text)}</div><button class="linkbtn cuemore" data-cuetoggle="${id}">More ›</button>`;
}
function bindCueToggles() {
  document.querySelectorAll("[data-cuetoggle]").forEach((btn) => btn.onclick = () => {
    const el = document.getElementById(btn.dataset.cuetoggle);
    const isClamped = el.classList.toggle("clamped");
    btn.textContent = isClamped ? "More ›" : "Less ‹";
  });
}
// One-line reminder on the session's first real-external-load exercise: ramp up before the
// working sets. Not a tracked/logged set on purpose — a full extra input row + its own capture
// logic would be more data model than this is worth; it's a nudge, not something to progress.
function warmupHint(exId) {
  if (!RUN || RUN.warmupFor !== exId) return "";
  const l = lastEntry(exId);
  const lastLoad = l && l.entry.sets.length ? l.entry.sets.find((s) => s.load != null)?.load : null;
  const suggestion = lastLoad && isFinite(+lastLoad) ? `around ${Math.round(+lastLoad / 2)}lb` : "very light";
  return `<div class="banner">Warm up first — 1–2 easy sets at ${suggestion}, ~12 reps, nothing near failure. Not logged below, just get the joint moving before the working sets.</div>`;
}
// A dumbbell-mode-eligible exercise (band_curl, rdl, etc.) switches its LOAD TRACKING to lb
// automatically, but the equip/setup/cue text was left describing the band setup verbatim
// regardless — "stand on a band" is actively wrong once you're holding a dumbbell instead.
// These three helpers are the single place that resolves which text is actually current.
function equipList(ex) { return (ex && Array.isArray(ex.equip)) ? (dumbbellMode(ex) && ex.equipDumbbell ? ex.equipDumbbell : ex.equip).slice() : []; }
function activeSetup(ex) { return (dumbbellMode(ex) && ex.setupDumbbell) ? ex.setupDumbbell : (ex && ex.setup); }
function activeCue(ex) { return (dumbbellMode(ex) && ex.cueDumbbell) ? ex.cueDumbbell : (ex && ex.cue); }
function equipLine(ex) {
  const eq = equipList(ex);
  if (!eq.length) return "";
  return `<div class="equipline"><span class="eqk">Equipment</span>${eq.map((e) => `<span class="eqchip">${esc(e)}</span>`).join("")}</div>`;
}
function setupLine(ex) {
  const setup = activeSetup(ex);
  if (!setup) return "";
  return `<div class="setupline"><span class="eqk">Setup</span><span class="eqv">${esc(setup)}</span></div>`;
}
// All equipment the (resolved, swap-aware) session needs today — deduped, order-preserved.
function sessionEquip(sess) {
  const out = [];
  for (const blk of sess.blocks)
    for (const rawId of blk.ex) {
      const ex = EXERCISES[resolveEx(rawId)];
      for (const e of equipList(ex)) if (!out.includes(e)) out.push(e);
    }
  return out;
}
// Data-completeness check. With no fixed deck, "reachable" means every exercise the generator
// could ever pick (anything with a muscle tag, or cat prehab/core/cond) plus its resolved swaps.
function validateProgram() {
  const seen = new Set();
  for (const [id, ex] of Object.entries(EXERCISES)) {
    if (!ex.muscle && !["prehab", "core", "cond"].includes(ex.cat)) continue; // mobility-only, not generator-reachable
    seen.add(id); seen.add(resolveEx(id)); (ALTS[id] || []).forEach((a) => seen.add(a));
  }
  const problems = [];
  for (const id of seen) {
    const ex = EXERCISES[id];
    if (!ex) { problems.push(`${id}: missing from EXERCISES`); continue; }
    if (!equipList(ex).length) problems.push(`${id}: no equip[]`);
    if (!ex.setup) problems.push(`${id}: no setup`);
    if (!ex.q) problems.push(`${id}: no demo query`);
    if (!(ALTS[id] || []).length && ex.cat !== "cond") problems.push(`${id}: no swap alternatives`);
  }
  if (problems.length) console.warn("[Forge] program validation:", problems);
  return problems;
}
function lastLabel(exId) {
  const ex = EXERCISES[exId];
  const l = lastEntry(exId, ex && ex.ladder ? assignedVariation(exId) : undefined);
  if (!l) return null;
  const cardioSet = l.entry.sets.find((s) => s.dist != null);
  if (cardioSet) {
    const p = strokeRate(+cardioSet.dist, +cardioSet.reps);
    return `Last (${daysAgo(l.date)}d): ${cardioSet.dist} strokes${cardioSet.reps ? " in " + fmtDur(+cardioSet.reps) : ""}${p ? " · " + p : ""}`;
  }
  const parts = l.entry.sets.filter((s) => s.reps != null).map((s) => {
    const u = s.load ? ` @ ${esc(String(s.load))}${s.unit ? esc(s.unit) : ""}` : "";
    return `${s.reps}${u}`;
  });
  if (!parts.length) return null;
  return `Last (${daysAgo(l.date)}d): ${parts.join(", ")}`;
}

/* ---------- TODAY ---------- */
function renderToday() {
  const sess = getTodaySession();
  const ci = todaysCheckin();
  TITLE.textContent = "Today";
  SUB.textContent = prettyDate(today());

  const rd = readiness();
  const rdPill = `<span class="pill ${rd.band === "low" ? "warn" : rd.band === "primed" ? "good" : "acc"}">Readiness ${rd.score}${rd.implicit ? " est" : ""} · ${rd.band}</span>`;
  const readinessTags = ci
    ? `<span class="pill ${ci.energy >= 4 ? "good" : ci.energy <= 2 ? "warn" : "acc"}">Energy ${ci.energy}/5</span>
       <span class="pill">Sleep ${ci.sleep ?? "–"}h</span>
       ${(ci.pains || []).filter((p) => p.sev > 0).length ? `<span class="pill bad">${(ci.pains || []).filter((p) => p.sev > 0).length} pain flag(s)</span>` : `<span class="pill good">No pain flags</span>`}`
    : `<span class="pill warn">No check-in</span>`;

  const sw = sessionsThisWeek(), wt = S.profile.weeklyTarget || 4;
  const weekPill = `<span class="pill ${sw >= wt ? "good" : "acc"}">Week ${sw}/${wt}</span>`;
  const actWk = activityThisWeek();
  const actPill = actWk ? `<span class="pill">+${actWk} rehab/mobility</span>` : "";
  const whyText = sess.reasons.length ? sess.reasons.join(" ") : "Balanced session — nothing especially overdue or flagged today.";
  let html = `
    <div class="masthead">
      <div class="mast-top">
        <span class="label">Today's session</span>
        ${RUN ? "" : `<button class="linkbtn" id="regen-sess">Regenerate →</button>`}
      </div>
      <div class="mast-name">
        <div class="mast-title">${esc(sess.title)}</div>
        <div class="mast-focus">${esc(sess.focus)}</div>
      </div>
      <div class="mast-meta">${rdPill}${readinessTags}${weekPill}${actPill}</div>
      <div class="why">${esc(whyText)}</div>
      <button class="btn good" id="start-log" style="margin-top:18px">${RUN ? `Resume session — exercise ${RUN.idx + 1}/${RUN.list.length} →` : "Start &amp; log session →"}</button>
      ${ci ? "" : `<div class="tip">No check-in — targets are estimated from your recent training. Check in to fine-tune.</div>`}
    </div>`;

  // Today's equipment — everything this session needs, so nothing is a surprise mid-workout.
  const todayEquip = sessionEquip(sess);
  if (todayEquip.length) {
    html += `<div class="equipsum">
      <span class="eqk">Today's equipment</span>
      <div class="eqchips">${todayEquip.map((e) => `<span class="eqchip">${esc(e)}</span>`).join("")}</div>
    </div>`;
  }

  // deload banner + smart nudges
  const consec = consecutiveTrainingDays();
  if (deloadActive()) {
    html += `<div class="banner warn"><div>Deload week active — lighter loads, full recovery.</div><button class="linkbtn" id="deload-off">End</button></div>`;
  } else {
    const dr = deloadReason();
    if (dr) html += `<div class="banner"><div>${esc(dr)}</div><button class="linkbtn" id="deload-on">Start deload</button></div>`;
    else if (consec >= 5) html += `<div class="banner warn"><div>${consec} days straight — take a recovery day.</div><button class="linkbtn" id="rec-mob">Mobility →</button></div>`;
  }
  const dslw = daysSinceLastWorkout();
  const gap = medianGap();
  if (dslw != null && dslw >= Math.max(2, gap + 1)) html += `<div class="banner"><div>${dslw} days since your last session — your usual is about ${gap}.</div></div>`;
  const bcs = bodyCompStalled();
  if (bcs) html += `<div class="banner warn"><div>${esc(bcs)}</div></div>`;

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
    for (const rawId of blk.ex) {
      const exId = resolveEx(rawId);
      const ex = EXERCISES[exId];
      const sg = suggest(exId);
      const last = lastLabel(exId);
      const swapped = exId !== rawId ? `<span class="pill">swapped</span>` : "";
      html += `<div class="ex">
        <div class="row"><div class="name tappable" data-exhist="${exId}">${esc(ex.name)} ›</div><span class="pill">${targetLabel(ex)}</span></div>
        ${cueBlock(ex)}
        <div class="meta">${!sg.text || sg.text === "No history yet" ? "" : `<span class="pill ${sg.lvl}">${esc(sg.text)}</span>`}${swapped}${demoLink(ex)}</div>
        ${last ? `<div class="lastnote">${esc(last)}</div>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  // walk / NEAT logger — after the session, since that's usually when it happens
  const wkMin = walkToday(), wkTgt = S.profile.walkTarget || 0;
  const wkPct = wkTgt ? Math.min(100, Math.round((wkMin / wkTgt) * 100)) : 0;
  const wkIncline = inclineToday();
  html += `
    <div class="blk-title"><span class="dot"></span>Walk today</div>
    <div class="card">
      <div class="row"><span class="bignum">${wkMin}<span class="unit"> / ${wkTgt} min</span></span>
        <span class="pill ${wkMin >= wkTgt && wkTgt ? "good" : "acc"}">${wkPct}%</span></div>
      <div class="tiny muted" style="margin-top:4px">Anytime today — often easiest right after training.</div>
      <div class="pbar"><div class="pbar-fill" style="width:${wkPct}%"></div></div>
      <div class="qadd">
        ${[10, 20, 30].map((m) => `<button class="qbtn" data-walk="${m}">+${m}</button>`).join("")}
        <input id="w-set" inputmode="numeric" placeholder="set exact (min)" />
      </div>
      <div class="row" style="margin-top:10px;gap:10px;align-items:center">
        <span class="eqk">Incline</span>
        <select id="w-incline">
          <option value="">–</option>
          ${Array.from({ length: 13 }, (_, n) => n).map((n) => `<option value="${n}" ${wkIncline === n ? "selected" : ""}>${n}</option>`).join("")}
        </select>
        ${wkIncline != null ? `<span class="tiny muted">of 12</span>` : ""}
      </div>
    </div>`;

  html += `<button class="btn ghost" id="start-prehab" style="margin-top:20px">Daily prehab — off-day routine</button>`;
  html += `<button class="btn ghost" id="start-mobility" style="margin-top:8px">Mobility &amp; stretch — cooldown / off-day</button>`;
  VIEW.innerHTML = html;
  document.getElementById("start-log").onclick = () => { if (RUN) renderRunner(); else startRun(sess); };
  document.getElementById("start-prehab").onclick = () => { if (RUN) renderRunner(); else startPrehab(); };
  document.getElementById("start-mobility").onclick = () => { if (RUN) renderRunner(); else startMobility(); };
  const dOn = document.getElementById("deload-on"); if (dOn) dOn.onclick = () => { S.deloadWeek = weekStartStr(new Date()); S._m = Date.now(); save(); toast("Deload week on"); renderToday(); };
  const dOff = document.getElementById("deload-off"); if (dOff) dOff.onclick = () => { S.deloadWeek = null; S._m = Date.now(); save(); renderToday(); };
  const rm = document.getElementById("rec-mob"); if (rm) rm.onclick = () => startMobility();
  document.querySelectorAll("[data-exhist]").forEach((el) => el.onclick = () => renderExercise(el.dataset.exhist));
  bindCueToggles();
  const regen = document.getElementById("regen-sess");
  if (regen) regen.onclick = () => { regenerateSession(); toast("New session generated"); renderToday(); };
  document.querySelectorAll("[data-protein]").forEach((b) => b.onclick = () => { addProtein(+b.dataset.protein); renderToday(); });
  const pset = document.getElementById("p-set");
  if (pset) pset.onchange = (e) => { const v = e.target.value.trim(); if (v !== "") { setProtein(Number(v)); renderToday(); } };
  document.querySelectorAll("[data-walk]").forEach((b) => b.onclick = () => { addWalk(+b.dataset.walk); renderToday(); });
  const wset = document.getElementById("w-set");
  if (wset) wset.onchange = (e) => { const v = e.target.value.trim(); if (v !== "") { setWalk(Number(v)); renderToday(); } };
  const wInc = document.getElementById("w-incline");
  if (wInc) wInc.onchange = (e) => { const v = e.target.value; if (v !== "") { setIncline(Number(v)); renderToday(); } };
}

/* ---------- GUIDED WORKOUT RUNNER ---------- */
const RUN_KEY = "forge.run";
let RUN = (() => { try { return JSON.parse(localStorage.getItem(RUN_KEY)) || null; } catch { return null; } })();
function saveRun() { if (RUN) localStorage.setItem(RUN_KEY, JSON.stringify(RUN)); else localStorage.removeItem(RUN_KEY); }

function startRun(sess, dateStr) {
  const rawList = blocksFlat(sess);
  const list = rawList.map(resolveEx);
  // The first real external-load exercise of the session gets a one-line warm-up reminder
  // (see renderRunner) — not a tracked/logged set, just a nudge, so it doesn't need its own
  // data model or touch progression math. Only relevant once real weight is involved.
  const warmupFor = list.find((id) => isNumericLoad(EXERCISES[id])) || null;
  RUN = { title: sess.title, rawList, list, idx: 0, startTs: Date.now(), data: {}, date: dateStr || null, warmupFor };
  saveRun(); renderRunner();
}
function startPrehab() {
  RUN = { title: "Daily prehab", list: PREHAB_ROUTINE.slice(), idx: 0, startTs: Date.now(), data: {}, isPrehab: true, activityType: "prehab" };
  saveRun(); renderRunner();
}
function startMobility() {
  RUN = { title: "Mobility & stretch", list: MOBILITY_ROUTINE.slice(), idx: 0, startTs: Date.now(), data: {}, isPrehab: true, activityType: "mobility" };
  saveRun(); renderRunner();
}
function prescribeLvl(p) { return /add load|cruising/i.test(p.note) ? "good" : /readiness|deload/i.test(p.note) ? "warn" : "acc"; }
function runnerLoadCell(ex, i, val) {
  if (ex.load === "cardio") return `<input data-set="${i}" data-f="dist" inputmode="numeric" placeholder="strokes" value="${esc(val ?? "")}" />`;
  if (ex.load === "reps" || !ex.load) return `<div class="tiny muted center">BW</div>`;
  if (ex.load === "time") return `<input data-set="${i}" data-f="load" placeholder="—" value="${esc(val ?? "")}" />`;
  const db = dumbbellMode(ex);
  const ph = ex.load === "band" ? (db ? "lb" : "band") : "lb";
  const im = (ex.load === "band" && !db) ? "" : "inputmode=\"decimal\"";
  return `<input data-set="${i}" data-f="load" ${im} placeholder="${ph}" value="${esc(val ?? "")}" />`;
}

function renderRunner() {
  if (!RUN) return setTab("today");
  const total = RUN.list.length;
  const exId = RUN.list[RUN.idx];
  const ex = EXERCISES[exId];
  const pres = prescribe(exId);
  const existing = RUN.data[exId];
  const elapsed = Math.round((Date.now() - RUN.startTs) / 60000);
  TITLE.textContent = RUN.title;
  SUB.textContent = RUN.date ? `Backdating ${prettyDate(RUN.date)} · exercise ${RUN.idx + 1} / ${total}` : `Exercise ${RUN.idx + 1} / ${total} · ${elapsed} min`;

  // The app ASSIGNS the rung/variation — the user doesn't choose it (they can only bump it up/down).
  const rung = ex.ladder ? assignedRung(exId) : 0;
  const curVar = ex.ladder ? assignedVariation(exId) : null;
  const varTimed = isTimedVariation(curVar, ex);
  const effLoad = varTimed ? "time" : ex.load;
  const timed = effLoad === "time";
  const cardio = effLoad === "cardio";
  const displayName = ex.ladder ? curVar.replace(/\s*\(time\)/i, "") : ex.name;
  // RPE ("how hard did that feel") is meaningless for corrective/stretch work — a wall slide
  // or a thoracic rotation isn't rated on an effort scale the way a working set is.
  const showRpe = ex.cat !== "prehab" && ex.cat !== "mobility";
  // Persistent column headers — the inputs' placeholder text disappears the moment a value
  // is pre-filled (baseline, carried-forward, or a stepped load), which is most of the time.
  const col1Head = cardio || timed ? "sec" : "reps";
  const col2Head = cardio ? "strokes" : timed ? "" : (ex.load === "reps" || !ex.load ? "bw" : (dumbbellMode(ex) ? "lb" : ex.load === "band" ? "band" : "lb"));
  const setsHead = `<div class="setrow sethead"><span></span><span class="colhead">${esc(col1Head)}</span><span class="colhead">${esc(col2Head)}</span><span class="colhead">${showRpe ? "rpe" : ""}</span></div>`;
  let rows = "";
  for (let i = 0; i < pres.setsCount; i++) {
    const p = pres.perSet[i] || {};
    const ev = existing && existing[i];
    // After a load step, default to the reset-to-bottom target reps, not the old (heavier-unrelated) rep count —
    // otherwise a quick tap-through would log the old high rep count at the new heavier weight.
    const repsVal = ev && ev.reps != null ? ev.reps : (cardio ? p.reps : (p.loadStepped ? p.reps : (p.last ?? "")));
    const cellVal = cardio ? (ev && ev.dist != null ? ev.dist : "") : (ev && ev.load != null ? ev.load : (p.load ?? ""));
    const rpeVal = ev && ev.rpe ? ev.rpe : "";
    let tgt;
    if (cardio) tgt = cardioTarget(exId, ex, i, pres.setsCount);
    else if (timed && ex.ladder && ex.load !== "time") {
      // A timed ladder rung on an otherwise reps-based exercise (chinup_prog/pullup_prog's
      // dead hang start) — not a genuine timed exercise that's meant to keep climbing forever,
      // so no "beat your last max" framing here (matches prescribe()'s flat 30s target above).
      tgt = "hold ~30s, good form — 45s clean on any set clears this rung";
    }
    else if (timed) tgt = p.last != null ? `hold — beat ${fmtDur(p.last)}` : "hold — hit ‘time it’ to run the timer";
    else if (ex.cat === "prehab" || ex.cat === "mobility") {
      // No progression framing at all for prehab/mobility — it's not building toward a max or
      // a load, it's a fixed quality target every time. (Only reaches non-timed mobility work —
      // cat_cow — since the other mobility exercises are load:"time" and hit the branch above.)
      tgt = `${p.reps} — controlled, full range`;
    } else {
      // "+load" only makes sense when a numeric load exists to add to — a laddered bodyweight
      // exercise (push-ups, pull-ups, squats) clears its range into a harder ladder rung. A
      // bodyweight exercise with no ladder either (prone row, bird dog) has no load or rung to
      // step to — no fabricated "add tempo or pause reps" suffix, since neither is a tracked
      // feature; the rep-range reset-and-reclimb (computed above) is the real, automatic lever.
      // A plain band (not dumbbell mode) has tension, not a numeric load, to add.
      const hasNumericLoad = ex.load === "weight" || isNumericLoad(ex);
      const bandOnly = ex.load === "band" && !isNumericLoad(ex);
      const addLoadText = p.addLoad ? (ex.ladder ? " · clears to next rung" : hasNumericLoad ? " +load" : bandOnly ? " · use a firmer band" : "") : "";
      tgt = `${p.reps}${p.loadStepped ? ` · stepped to ${p.load}lb (was ${p.prevLoad})` : addLoadText}`;
      // Effort guidance on real strength work — the number alone doesn't say how hard to push it,
      // and evidence points to proximity-to-failure mattering more than the exact rep count.
      if (ex.muscle) tgt += i === pres.setsCount - 1 ? " · last set: push close to failure" : " · leave ~2 in reserve";
    }
    const cellHtml = timed ? `<button class="qbtn holdbtn" data-hold="${i}">⏱ time it</button>` : runnerLoadCell({ ...ex, load: effLoad }, i, cellVal);
    rows += `<div class="setrow">
      <button class="setdone ${ev && ev.done ? "on" : ""}" data-set="${i}" title="mark done + rest">${i + 1}</button>
      <input data-set="${i}" data-f="reps" inputmode="numeric" placeholder="${cardio || timed ? "sec" : "reps"}" value="${esc(repsVal)}" />
      ${cellHtml}
      ${showRpe ? `<select data-set="${i}" data-f="rpe"><option value="">RPE</option>${[6,7,8,9,10].map((n) => `<option ${rpeVal == n ? "selected" : ""}>${n}</option>`).join("")}</select>` : `<span></span>`}
    </div>
    <div class="settarget">target ${esc(String(tgt))}</div>`;
  }
  let ladderCtl = "";
  if (ex.ladder) {
    ladderCtl = `<div class="rungadj"><span class="lt">Assigned: rung ${rung + 1} of ${ex.ladder.length}. Too easy or hard? Adjust:</span>
      <div class="row" style="gap:8px;margin-top:7px">
        <button class="qbtn" id="rung-down" style="flex:1" ${rung === 0 ? "disabled" : ""}>▼ easier</button>
        <button class="qbtn" id="rung-up" style="flex:1" ${rung >= ex.ladder.length - 1 ? "disabled" : ""}>harder ▲</button>
      </div></div>`;
  }
  const pct = Math.round((RUN.idx / total) * 100);
  VIEW.innerHTML = `
    <div class="runbar"><div class="runbar-fill" style="width:${pct}%"></div></div>
    ${RUN.date ? `<div class="banner">Backdating this session to ${esc(prettyDate(RUN.date))}. Enter what you actually did, or leave blank to log the target.</div>` : ""}
    <div class="card">
      <div class="row"><div class="name">${esc(ex.name)}</div><span class="pill">${timed ? `${pres.setsCount}× hold` : targetLabel(ex)}</span></div>
      ${ex.ladder ? `<div class="tiny muted" style="margin:-2px 0 4px">Variation: ${esc(displayName)}${timed ? " · timed hold" : ""}</div>` : ""}
      ${ex.ladder && timed ? `<div class="cue">Hold with good form as long as you can — no reps. Tap ‘time it’ to run the clock.</div>` : cueBlock(ex)}
      ${equipLine(ex)}${setupLine(ex)}
      ${warmupHint(exId)}
      <div class="meta">${ex.cat === "prehab" || (ex.cat === "mobility" && ex.load !== "time") ? "" : `<span class="pill ${prescribeLvl(pres)}">${esc(pres.note)}</span>`}${demoLink(ex)}<button class="linkbtn" id="run-swap">Swap →</button></div>
      ${lastLabel(exId) ? `<div class="lastnote">${esc(lastLabel(exId))}${ex.cat === "prehab" || (ex.cat === "mobility" && ex.load !== "time") ? "" : " → aim to beat it"}</div>` : ""}
      ${ladderCtl}
      <div class="sets">${setsHead}${rows}</div>
    </div>
    <div id="swap-panel"></div>
    <div class="restchips"><span class="label">Rest</span>${[60, 90, 120].map((s) => `<button class="qbtn" data-rest="${s}">${fmtClock(s)}</button>`).join("")}</div>
    <div class="runnav">
      ${RUN.idx > 0 ? `<button class="btn ghost" id="run-prev">← Prev</button>` : `<button class="btn ghost" id="run-cancel">Cancel</button>`}
      ${RUN.idx < total - 1 ? `<button class="btn" id="run-next">Next →</button>` : `<button class="btn good" id="run-finish">Finish &amp; save</button>`}
    </div>`;
  window.scrollTo(0, 0);
  document.querySelectorAll(".setdone").forEach((b) => b.onclick = () => {
    const on = b.classList.toggle("on");
    captureRun(exId);
    if (on) startRest(S.profile.restDefault || 90);
  });
  document.querySelectorAll("[data-rest]").forEach((b) => b.onclick = () => startRest(+b.dataset.rest));
  document.querySelectorAll("[data-hold]").forEach((b) => b.onclick = () => startHold(exId, +b.dataset.hold));
  const rdn = document.getElementById("rung-down"); if (rdn) rdn.onclick = () => { captureRun(exId); setRung(exId, assignedRung(exId) - 1); renderRunner(); };
  const rup = document.getElementById("rung-up"); if (rup) rup.onclick = () => { captureRun(exId); setRung(exId, assignedRung(exId) + 1); renderRunner(); };
  const prev = document.getElementById("run-prev"); if (prev) prev.onclick = () => { captureRun(exId); RUN.idx--; saveRun(); renderRunner(); };
  const cancel = document.getElementById("run-cancel"); if (cancel) cancel.onclick = () => { RUN = null; saveRun(); stopRest(); setTab("today"); };
  const next = document.getElementById("run-next"); if (next) next.onclick = () => { captureRun(exId); RUN.idx++; saveRun(); renderRunner(); };
  const fin = document.getElementById("run-finish"); if (fin) fin.onclick = () => { captureRun(exId); finishRun(); };
  document.getElementById("run-swap").onclick = () => renderSwapPanel(exId);
  document.querySelectorAll(".sets input, .sets select").forEach((el) => el.addEventListener("change", () => captureRun(exId)));
  bindCueToggles();
}

function captureRun(exId) {
  const ex = EXERCISES[exId];
  const pres = ex ? prescribe(exId) : null;
  const sets = [];
  document.querySelectorAll(".sets .setrow:not(.sethead)").forEach((row) => {
    const reps = row.querySelector('[data-f="reps"]'), load = row.querySelector('[data-f="load"]'), dist = row.querySelector('[data-f="dist"]'), rpe = row.querySelector('[data-f="rpe"]');
    const i = +reps.dataset.set;
    const done = row.querySelector(".setdone")?.classList.contains("on") || false;
    // Clamp to non-negative and reject garbage (NaN from e.g. a pasted non-numeric value) --
    // a negative rep count isn't just wrong, it can silently corrupt PR tracking (any nonzero
    // number, negative included, is truthy and could win an empty "best so far" comparison).
    const cleanNum = (v) => { if (v == null || v === "") return null; const n = Math.max(0, Number(v)); return isFinite(n) ? n : null; };
    let repsNum = cleanNum(reps.value);
    // A "done"-marked set with no typed number logs the prescribed target — tapping done = "I did this set".
    if (repsNum == null && done && pres && pres.perSet[i] && pres.perSet[i].reps != null) repsNum = pres.perSet[i].reps;
    let loadVal = load && load.value != null && load.value.trim() !== "" ? load.value.trim() : null;
    if (loadVal != null && isFinite(+loadVal) && +loadVal < 0) loadVal = null; // reject a negative numeric load; leave band-name text alone
    sets[i] = {
      reps: repsNum,
      load: loadVal,
      dist: dist ? cleanNum(dist.value) : null,
      unit: null,
      rpe: rpe && rpe.value !== "" ? Number(rpe.value) : null,
      done,
    };
  });
  RUN.data[exId] = sets;
  if (ex && ex.ladder) RUN.data[exId].variation = assignedVariation(exId);
  saveRun();
}

function renderSwapPanel(exId) {
  const panel = document.getElementById("swap-panel");
  panel.innerHTML = `<div class="card">
    <div class="lt">Why swap?</div>
    <div class="reasons">
      <button class="btn ghost" data-reason="equip">I don't have the equipment</button>
      <button class="btn ghost" data-reason="hurt">This hurts</button>
      <button class="btn ghost" data-reason="hard">Too hard</button>
      <button class="btn ghost" data-reason="easy">Too easy</button>
      <button class="btn ghost" data-reason="how">I don't know how</button>
    </div>
    <div id="swap-result"></div>
  </div>`;
  panel.querySelectorAll("[data-reason]").forEach((b) => b.onclick = () => swapReason(exId, b.dataset.reason));
}
function swapReason(exId, reason) {
  const res = document.getElementById("swap-result");
  const ex = EXERCISES[exId];
  if (reason === "how") {
    res.innerHTML = `<div class="howto">
      ${equipLine(ex)}${setupLine(ex)}
      <div class="cue" style="margin-top:6px">${esc(activeCue(ex))}</div>
      <div style="margin-top:8px">${demoLink(ex) || `<span class="tiny muted">No video — follow the setup above.</span>`}</div>
      <div class="tiny muted" style="margin-top:6px">Not swapped. Do it as described, or pick another reason.</div>
    </div>`;
    return;
  }
  if ((reason === "hard" || reason === "easy") && ex.ladder) {
    const r = assignedRung(exId);
    const atEnd = reason === "hard" ? r === 0 : r >= ex.ladder.length - 1;
    if (atEnd) {
      res.innerHTML = `<div class="tiny muted" style="margin:8px 0">Already the ${reason === "hard" ? "easiest" : "hardest"} variation — swapping the movement instead.</div>`;
      return swapAltList(exId, reason);
    }
    captureRun(exId); setRung(exId, reason === "hard" ? r - 1 : r + 1); renderRunner(); return;
  }
  swapAltList(exId, reason);
}
function swapAltList(exId, reason) {
  const res = document.getElementById("swap-result");
  let alts = ((typeof ALTS !== "undefined" && ALTS[exId]) || []).slice();
  if (reason === "equip") {
    const gearFree = (id) => !equipList(EXERCISES[id]).some((e) => /band|dumbbell|suspension/i.test(e));
    alts.sort((a, b) => (gearFree(b) ? 1 : 0) - (gearFree(a) ? 1 : 0));
  }
  if (!alts.length) { res.innerHTML = `<div class="tiny muted" style="margin-top:8px">No same-pattern alternative for this one. Try adjusting the difficulty, or skip it.</div>`; return; }
  res.innerHTML = `<div class="lt" style="margin-top:12px">Same movement, swap to</div>${
    alts.map((a) => { const e = EXERCISES[a]; return `<button class="btn ghost swapopt" data-swap="${a}"><span>${esc(e.name)}</span><span class="tiny muted">${esc(equipList(e).join(", ") || "no equipment")}</span></button>`; }).join("")
  }<div class="tiny muted" style="margin-top:8px">Sticks for future sessions. Undo in More → Equipment.</div>`;
  res.querySelectorAll("[data-swap]").forEach((b) => b.onclick = () => applySwap(b.dataset.swap));
}
function applySwap(altId) {
  const cur = RUN.list[RUN.idx];
  const origId = (RUN.rawList || RUN.list).find((o) => resolveEx(o) === cur) || cur;
  S.swaps[origId] = altId; S._m = Date.now(); save();
  RUN.list[RUN.idx] = altId; saveRun(); renderRunner();
}

function renderExercise(exId) {
  const ex = EXERCISES[exId];
  TITLE.textContent = ex.name;
  SUB.textContent = "History · best sets";
  const hist = [];
  S.workouts.forEach((w) => { const e = w.entries.find((x) => x.exId === exId); if (e) hist.push({ date: w.date, m: w._m || 0, sets: e.sets, variation: e.variation }); });
  (S.activity || []).forEach((a) => { const e = a.entries.find((x) => x.exId === exId); if (e) hist.push({ date: a.date, m: a._m || 0, sets: e.sets, variation: e.variation, tag: a.type }); });
  hist.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.m - b.m));
  const pts = [];
  hist.forEach((h) => { const top = Math.max(0, ...h.sets.map((s) => +s.reps || 0)); if (top) pts.push({ x: pts.length, y: top }); });
  let pr = null;
  hist.forEach((h) => h.sets.forEach((s) => { const r = +s.reps || 0; if (r > 0 && (!pr || r > pr.reps)) pr = { reps: r, load: s.load }; }));
  const rows = hist.slice().reverse().map((h) => {
    const sets = h.sets.map((s) => `${s.reps ?? "?"}${s.load ? "@" + s.load : ""}${s.rpe ? " (RPE" + s.rpe + ")" : ""}`).join(", ");
    return `<div class="row small" style="padding:8px 0;border-top:1px solid var(--line)"><span class="muted">${prettyDate(h.date)}${h.variation ? " · " + esc(h.variation) : ""}${h.tag ? ` · ${esc(h.tag)}` : ""}</span><span>${esc(sets)}</span></div>`;
  }).join("");
  VIEW.innerHTML = `
    <button class="btn ghost sm" id="ex-back" style="margin:8px 0 6px">← Back</button>
    <div class="card">
      <div class="row"><div class="name">${esc(ex.name)}</div><span class="pill">${targetLabel(ex)}</span></div>
      <div class="cue">${esc(activeCue(ex))}</div>
      <div class="meta">${demoLink(ex)}</div>
    </div>
    <div class="card">
      <div class="row"><div class="name">Top-set reps</div>${pr ? `<span class="pill good">PR ${pr.reps}${pr.load ? "@" + esc(String(pr.load)) : ""}</span>` : ""}</div>
      ${lineChart(pts, "#8A2B22")}
    </div>
    ${hist.length ? `<div class="card tight"><div class="small muted">History (${hist.length})</div>${rows}</div>` : `<div class="card tight tiny muted">No sessions logged yet.</div>`}`;
  document.getElementById("ex-back").onclick = () => setTab("today");
}

function renderReview() {
  const wkStart = weekStartStr(new Date());
  TITLE.textContent = "Weekly review";
  SUB.textContent = "Week of " + prettyDate(wkStart);
  const inWeek = (ds) => weekStartStr(new Date(ds.replace(/-/g, "/"))) === wkStart;
  const wkWorkouts = S.workouts.filter((w) => inWeek(w.date));
  const sw = sessionsThisWeek(), wt = S.profile.weeklyTarget || 4, streak = targetStreakWeeks();

  // PRs this week: top-set reps beat the prior best
  const prs = [];
  new Set(wkWorkouts.flatMap((w) => w.entries.map((e) => e.exId))).forEach((exId) => {
    let before = 0, now = 0;
    S.workouts.forEach((w) => {
      const e = w.entries.find((x) => x.exId === exId); if (!e) return;
      const top = Math.max(0, ...e.sets.map((s) => +s.reps || 0));
      if (inWeek(w.date)) now = Math.max(now, top); else before = Math.max(before, top);
    });
    if (now > before && before > 0) prs.push(`${EXERCISES[exId] ? EXERCISES[exId].name : exId} → ${now}`);
  });

  // body
  const m = S.measurements.filter((x) => x.weight != null);
  const lastW = m.length ? +m[m.length - 1].weight : null;
  const prevW = (() => { for (let i = m.length - 1; i >= 0; i--) if (!inWeek(m[i].date)) return +m[i].weight; return null; })();
  const wDelta = (lastW != null && prevW != null) ? +(lastW - prevW).toFixed(1) : null;
  const lastWaist = (() => { for (let i = m.length - 1; i >= 0; i--) if (m[i].waist != null) return m[i].waist; return null; })();

  // nutrition / walk / sleep this week
  const wkN = S.nutrition.filter((n) => inWeek(n.date) && n.protein != null);
  const proteinAvg = wkN.length ? Math.round(wkN.reduce((s, n) => s + (+n.protein || 0), 0) / wkN.length) : null;
  const proteinHit = wkN.filter((n) => (+n.protein || 0) >= (S.profile.proteinTarget || 0)).length;
  const wkW = S.walks.filter((w) => inWeek(w.date) && w.min != null);
  const walkAvg = wkW.length ? Math.round(wkW.reduce((s, w) => s + (+w.min || 0), 0) / wkW.length) : null;
  const wkWi = wkW.filter((w) => w.incline != null);
  const inclineAvg = wkWi.length ? (wkWi.reduce((s, w) => s + (+w.incline || 0), 0) / wkWi.length).toFixed(1) : null;
  const wkC = S.checkins.filter((c) => inWeek(c.date));
  const sleepV = wkC.filter((c) => c.sleep != null);
  const sleepAvg = sleepV.length ? (sleepV.reduce((s, c) => s + (+c.sleep), 0) / sleepV.length).toFixed(1) : null;
  const alcNights = wkC.filter((c) => c.flags && c.flags.alcohol).length;
  const wkAct = (S.activity || []).filter((a) => inWeek(a.date));
  const prehabN = wkAct.filter((a) => a.type === "prehab").length;
  const mobilityN = wkAct.filter((a) => a.type === "mobility").length;

  const row = (label, val) => `<div class="row small" style="padding:9px 0;border-top:1px solid var(--line)"><span class="muted">${label}</span><span>${val}</span></div>`;
  VIEW.innerHTML = `
    <button class="btn ghost sm" id="rv-back" style="margin:8px 0 6px">← Back</button>
    <div class="masthead" style="border:none;padding-bottom:8px">
      <div class="mast-main">
        <div class="mast-letter">${sw}</div>
        <div class="mast-name"><div class="mast-title">of ${wt} sessions</div><div class="mast-focus">${streak} week on-target streak</div></div>
      </div>
    </div>
    ${prs.length ? `<div class="blk-title"><span class="dot"></span>PRs this week</div><div class="card">${prs.map((p) => `<div class="row small" style="padding:7px 0;border-top:1px solid var(--line)"><span>${esc(p.split(" → ")[0])}</span><span class="pill good">${esc(p.split(" → ")[1])}</span></div>`).join("")}</div>` : ""}
    <div class="blk-title"><span class="dot"></span>Body</div>
    <div class="card tight">
      ${row("Weight", lastW != null ? `${lastW} lb${wDelta != null ? ` <span class="pill ${wDelta <= 0 ? "good" : "acc"}">${wDelta > 0 ? "+" : ""}${wDelta}</span>` : ""}` : "—")}
      ${row("Waist", lastWaist != null ? `${lastWaist} in` : "not logged")}
    </div>
    <div class="blk-title"><span class="dot"></span>Fuel &amp; movement</div>
    <div class="card tight">
      ${row("Protein", proteinAvg != null ? `${proteinAvg} g/day avg · hit target ${proteinHit}/${wkN.length}d` : "not logged")}
      ${row("Walking", walkAvg != null ? `${walkAvg} min/day · ${wkW.length} days${inclineAvg != null ? ` · incline ${inclineAvg}/12 avg` : ""}` : "not logged")}
      ${row("Sleep", sleepAvg != null ? `${sleepAvg} h avg` : "not logged")}
      ${row("Alcohol", `${alcNights} night${alcNights === 1 ? "" : "s"}`)}
    </div>
    <div class="blk-title"><span class="dot"></span>Recovery work</div>
    <div class="card tight">
      ${row("Prehab", `${prehabN} session${prehabN === 1 ? "" : "s"}`)}
      ${row("Mobility", `${mobilityN} session${mobilityN === 1 ? "" : "s"}`)}
    </div>
    <div class="blk-title"><span class="dot"></span>Sessions this week</div>
    <div class="card tight">${wkWorkouts.length ? wkWorkouts.map((w) => `<div class="row small" style="padding:7px 0;border-top:1px solid var(--line)"><span class="muted">${prettyDate(w.date)}</span><span>${esc(w.sessionKey)}</span></div>`).join("") : `<div class="tiny muted">No sessions logged yet this week.</div>`}</div>
    <button class="btn" id="rv-export" style="margin-top:16px">Copy full summary for Claude</button>`;
  document.getElementById("rv-back").onclick = () => setTab("more");
  document.getElementById("rv-export").onclick = async () => {
    try { await navigator.clipboard.writeText(buildExport()); toast("Copied — paste to Claude"); }
    catch (e) { toast("Use More → export"); }
  };
}

function renderHelp() {
  TITLE.textContent = "Help & guide";
  SUB.textContent = "How Forge works";
  const d = (term, desc) => `<div class="ex"><div class="name">${term}</div><div class="cue">${desc}</div></div>`;
  VIEW.innerHTML = `
    <button class="btn ghost sm" id="hp-back" style="margin:8px 0 6px">← Back</button>

    <div class="blk-title"><span class="dot"></span>The daily flow</div>
    <div class="card">
      ${d("1 · Check in", "15 seconds: energy, sleep, pain. Sets your <b>readiness</b> for the day and adjusts today's targets.")}
      ${d("2 · Start &amp; log session", "The guided runner walks you through each exercise one at a time, with a target and a rest timer.")}
      ${d("3 · Protein &amp; walk", "Tap to log them through the day, against your targets.")}
      ${d("Weekly", "Log measurements + a photo, then More → Weekly review, and send me the export to re-tune.")}
    </div>

    <div class="blk-title"><span class="dot"></span>Reading a workout</div>
    <div class="card">
      ${d("3×8–12", "3 sets of 8 to 12 reps. \"/side\" means per side. Timed work shows minutes:seconds (5:00 = 5 min).")}
      ${d("RPE (6–10)", "How hard the set felt. 10 = nothing left in the tank; 8 ≈ 2 reps in reserve. <b>Log it honestly</b> — the app uses it to decide when to push you.")}
      ${d("When to go to failure", "The target under each set says it: earlier sets, leave ~2 reps in reserve (RPE 8) — hard, but not a grind. The <b>last set of each strength move, push close to true failure</b> — that's where most of the growth signal comes from. Prehab/core sets aren't rated this way; those aren't about maxing effort.")}
      ${d("Target", "The number to beat, pre-filled with what you actually did last time — or, right after a weight step-up, reset to the bottom of the rep range at the new heavier load.")}
      ${d("Swap", "Sub an exercise (e.g. the shoulder flares up). It sticks for future sessions; undo in More → Equipment.")}
      ${d("Variation", "For progressions (push-up, pull-up, chin-up) — which rung of the ladder you're on.")}
      ${d("Rest timer", "Tap a preset; it counts down and beeps/vibrates at zero.")}
    </div>

    <div class="blk-title"><span class="dot"></span>Readiness (0–100)</div>
    <div class="card">
      <div class="cue" style="margin:2px 0 10px">A daily score from your check-in that scales the whole session — both directions.</div>
      ${d("How it's built", "Starts ~60 (a normal day). <b>Energy</b> is the biggest lever. Good sleep &amp; quality add; poor subtract. Pain flags subtract (shoulder counts double). Several days training in a row subtract a little for fatigue. Capped 0–100.")}
      ${d("What it does", "<b>Primed</b> (75+) + cruising two sessions running: +1 set, push load. <b>Ready/Moderate</b> (44+): no change — pre-workout state predicts capacity poorly, so a normal-ish day trains normally; real fatigue shows up as underperforming a set, which progression reacts to next session. <b>Low</b> (&lt;44, usually real pain flags or bad sleep): one fewer set per exercise, not a big cut — push the sets you do.")}
    </div>

    <div class="blk-title"><span class="dot"></span>How it adapts</div>
    <div class="card">
      ${d("Progression", "Double progression: beat last time's reps within the range. Hit the <b>top</b> of the range at an easy RPE → for a bodyweight ladder it suggests a harder variation; for a real weight (once Dumbbells are on in More → Equipment) it auto-steps the load and resets reps to the bottom of the range for you.")}
      ${d("Momentum", "Clear a lift's top range two sessions running → \"cruising,\" it pushes you to load up instead of creeping one rep at a time.")}
      ${d("Stall", "No new best in 3 sessions on a lift → it suggests swapping or deloading <i>that</i> lift so you don't grind a plateau.")}
      ${d("Measurement stall", "Log a chest/shoulder/arm/thigh measurement in More → Weekly review that hasn't moved in ~3 weeks despite real training (4+ sessions hitting it) → that muscle's priority in session generation gets bumped automatically. Closes the loop between your logged progress and what gets trained, instead of that being a manual weekly re-tune.")}
      ${d("Weight/waist stall", "If weight and waist/belly both sit flat for ~3 weeks despite consistent training, Today shows a banner — but it doesn't touch your training. Fat loss stalling is a nutrition signal, not a reason to add more sets.")}
      ${d("Deload", "A lighter recovery week, auto-flagged after shoulder pain 3+ days, low energy 3+ days, or ~4 weeks training straight. Cuts volume ~40%, holds load.")}
      ${d("Recovery nudge", "5+ days in a row → suggests a mobility day.")}
      ${d("Warm-up", "The first real-weight exercise of a session (once Dumbbells are on) gets a one-line ramp-up reminder — 1–2 easy sets before the working ones. Not tracked or logged, just a nudge before real external load.")}
    </div>

    <div class="blk-title"><span class="dot"></span>Sessions &amp; routines</div>
    <div class="card">
      ${d("Today's session", "No fixed rotation — it's assembled live each time from what's actually due: which muscles haven't been trained recently (weighted by priority), today's readiness, and pain flags. The \"Why\" line under the title explains the picks. Don't like it? Tap Regenerate.")}
      ${d("Prehab", "The short scapula/posture warm-up block that opens each session — 3 of 4 corrective drills, rotated.")}
      ${d("Daily prehab / Mobility", "Standalone off-day routines (dead hangs, stretches). Logged separately from real sessions — counts toward a \"rehab/mobility\" tally on Today and in the weekly review, and feeds into what counts as \"recently trained\" for the next generated session.")}
      ${d("Bodyweight mode", "More → Equipment. One tap swaps every band/dumbbell move to a bodyweight or backpack version when you've no gear.")}
    </div>

    <div class="blk-title"><span class="dot"></span>Buddy &amp; data</div>
    <div class="card">
      ${d("Buddy", "Join a shared group code with a friend to see each other's weekly progress. Enable notifications to get pinged when they train, or Poke them.")}
      ${d("Streak", "Consecutive weeks you hit your session target.")}
      ${d("Your data", "Stored on your device. Sync (More) backs it up and shares it across <i>your</i> devices via a passphrase. Buddy shares only summaries — never your raw log. Photos never leave your phone.")}
    </div>

    <div class="card tight tiny muted center">The app is the day-to-day coach; the weekly export to Claude is the strategy layer. Log honestly — it only gets smarter with real data.</div>`;
  document.getElementById("hp-back").onclick = () => setTab("more");
}

function collectRunEntries() {
  const entries = Object.entries(RUN.data).map(([exId, sets]) => {
    const variation = sets.variation;
    const clean = sets.filter((s) => s && (s.reps != null || s.load != null || s.dist != null))
      .map((s) => { const o = { reps: s.reps, load: s.load, unit: s.unit, rpe: s.rpe }; if (s.dist != null) o.dist = s.dist; return o; });
    const e = { exId, sets: clean };
    if (variation) e.variation = variation;
    return e;
  }).filter((e) => e.sets.length);
  // Safety net: reached exercises with nothing typed/marked still count at their prescribed target,
  // so "Finish & save" never silently no-ops just because you tapped through without logging.
  if (!entries.length) {
    Object.keys(RUN.data).forEach((exId) => {
      const ex = EXERCISES[exId]; if (!ex) return;
      const pres = prescribe(exId);
      const sets = pres.perSet.map((p) => ({ reps: p.reps ?? null, load: p.load ?? null, unit: null, rpe: null })).filter((s) => s.reps != null);
      if (!sets.length) return;
      const e = { exId, sets };
      if (ex.ladder) e.variation = assignedVariation(exId);
      entries.push(e);
    });
  }
  return entries;
}
// auto-advance progression rungs when the criterion is met — applies during real sessions
// AND off-day prehab/mobility, since e.g. dead hang is a mobility-only move with its own ladder.
function advanceLadders(entries) {
  const leveled = [];
  entries.forEach((e) => {
    const ex = EXERCISES[e.exId];
    if (!ex || !ex.ladder) return;
    const r = assignedRung(e.exId);
    if (r >= ex.ladder.length - 1) return;
    const top = Math.max(0, ...e.sets.map((s) => +s.reps || 0));
    // Same reasoning as prescribe()'s hitTop: the last set is meant to be pushed near failure,
    // so only the earlier sets need to have stayed comfortable for this to count as a clean clear.
    const clearedRpe = e.sets.slice(0, -1).every((s) => !s.rpe || s.rpe <= 8);
    const advance = isTimedVariation(ex.ladder[r], ex) ? top >= 45 : (top >= ex.target.hi && clearedRpe);
    if (advance) { S.ladders[e.exId] = r + 1; leveled.push(ex.ladder[r + 1].replace(/\s*\(time\)/i, "")); }
  });
  return leveled;
}
function finishRun() {
  const entries = collectRunEntries();
  if (!entries.length) { toast("Mark a set done (tap its number) so it saves"); return; }
  const leveled = advanceLadders(entries);
  const date = RUN.date || today();
  if (RUN.isPrehab) {
    const type = RUN.activityType;
    const title = RUN.title;
    insertActivitySorted({ id: Date.now(), date, type, title, entries, _m: Date.now() });
    S._m = Date.now();
    save();
    stopRest();
    RUN = null;
    saveRun();
    toast(leveled.length ? `Leveled up → ${leveled[0]}` : `${title} logged`);
    setTab("today");
    return;
  }
  const note = RUN.date ? "Backdated manual entry" : "";
  insertWorkoutSorted({ id: Date.now(), date, sessionKey: RUN.title, entries, note, _m: Date.now() });
  S._m = Date.now();
  save();
  stopRest();
  RUN = null;
  saveRun();
  toast(leveled.length ? `Leveled up → ${leveled[0]}` : "Workout saved");
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
    </div>
    <div class="card">
      <div class="name">Sleep last night</div>
      <label class="fld"><span class="lt">Hours</span>
        <input id="ci-sleep" inputmode="decimal" placeholder="e.g. 7" value="${esc(ci.sleep ?? "")}" /></label>
      <div class="fld"><span class="lt">Quality (1 = poor, 5 = great)</span>
        <div class="seg" id="seg-quality">
          ${[1,2,3,4,5].map((n) => `<button data-q="${n}" class="${ci.sleepQuality === n ? "on" : ""}">${n}</button>`).join("")}
        </div></div>
      <div class="fld"><span class="lt">Last night — tap any that apply</span>
        <div class="flags" id="ci-flags">
          ${[["alcohol", "Alcohol"], ["caffeine", "Caffeine pm"], ["screens", "Screens in bed"]].map(([k, l]) => `<button data-flag="${k}" class="flagbtn ${ci.flags && ci.flags[k] ? "on" : ""}">${l}</button>`).join("")}
        </div></div>
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
  let sleepQuality = ci.sleepQuality || 0;
  const flags = Object.assign({ alcohol: false, caffeine: false, screens: false }, ci.flags || {});
  const pains = {};
  (ci.pains || []).forEach((p) => (pains[p.area] = p.sev));

  document.querySelectorAll("#seg-energy button").forEach((b) => b.onclick = () => {
    energy = +b.dataset.v;
    document.querySelectorAll("#seg-energy button").forEach((x) => x.classList.toggle("on", x === b));
  });
  document.querySelectorAll("#seg-quality button").forEach((b) => b.onclick = () => {
    sleepQuality = +b.dataset.q;
    document.querySelectorAll("#seg-quality button").forEach((x) => x.classList.toggle("on", x === b));
  });
  document.querySelectorAll("#ci-flags .flagbtn").forEach((b) => b.onclick = () => {
    flags[b.dataset.flag] = !flags[b.dataset.flag];
    b.classList.toggle("on", flags[b.dataset.flag]);
  });
  document.querySelectorAll(".seg.pain").forEach((seg) => {
    seg.querySelectorAll("button").forEach((b) => b.onclick = () => {
      pains[seg.dataset.pain] = +b.dataset.sev;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
  });
  document.getElementById("save-ci").onclick = () => {
    const rec = {
      date: today(), energy, sleepQuality,
      sleep: document.getElementById("ci-sleep").value.trim() === "" ? null : Number(document.getElementById("ci-sleep").value),
      flags: { ...flags },
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
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}
    <text x="${W - pr}" y="12" fill="${color}" font-size="11" text-anchor="end">${esc(String(lbl))}</text>
    <text x="${pl}" y="${H - 3}" fill="#837B6A" font-size="9">${esc(opts.first || String(first))}</text>
  </svg>`;
}

/* ---------- progress-at-a-glance ---------- */
function trendVal(field, days) {
  const m = S.measurements.filter((x) => x[field] != null);
  if (!m.length) return null;
  const now = +m[m.length - 1][field];
  if (days == null) return m.length > 1 ? +(now - (+m[0][field])).toFixed(1) : null;
  let past = null;
  for (let i = m.length - 1; i >= 0; i--) { if (daysAgo(m[i].date) >= days) { past = +m[i][field]; break; } }
  return past != null ? +(now - past).toFixed(1) : null;
}
function prsSince(days) {
  let n = 0;
  new Set(S.workouts.filter((w) => daysAgo(w.date) <= days).flatMap((w) => w.entries.map((e) => e.exId))).forEach((exId) => {
    let before = 0, recent = 0;
    S.workouts.forEach((w) => { const e = w.entries.find((x) => x.exId === exId); if (!e) return; const top = Math.max(0, ...e.sets.map((s) => +s.reps || 0)); if (daysAgo(w.date) <= days) recent = Math.max(recent, top); else before = Math.max(before, top); });
    if (recent > before && before > 0) n++;
  });
  return n;
}
function weeksTraining() { return new Set(S.workouts.map((w) => weekStartStr(new Date(w.date.replace(/-/g, "/"))))).size; }
// U.S. Navy body-fat estimate (men, inches): needs neck + belly-at-navel + height.
function navyBF(m) {
  if (!m || m.neck == null || m.belly == null) return null;
  const h = S.profile.heightIn;
  if (!h || +m.belly <= +m.neck) return null;
  return +(86.010 * Math.log10(+m.belly - +m.neck) - 70.041 * Math.log10(h) + 36.76).toFixed(1);
}
function bfDelta(days) {
  const b = S.measurements.map((x) => ({ date: x.date, bf: navyBF(x) })).filter((x) => x.bf != null);
  if (!b.length) return null;
  const now = b[b.length - 1].bf;
  if (days == null) return b.length > 1 ? +(now - b[0].bf).toFixed(1) : null;
  let past = null;
  for (let i = b.length - 1; i >= 0; i--) { if (daysAgo(b[i].date) >= days) { past = b[i].bf; break; } }
  return past != null ? +(now - past).toFixed(1) : null;
}
function armSymmetry(m) {
  if (!m || m.armL == null || m.armR == null) return null;
  const diff = +(+m.armR - +m.armL).toFixed(2);
  return { l: m.armL, r: m.armR, diff, bigger: diff > 0 ? "R" : diff < 0 ? "L" : "even" };
}
function glanceItem(label, delta, unit, lowerGood) {
  if (delta == null) return `<div class="gi"><div class="gi-v muted">–</div><div class="gi-l">${label}</div></div>`;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  const cls = delta === 0 ? "" : (lowerGood ? delta < 0 : delta > 0) ? "gi-good" : "gi-bad";
  return `<div class="gi"><div class="gi-v ${cls}">${arrow}${Math.abs(delta)}${unit}</div><div class="gi-l">${label}</div></div>`;
}
function glanceStat(val, label) { return `<div class="gi"><div class="gi-v">${val}</div><div class="gi-l">${label}</div></div>`; }

/* ---------- PROGRESS ---------- */
function renderProgress() {
  TITLE.textContent = "Progress";
  SUB.textContent = `${S.workouts.length} workouts logged`;
  const m = S.measurements;
  const lastM = m[m.length - 1];

  const wPoints = m.filter((x) => x.weight != null).map((x, i) => ({ x: i, y: +x.weight }));
  const ePoints = S.checkins.filter((c) => c.energy).map((c, i) => ({ x: i, y: c.energy }));
  const rhrPoints = m.filter((x) => x.rhr != null).map((x, i) => ({ x: i, y: +x.rhr }));
  const bfPoints = []; m.forEach((x) => { const v = navyBF(x); if (v != null) bfPoints.push({ x: bfPoints.length, y: v }); });
  const latestBF = navyBF(lastM);
  const sym = armSymmetry(lastM);

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
    <div class="blk-title"><span class="dot"></span>At a glance</div>
    <div class="card">
      <div class="lt">Last 7 days</div>
      <div class="glance">
        ${glanceItem("Weight", trendVal("weight", 7), "lb", true)}
        ${glanceItem("Belly", trendVal("belly", 7), "in", true)}
        ${glanceStat(S.workouts.filter((w) => daysAgo(w.date) <= 7).length, "sessions")}
        ${glanceStat(prsSince(7), "PRs")}
      </div>
      <div class="lt" style="margin-top:16px">Since start</div>
      <div class="glance">
        ${glanceItem("Weight", trendVal("weight", null), "lb", true)}
        ${glanceItem("Belly", trendVal("belly", null), "in", true)}
        ${glanceItem("Body fat", bfDelta(null), "%", true)}
        ${glanceStat(S.workouts.length, "workouts")}
      </div>
    </div>
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
    <div class="blk-title"><span class="dot"></span>Health</div>
    <div class="card">
      <div class="row"><div class="name">Resting HR</div>
        <span>${lastM && lastM.bpSys ? `<span class="pill">BP ${esc(lastM.bpSys)}/${esc(lastM.bpDia ?? "?")}</span> ` : ""}${lastM && lastM.readiness ? `<span class="pill">Ready ${esc(lastM.readiness)}</span>` : ""}</span></div>
      ${lineChart(rhrPoints, "#16140F", { fmt: (v) => v + " bpm" })}
    </div>
    <div class="blk-title"><span class="dot"></span>Body composition</div>
    <div class="card">
      <div class="row"><div class="name">Est. body fat</div>${latestBF != null ? `<span class="pill">${latestBF}%</span>` : `<span class="pill">log neck + belly</span>`}</div>
      ${bfPoints.length ? lineChart(bfPoints, "#8A2B22", { fmt: (v) => v + "%" }) : `<div class="chart-empty">Log neck + belly (navel) to estimate body fat.</div>`}
      <div class="row small" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><span class="muted">Belly (navel)</span><span>${lastM?.belly != null ? lastM.belly + " in" : "—"}</span></div>
      <div class="row small" style="padding:8px 0"><span class="muted">Arms L / R</span><span>${sym ? `${sym.l} / ${sym.r} in${sym.diff !== 0 ? ` · ${sym.bigger}+${Math.abs(sym.diff)}` : " · even"}` : "—"}</span></div>
    </div>

    <div class="blk-title"><span class="dot"></span>Log measurements</div>
    <div class="card">
      <div class="tiny muted">Tape at the same spot, relaxed. Weekly. Body-fat estimate needs neck + belly.</div>
      <div class="lt" style="margin-top:14px">Body</div>
      <div class="grid2">
        <label class="fld"><span class="lt">Bodyweight (lb)</span><input id="m-weight" inputmode="decimal" placeholder="${esc(lastM?.weight ?? S.profile.startWeight)}"/></label>
        <label class="fld"><span class="lt">Neck (in)</span><input id="m-neck" inputmode="decimal" placeholder="${esc(lastM?.neck ?? "")}"/></label>
        <label class="fld"><span class="lt">Chest (in)</span><input id="m-chest" inputmode="decimal" placeholder="${esc(lastM?.chest ?? "")}"/></label>
        <label class="fld"><span class="lt">Shoulders (in)</span><input id="m-shoulders" inputmode="decimal" placeholder="${esc(lastM?.shoulders ?? "")}"/></label>
      </div>
      <div class="lt" style="margin-top:16px">Torso</div>
      <div class="grid2">
        <label class="fld"><span class="lt">Waist — pants (in)</span><input id="m-waist" inputmode="decimal" placeholder="${esc(lastM?.waist ?? "")}"/></label>
        <label class="fld"><span class="lt">Belly — navel (in)</span><input id="m-belly" inputmode="decimal" placeholder="${esc(lastM?.belly ?? "")}"/></label>
        <label class="fld"><span class="lt">Hips (in)</span><input id="m-hips" inputmode="decimal" placeholder="${esc(lastM?.hips ?? "")}"/></label>
      </div>
      <div class="lt" style="margin-top:16px">Arms</div>
      <div class="grid2">
        <label class="fld"><span class="lt">Left arm (in)</span><input id="m-armL" inputmode="decimal" placeholder="${esc(lastM?.armL ?? "")}"/></label>
        <label class="fld"><span class="lt">Right arm (in)</span><input id="m-armR" inputmode="decimal" placeholder="${esc(lastM?.armR ?? "")}"/></label>
      </div>
      <div class="lt" style="margin-top:16px">Legs</div>
      <div class="grid2">
        <label class="fld"><span class="lt">Left thigh (in)</span><input id="m-thighL" inputmode="decimal" placeholder="${esc(lastM?.thighL ?? "")}"/></label>
        <label class="fld"><span class="lt">Right thigh (in)</span><input id="m-thighR" inputmode="decimal" placeholder="${esc(lastM?.thighR ?? "")}"/></label>
        <label class="fld"><span class="lt">Left calf (in)</span><input id="m-calfL" inputmode="decimal" placeholder="${esc(lastM?.calfL ?? "")}"/></label>
        <label class="fld"><span class="lt">Right calf (in)</span><input id="m-calfR" inputmode="decimal" placeholder="${esc(lastM?.calfR ?? "")}"/></label>
      </div>
      <div class="lt" style="margin-top:16px">Health (optional)</div>
      <div class="grid2">
        <label class="fld"><span class="lt">Resting HR (bpm)</span><input id="m-rhr" inputmode="numeric" placeholder="${esc(lastM?.rhr ?? "")}"/></label>
        <label class="fld"><span class="lt">BP systolic</span><input id="m-bps" inputmode="numeric" placeholder="${esc(lastM?.bpSys ?? "")}"/></label>
        <label class="fld"><span class="lt">BP diastolic</span><input id="m-bpd" inputmode="numeric" placeholder="${esc(lastM?.bpDia ?? "")}"/></label>
      </div>
      <button class="btn" id="save-m" style="margin-top:16px">Save measurements</button>
    </div>
    ${m.length ? `<div class="card tight"><div class="small muted">History</div>${
      m.slice().reverse().slice(0, 8).map((x) => { const bf = navyBF(x); return `<div class="row small" style="padding:6px 0;border-top:1px solid var(--line)">
        <span class="muted">${prettyDate(x.date)}</span>
        <span>${[x.weight && x.weight + "lb", x.belly && "belly " + x.belly, bf != null && bf + "%", (x.armL != null || x.armR != null) && `arms ${x.armL ?? "?"}/${x.armR ?? "?"}`].filter(Boolean).join(" · ") || "–"}</span></div>`; }).join("")
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
    const g = (id) => { const el = document.getElementById(id); const v = el ? el.value.trim() : ""; return v === "" ? null : Number(v); };
    const rec = { date: today(), weight: g("m-weight"), neck: g("m-neck"), chest: g("m-chest"), shoulders: g("m-shoulders"),
      waist: g("m-waist"), belly: g("m-belly"), hips: g("m-hips"), armL: g("m-armL"), armR: g("m-armR"),
      thighL: g("m-thighL"), thighR: g("m-thighR"), calfL: g("m-calfL"), calfR: g("m-calfR"),
      rhr: g("m-rhr"), bpSys: g("m-bps"), bpDia: g("m-bpd"), _m: Date.now() };
    if (Object.entries(rec).filter(([k]) => k !== "date" && k !== "_m").every(([, v]) => v == null)) { toast("Enter at least one"); return; }
    const i = S.measurements.findIndex((x) => x.date === today());
    if (i >= 0) { for (const [k, v] of Object.entries(rec)) if (v != null) S.measurements[i][k] = v; S.measurements[i]._m = Date.now(); }
    else S.measurements.push(rec);
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
  if (lastM) { const bf = navyBF(lastM); md += `Latest: ${[lastM.weight && lastM.weight + "lb", bf != null && "~" + bf + "% bf", lastM.belly && "belly " + lastM.belly, lastM.waist && "waist(pants) " + lastM.waist, lastM.chest && "chest " + lastM.chest, (lastM.armL || lastM.armR) && `arms ${lastM.armL ?? "?"}/${lastM.armR ?? "?"}`, (lastM.thighL || lastM.thighR) && `thighs ${lastM.thighL ?? "?"}/${lastM.thighR ?? "?"}`, lastM.hips && "hips " + lastM.hips].filter(Boolean).join(", ")}`; }
  if (firstM && lastM && firstM !== lastM && firstM.weight && lastM.weight) md += ` (Δ ${(lastM.weight - firstM.weight).toFixed(1)}lb from first measure)`;
  md += `\n\n## Check-ins (last week)\n`;
  if (!recentC.length) md += `_none logged_\n`;
  recentC.forEach((c) => {
    const pains = (c.pains || []).filter((p) => p.sev > 0).map((p) => `${p.area}=${["none","mild","mod","sharp"][p.sev]}`).join(", ");
    const fl = c.flags ? Object.entries(c.flags).filter(([, v]) => v).map(([k]) => k).join("/") : "";
    md += `- ${c.date}: energy ${c.energy}/5, sleep ${c.sleep ?? "?"}h${c.sleepQuality ? ` q${c.sleepQuality}/5` : ""}${fl ? ` [${fl}]` : ""}${pains ? `, PAIN: ${pains}` : ""}${c.note ? ` — ${c.note}` : ""}\n`;
  });
  md += `\n## Workouts (last week)\n`;
  if (!recentW.length) md += `_none logged_\n`;
  recentW.forEach((w) => {
    md += `\n**${w.date} — ${w.sessionKey}**\n`;
    w.entries.forEach((e) => {
      const ex = EXERCISES[e.exId];
      const sets = e.sets.map((s) => `${s.reps ?? "?"}${s.load ? "@" + s.load : ""}${s.rpe ? " (RPE" + s.rpe + ")" : ""}`).join(", ");
      md += `- ${ex.name}${e.variation ? ` [${e.variation}]` : ""}: ${sets}\n`;
    });
    if (w.note) md += `  _note: ${w.note}_\n`;
  });
  const recentAct = (S.activity || []).filter((a) => daysAgo(a.date) <= cutoff);
  if (recentAct.length) {
    md += `\n## Recovery work (last week)\n`;
    recentAct.forEach((a) => {
      md += `\n**${a.date} — ${a.title}**\n`;
      a.entries.forEach((e) => {
        const ex = EXERCISES[e.exId];
        const sets = e.sets.map((s) => `${s.reps ?? "?"}${s.load ? "@" + s.load : ""}`).join(", ");
        md += `- ${ex.name}${e.variation ? ` [${e.variation}]` : ""}: ${sets}\n`;
      });
    });
  }
  md += `\n## Adherence & nutrition\n`;
  md += `- This week: ${sessionsThisWeek()}/${S.profile.weeklyTarget} sessions, ${targetStreakWeeks()} wk on-target streak\n`;
  if (recentAct.length) {
    const pN = recentAct.filter((a) => a.type === "prehab").length, mN = recentAct.filter((a) => a.type === "mobility").length;
    md += `- Recovery work: ${pN} prehab + ${mN} mobility session(s) over the last week\n`;
  }
  const recentN = S.nutrition.filter((n) => daysAgo(n.date) <= 8 && n.protein != null);
  if (recentN.length) {
    const avg = Math.round(recentN.reduce((s, n) => s + (+n.protein || 0), 0) / recentN.length);
    md += `- Protein: avg ${avg} g/day over ${recentN.length} logged days (target ${S.profile.proteinTarget})\n`;
  } else { md += `- Protein: not logged\n`; }
  const recentWk = S.walks.filter((w) => daysAgo(w.date) <= 8 && w.min != null);
  if (recentWk.length) {
    const wavg = Math.round(recentWk.reduce((s, w) => s + (+w.min || 0), 0) / recentWk.length);
    const wkInc = recentWk.filter((w) => w.incline != null);
    const iavg = wkInc.length ? (wkInc.reduce((s, w) => s + (+w.incline || 0), 0) / wkInc.length).toFixed(1) : null;
    md += `- Walking: avg ${wavg} min/day over ${recentWk.length} days${iavg != null ? `, avg incline ${iavg}/12` : ""}\n`;
  }
  const sc = S.checkins.filter((c) => c.sleep != null);
  if (sc.length) {
    const avgH = (sc.reduce((s, c) => s + (+c.sleep), 0) / sc.length).toFixed(1);
    const q = S.checkins.filter((c) => c.sleepQuality);
    const avgQ = q.length ? (q.reduce((s, c) => s + c.sleepQuality, 0) / q.length).toFixed(1) : "–";
    md += `- Sleep: avg ${avgH}h, quality ${avgQ}/5 over ${sc.length} nights\n`;
    const withE = S.checkins.filter((c) => c.energy && c.flags);
    const avg = (arr) => arr.length ? (arr.reduce((s, c) => s + c.energy, 0) / arr.length).toFixed(1) : null;
    const al = withE.filter((c) => c.flags.alcohol), no = withE.filter((c) => !c.flags.alcohol);
    if (al.length && no.length) md += `- Energy: ${avg(no)}/5 alcohol-free vs ${avg(al)}/5 after alcohol (n=${no.length}/${al.length})\n`;
  }
  md += `\n---\n_Paste this back to Claude for the weekly re-tune._\n`;
  return md;
}

function renderMore() {
  TITLE.textContent = "More";
  SUB.textContent = "Review · sync · export";
  VIEW.innerHTML = `
    <button class="btn good" id="open-review" style="margin:6px 0 4px">Weekly review →</button>
    <button class="btn ghost" id="open-help" style="margin:8px 0 4px">Help &amp; guide</button>
    <div class="blk-title"><span class="dot"></span>Sync across devices</div>
    <div class="card">
      <div class="small muted" id="sync-status">${esc(syncStatusText())}</div>
      ${syncEmptyWarn ? `<div class="banner warn"><div>No data found for this passphrase — it's either brand new, or there's a typo. The passphrase is matched exactly as typed (one wrong letter = a totally different, empty account). If you've synced before, double-check for a typo before logging fresh data here.</div></div>` : ""}
      <label class="fld"><span class="lt">Passphrase (same on every device)</span>
        <input id="sync-key" type="password" placeholder="8+ characters" value="${esc(SY.key || "")}"/></label>
      <button class="btn" id="sync-connect" style="margin-top:12px">${SY.key ? "Sync now" : "Connect & sync"}</button>
      ${SY.key ? `<button class="btn ghost" id="sync-off" style="margin-top:8px">Disconnect this device</button>` : ""}
      <div class="tiny muted" style="margin-top:10px">Use the same passphrase on each device to share data. Anyone with it can read your log, so make it long. Data syncs on open, on change, and when you return to the app.</div>
    </div>
    <div class="blk-title"><span class="dot"></span>Log a past session</div>
    <div class="card">
      <div class="small muted">Trained but it never saved, or forgot to log same-day? Pick the date — it generates a session and opens the normal guided runner backdated to that day.</div>
      <label class="fld" style="margin-top:12px"><span class="lt">Date</span>
        <input id="bd-date" type="date" max="${esc(today())}" value="${esc(yesterday())}"/></label>
      <button class="btn ghost" id="bd-go" style="margin-top:10px">Generate & log</button>
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
    <div class="blk-title"><span class="dot"></span>Equipment</div>
    <div class="card">
      <div class="tiny muted">Pull-up bar and rower are assumed. No bands yet? Use bodyweight mode — it swaps every band move to a bodyweight/backpack version. Toggle gear as it arrives.</div>
      <button class="btn ${isBodyweightMode() ? "" : "ghost"}" id="bw-mode" style="margin-top:12px">${isBodyweightMode() ? "Bodyweight mode ON — restore band program" : "No bands/dumbbells yet → bodyweight mode"}</button>
      <div class="flags" id="equip-flags" style="margin-top:12px">
        ${[["dumbbells", "Dumbbells"], ["suspension", "Suspension trainer"]].map(([k, l]) => `<button data-equip="${k}" class="flagbtn ${S.equipment[k] ? "on" : ""}">${l}</button>`).join("")}
      </div>
      ${Object.keys(S.swaps || {}).length ? `<button class="btn ghost" id="reset-swaps" style="margin-top:12px">Reset all ${Object.keys(S.swaps).length} swap(s)</button>` : ""}
    </div>
    <div class="blk-title"><span class="dot"></span>Profile</div>
    <div class="card">
      <div class="grid2">
        <label class="fld"><span class="lt">Height (in)</span><input id="p-h" inputmode="decimal" value="${esc(S.profile.heightIn)}"/></label>
        <label class="fld"><span class="lt">Start weight (lb)</span><input id="p-w" inputmode="decimal" value="${esc(S.profile.startWeight)}"/></label>
        <label class="fld"><span class="lt">Protein target (g)</span><input id="p-prot" inputmode="numeric" value="${esc(S.profile.proteinTarget)}"/></label>
        <label class="fld"><span class="lt">Sessions / week</span><input id="p-wk" inputmode="numeric" value="${esc(S.profile.weeklyTarget)}"/></label>
        <label class="fld"><span class="lt">Walk target (min)</span><input id="p-walk" inputmode="numeric" value="${esc(S.profile.walkTarget)}"/></label>
        <label class="fld"><span class="lt">Dumbbell step (lb)</span><input id="p-step" inputmode="decimal" value="${esc(S.profile.dumbbellStep)}"/></label>
      </div>
      <div class="tiny muted" style="margin-top:8px">Dumbbell step = the smallest jump your dumbbells allow. Once weights hit top of their rep range at RPE≤8, the app auto-steps the load by this much next time.</div>
      <button class="btn" id="p-save" style="margin-top:12px">Save profile</button>
    </div>
    <div class="card tight center tiny muted">
      Forge · program v${PROGRAM_VERSION} · ${S.workouts.length} workouts, ${S.checkins.length} check-ins<br/>
      <a class="lnk" id="reset">Reset all data</a>
    </div>
    <div id="exp-out"></div>`;

  document.getElementById("open-review").onclick = () => renderReview();
  document.getElementById("open-help").onclick = () => renderHelp();
  document.getElementById("bd-go").onclick = () => {
    const d = document.getElementById("bd-date").value;
    if (!d) { toast("Pick a date first"); return; }
    if (d > today()) { toast("Can't backdate to the future"); return; }
    startRun(generateSession(), d);
  };
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
    S.profile.walkTarget = Number(document.getElementById("p-walk").value) || S.profile.walkTarget;
    S.profile.dumbbellStep = Number(document.getElementById("p-step").value) || S.profile.dumbbellStep;
    S._m = Date.now();
    save(); toast("Profile saved");
  };
  document.getElementById("sync-connect").onclick = async () => {
    const k = document.getElementById("sync-key").value.trim();
    if (k.length < 8) { toast("Passphrase: 8+ characters"); return; }
    const isNewKey = k !== SY.key;
    SY.key = k; SY.url = SY.url || SYNC_ENDPOINT; saveSync();
    await syncNow();
    // The passphrase is used as a literal storage key (no fuzzy match) — a typo silently
    // creates a brand-new, empty account instead of erroring. Surface that with a persistent
    // banner (a toast alone disappears in ~2s, too fast for something this consequential).
    const empty = !S.workouts.length && !S.checkins.length && !S.measurements.length && !(S.activity || []).length;
    syncEmptyWarn = syncState === "ok" && isNewKey && empty;
    toast(syncState === "ok" ? (syncEmptyWarn ? "Connected — but no data found" : "Synced") : "Sync: " + syncMsg);
    renderMore();
  };
  const offBtn = document.getElementById("sync-off");
  if (offBtn) offBtn.onclick = () => {
    SY = { url: SY.url }; saveSync(); setSyncStatus("off"); syncEmptyWarn = false; toast("Disconnected"); renderMore();
  };
  document.querySelectorAll("#equip-flags .flagbtn").forEach((b) => b.onclick = () => {
    S.equipment[b.dataset.equip] = !S.equipment[b.dataset.equip];
    S._m = Date.now(); save(); b.classList.toggle("on", S.equipment[b.dataset.equip]);
  });
  const bw = document.getElementById("bw-mode");
  if (bw) bw.onclick = () => {
    if (isBodyweightMode()) { for (const k of Object.keys(BW_SWAPS)) delete S.swaps[k]; toast("Band program restored"); }
    else { S.swaps = Object.assign({}, S.swaps, BW_SWAPS); toast("Bodyweight mode on"); }
    S._m = Date.now(); save(); renderMore();
  };
  const rs = document.getElementById("reset-swaps");
  if (rs) rs.onclick = () => { S.swaps = {}; S._m = Date.now(); save(); toast("Swaps reset"); renderMore(); };
  document.getElementById("reset").onclick = () => {
    if (confirm("Erase ALL workouts, check-ins, and measurements? This cannot be undone.")) {
      S = structuredClone(DEFAULT_STATE); save(); toast("Reset"); setTab("today");
    }
  };
}

/* ---------- boot ---------- */
try { validateProgram(); } catch (e) {}
if (RUN) { current = "today"; renderRunner(); } else { setTab("today"); }
if (SY.key) syncNow({ rerender: true });
window.addEventListener("online", () => syncNow({ rerender: true }));
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow({ rerender: true }); });
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
