/* app.js — Forge. No build step, no deps. Data lives in localStorage. */
"use strict";

const KEY = "forge.v1";
const DEFAULT_STATE = {
  v: 1,
  // maxLoad (lb, optional): the heaviest single dumbbell/band-equivalent load you actually own.
  // Once a numeric-load exercise reaches it, "add load" stops being offered (there's nothing
  // heavier to grab) and reps become the progression axis instead — see effectiveHi().
  profile: { heightIn: 68, startWeight: 155, proteinTarget: 155, weeklyTarget: 4, restDefault: 90, walkTarget: 30, dumbbellStep: 5, maxLoad: null },
  todaySession: null,     // {date, sess} — cached generated session so it doesn't reshuffle on every re-render (see getTodaySession)
  recentTopMuscles: [],   // rolling list of muscles that got session-title billing recently — cooldown so the same 2-3 don't dominate every title (see generateSession)
  workouts: [],           // {id, date, sessionKey, entries:[{exId, variation, sets:[{reps,load,unit,rpe}]}], note} — sessionKey now holds a generated title string, not a fixed A/B/C key
  checkins: [],           // {date, energy(1-5), sleep(hrs), pains:[{area,sev(0-3)}], note}
  measurements: [],       // {date, weight, waist, chest, arm}
  nutrition: [],          // {date, protein(g), _m}
  walks: [],              // {date, min, _m}
  activity: [],           // {id, date, type:'prehab'|'mobility', title, entries:[{exId, variation, sets}], _m} — off-day rehab/mobility, logged separately from real sessions
  equipment: { dumbbells: false, suspension: false, bandsMaxed: false }, // bands + pull-up bar + rower assumed
  swaps: {},              // exId -> replacement exId (persistent)
  ladders: {},            // exId -> current rung index (which variation the app has assigned)
  repCeilings: {},        // exId -> extended rep ceiling once resistance (band tension or profile.maxLoad) is maxed out — see effectiveHi()
  deloadWeek: null,       // weekStart string when a deload week is active
  // Dedicated per-field timestamps so a sync merge can compare "when did equipment/swaps
  // actually change" instead of falling back to the whole-state-blob _m, which is bumped by ANY
  // save on either device (a measurement, a walk, anything) — see mergeStates()'s comment.
  _equipmentM: 0,
  _swapsM: 0,
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
  // Same cache-invalidation problem finishRun() already had to fix, for the sync path: the
  // cached todaySession (and its "reasons" text — "never trained", etc.) is a snapshot of
  // daysSinceMuscle() at generation time. out starts as structuredClone(a) and nothing above
  // touches todaySession, so a device could generate/cache "never trained" for a muscle, sync in
  // a real session for that exact muscle from ANOTHER device (updating out.workouts correctly),
  // and still keep showing the stale cached reasoning indefinitely — the underlying data is
  // right, the cache just never knows to invalidate. Always drop it here; it's just a same-render
  // optimization, so losing it costs one extra regenerate, not correctness.
  out.todaySession = null;
  // Ladder rungs are monotonic progress, not a setting — last-writer-wins is wrong here.
  // _m is one timestamp for the WHOLE state blob, bumped by any save on either device (a
  // measurement, a walk, anything), completely unrelated to whether ladders changed. Wholesale-
  // replacing ladders by that timestamp meant a stale device doing something unrelated could
  // silently revert a rung another device had just advanced — take the higher rung per exercise
  // instead, so a real advance can never be clobbered by an unrelated, later-timestamped save.
  const ladderIds = new Set([...Object.keys(a.ladders || {}), ...Object.keys(b.ladders || {})]);
  out.ladders = {};
  ladderIds.forEach((id) => { out.ladders[id] = Math.max((a.ladders || {})[id] || 0, (b.ladders || {})[id] || 0); });
  // Same monotonic reasoning as ladders — an extended rep ceiling is progress, not a setting;
  // last-writer-wins could silently revert it just like it could a ladder rung.
  const ceilingIds = new Set([...Object.keys(a.repCeilings || {}), ...Object.keys(b.repCeilings || {})]);
  out.repCeilings = {};
  ceilingIds.forEach((id) => { out.repCeilings[id] = Math.max((a.repCeilings || {})[id] || 0, (b.repCeilings || {})[id] || 0); });
  // equipment (the "I have dumbbells" toggle) and swaps (band→dumbbell/bodyweight substitutions)
  // used to ride the same whole-blob _m last-writer-wins as everything else below — meaning
  // turning dumbbells ON, then having ANY OTHER save happen on a device that hadn't picked that
  // up yet (a logged set, a walk, literally anything with a newer _m), would silently flip the
  // toggle back off on the next sync. Same bug class as the ladder fix above, same fix: compare
  // a timestamp that only moves when THIS field actually changes, not whenever the blob does.
  out.equipment = ((b._equipmentM || 0) > (a._equipmentM || 0)) ? b.equipment : a.equipment;
  out._equipmentM = Math.max(a._equipmentM || 0, b._equipmentM || 0);
  out.swaps = ((b._swapsM || 0) > (a._swapsM || 0)) ? b.swaps : a.swaps;
  out._swapsM = Math.max(a._swapsM || 0, b._swapsM || 0);
  if ((b._m || 0) > (a._m || 0)) { out.profile = b.profile; out.deloadWeek = b.deloadWeek; out._m = b._m; }
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
// Same rationale as ladderCue/ladderSetup/ladderEquip: some ladders share ONE {sets,lo,hi} across
// rungs that are genuinely different movements — a low-effort activation drill (a scapular pull)
// and a near-maximal one (a slow negative) don't belong to the same rep range any more than they
// share a cue. Sharing one meant a "Scapular pull" rung was artificially capped at the SAME
// ceiling (8 reps) as a full chin-up, and per-set progression naturally produces very different
// numbers position to position within that cramped range — visible as something like "8, 8, 3, 3"
// with no explanation. ladderTarget (parallel array, same order as ladder) gives the CURRENTLY
// ASSIGNED rung its own {sets, lo, hi} when present; falls back to the exercise-level target
// otherwise (every ladder that genuinely is one movement at different leverage needs nothing here).
function rungTarget(ex, exId) {
  if (ex.ladder && ex.ladderTarget) {
    const t = ex.ladderTarget[assignedRung(exId)];
    if (t) return t;
  }
  return ex.target;
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
// "pressdown" was a typo — the actual exercise is named "Pushdown" (Band Triceps Pushdown), so
// it never matched and never converted to dumbbell mode even with the toggle on and equipDumbbell
// fields defined. Kept both so a future rename either direction still matches.
// alwaysDumbbell (band_curl, hammer_curl): a curl on a band loses tension exactly where the
// exercise is hardest and gets easiest right when a real muscle would still be working — the
// band's resistance curve is backwards for this movement, not just "worse without the general
// toggle." Both exercises' own cue text already said as much ("bands run out of tension here" /
// "dumbbells beat bands here"). Gating that behind the general S.equipment.dumbbells toggle meant
// it only applied once someone remembered to flip an unrelated, exercise-agnostic switch — these
// two are always better as dumbbells, independent of whatever that toggle happens to be set to.
function dumbbellMode(ex) {
  if (ex.alwaysDumbbell) return !ex.noDumbbellMode;
  return S.equipment && S.equipment.dumbbells && ex.load === "band" && !ex.noDumbbellMode && /curl|press|fly|row|squat|rdl|pressdown|pushdown|raise/i.test(ex.name + " " + (ex.cat || ""));
}
// Numeric-load exercises are the ones the weight-progression engine can auto-step:
// dumbbell-mode band moves once dumbbells are on, anything already tracked in lb (backpack
// curl), OR a laddered bodyweight exercise that's reached its "Weighted" terminal rung
// (Weighted pull-up, Weighted chin-up, Weighted/band push-up) — at that point there's a real
// external load to progress even though ex.load stays "reps" for the rest of the ladder, and
// without this the app just kept prescribing plain rep counts forever with no way to log or
// step the added weight once someone actually reached that rung.
function isNumericLoad(ex, exId) {
  if (dumbbellMode(ex) || ex.load === "weight") return true;
  if (exId && ex.ladder && /weighted/i.test(assignedVariation(exId) || "")) return true;
  return false;
}
function loadStep(ex) { return (S.profile && +S.profile.dumbbellStep) || 5; }
// Once resistance is genuinely maxed — a band with no more tension to add, or a numeric load
// already at the equipment ceiling the user told us they own (S.profile.maxLoad) — "add load" /
// "use a firmer band" stops being an actionable instruction. Clearing the printed rep range used
// to just reset you back to the bottom of that SAME range at the SAME resistance forever, with a
// suggestion to buy equipment you may not be able to. S.repCeilings[exId] tracks an extended
// ceiling (bumped by advanceRepCeilings() in finishRun(), same pattern as ladder rungs) so reps
// become the ongoing progression axis instead — automatic, no purchase or manual tracking needed.
// Only kicks in for a load-based exercise once actually AT the stated ceiling; below that, normal
// load-stepping is still the right lever and the printed range stays as-is.
// Standalone from effectiveHi() below on purpose — comparing effectiveHi()'s return value to
// ex.target.hi to decide "is this maxed" doesn't work on the FIRST session that hits the ceiling,
// since S.repCeilings[exId] hasn't been bumped yet at that point (that happens afterward, in
// advanceRepCeilings()) — effectiveHi() would still equal the plain printed hi that session,
// making it indistinguishable from "not maxed at all". This checks the maxed CONDITION directly.
function isResistanceMaxed(ex, exId) {
  const numericLoad = isNumericLoad(ex, exId);
  const bandOnly = ex.load === "band" && !numericLoad;
  if (numericLoad && S.profile.maxLoad) {
    const last = lastEntry(exId, ex.ladder ? assignedVariation(exId) : undefined);
    const lastLoad = last ? Math.max(0, ...last.entry.sets.map((s) => (s.load != null && isFinite(+s.load)) ? +s.load : 0)) : 0;
    return lastLoad >= S.profile.maxLoad;
  }
  if (bandOnly) {
    // Unlike a numeric load, band tension isn't something the app can read a number off of —
    // it can't tell "you cleared the range, try your NEXT firmer band" (still the right move if
    // you own one) apart from "you've genuinely run out of bands." Defaulting to the ceiling-
    // extension the instant anyone clears a band exercise's range would silently stop suggesting
    // a firmer band even for someone who owns a whole set and just hasn't grabbed the next one —
    // so this only activates once the user explicitly says they're maxed (More → Equipment).
    return !!(S.equipment && S.equipment.bandsMaxed);
  }
  return false;
}
// The actual next target: the printed range's top, UNLESS resistance is maxed, in which case an
// already-extended S.repCeilings value (bumped by advanceRepCeilings() once a maxed exercise
// clears it) takes over — 0/absent the first time this fires, so it still returns the plain
// printed hi until advanceRepCeilings() has actually raised it after that session.
function effectiveHi(ex, exId) {
  const target = rungTarget(ex, exId);
  if (!target || target.hi == null) return target ? target.hi : undefined;
  if (!isResistanceMaxed(ex, exId)) return target.hi;
  return Math.max(target.hi, (S.repCeilings && S.repCeilings[exId]) || 0);
}

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
function exHistory(exId, variation, beforeDate) {
  const out = [];
  S.workouts.forEach((w) => {
    if (beforeDate && w.date >= beforeDate) return;
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
function momentum(exId, ex, beforeDate) {
  if (ex.load === "time" || ex.load === "cardio") return false;
  const h = exHistory(exId, ex.ladder ? assignedVariation(exId) : undefined, beforeDate); if (h.length < 2) return false;
  return h.slice(-2).every((s) => s.top >= effectiveHi(ex, exId) && (!s.rpe || s.rpe <= 8));
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
// door_row needs a sturdy table (or a specific latched-door setup) — not everyone has one even
// outside bodyweight mode, and towel_row (pull-up bar + a towel — equipment already assumed for
// everyone) covers the same movement pattern more reliably. Same treatment as backpack_curl:
// stays out of normal rotation while a better-fitting option exists, but is never fully removed
// — still reachable through the swap panel for anyone who does have a table and prefers it.
const EQUIP_SUBSTITUTE_ONLY = new Set(["backpack_curl", "door_row"]);
function equipFilteredPool(pool) {
  // trx_row needs owning an actual suspension trainer. Unlike bands/dumbbells (assumed present,
  // toggled OFF if missing), a suspension trainer is uncommon enough that it should be assumed
  // ABSENT until turned on — S.equipment.suspension (More → Equipment) existed already but had
  // never actually been wired to anything, so toggling it had zero effect on which exercises
  // could be selected; trx_row kept showing up as an option regardless.
  let out = (S.equipment && S.equipment.suspension) ? pool : pool.filter((id) => id !== "trx_row");
  if (isBodyweightMode()) {
    // band_pull_apart and face_pull now both fall back to the same bodyweight substitute
    // (prone_ytw — the only genuinely floor-only rear-delt option; see BW_SWAPS). Without
    // deduping by the RESOLVED id, a muscle that earns 2 priority slots could pick both raw
    // ids and end up with the identical exercise listed twice in the same session.
    const seen = new Set();
    return out.filter((id) => { const r = resolveEx(id); if (seen.has(r)) return false; seen.add(r); return true; });
  }
  const filtered = out.filter((id) => !EQUIP_SUBSTITUTE_ONLY.has(id));
  return filtered.length ? filtered : out;
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
// How many SESSIONS (not sets/reps) this muscle has ever appeared in — used to break exact ties
// in generateSession()'s due-ranking with something that actually remembers, instead of a coin
// flip. Same-tier muscles (back/chest/biceps all target 2.5d; legs/triceps/side_delts all 3.5d)
// routinely get trained in the SAME session, which resets their daysSinceMuscle to the identical
// date and ties their due score exactly — Math.random() then decides who wins the double-slot
// and title billing, repeatedly, with no memory of who won last time. A few unlucky coin flips
// early on (or a run of them) can produce a real, persistent gap that never self-corrects, since
// randomness has no way to know one muscle has been shortchanged — reported directly: chest
// landing at 5 real sessions against back/biceps' 8 each, despite an identical target cadence.
function muscleTrainCount(muscle) {
  let n = 0;
  const scan = (arr) => (arr || []).forEach((w) => { if ((w.entries || []).some((e) => { const ex = EXERCISES[e.exId]; return ex && ex.muscle === muscle; })) n++; });
  scan(S.workouts); scan(S.activity);
  return n;
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
// Synthesizes several signals that already exist separately (adherence pace, per-muscle stall/
// neglect, body-comp stall, protein adherence) into one short automatic read — the same kind of
// skim a trainer would do over your week, generated locally from your own data every time
// Progress is opened. Nothing here is new math; it's judgment applied to numbers already tracked.
function coachRead() {
  const notes = []; // { lvl: "good" | "warn" | "acc", text }
  const wt = S.profile.weeklyTarget || 4, sw = sessionsThisWeek(), streak = targetStreakWeeks();
  const dow = new Date().getDay(); // 0=Sun..6=Sat
  const daysIntoWeek = dow === 0 ? 7 : dow; // Mon=1..Sun=7
  if (sw >= wt) notes.push({ lvl: "good", text: `Week's target already hit — ${sw}/${wt}${streak > 1 ? `, ${streak}-week streak` : ""}.` });
  else if (daysIntoWeek >= 5) notes.push({ lvl: "warn", text: `Behind pace this week — ${sw}/${wt} with the week almost over.` });
  else if (streak > 1) notes.push({ lvl: "good", text: `${streak}-week on-target streak going.` });

  Object.keys(MUSCLE_TARGETS).forEach((m) => {
    if (muscleStalled(m)) { notes.push({ lvl: "warn", text: `${MUSCLE_DISPLAY[m]} hasn't grown in ~3 weeks despite real training — worth swapping the exercise or taking a deload week.` }); return; }
    const d = daysSinceMuscle(m);
    if (d < 999 && d > MUSCLE_TARGETS[m] * 2.5) notes.push({ lvl: "warn", text: `${MUSCLE_DISPLAY[m]} hasn't been trained in ${d}d — significantly overdue for its usual cadence.` });
  });

  const bcs = bodyCompStalled();
  if (bcs) notes.push({ lvl: "warn", text: bcs });

  const recentProtein = S.nutrition.filter((n) => daysAgo(n.date) <= 7 && n.protein != null);
  if (recentProtein.length >= 3 && S.profile.proteinTarget) {
    const avg = recentProtein.reduce((s, n) => s + (+n.protein || 0), 0) / recentProtein.length;
    if (avg < S.profile.proteinTarget * 0.8) notes.push({ lvl: "warn", text: `Protein averaging ${Math.round(avg)}g/day over the last week, target is ${S.profile.proteinTarget}g — a real gap, not noise.` });
  }

  const pN = prsSince(7);
  if (pN > 0) notes.push({ lvl: "good", text: `${pN} PR${pN === 1 ? "" : "s"} in the last 7 days.` });

  if (!notes.length) notes.push({ lvl: "acc", text: "Nothing flagged — steady as it goes." });
  return notes;
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
/* ---------- backfill: approximate sessions for a real gap where nothing saved ---------- */
// Same muscle-priority math as generateSession()'s ranking (due = days-since / target cadence,
// same trainCount tiebreak — see muscleTrainCount()'s comment), but computed AS OF a past date
// against a growing local list of workouts instead of real "today" and S.workouts directly, so
// walking forward through a date range produces a realistic day-by-day rotation rather than the
// same muscles every time.
function backfillDaysSince(muscle, asOfDate, workouts) {
  let best = Infinity;
  const asOf = new Date(asOfDate.replace(/-/g, "/"));
  workouts.forEach((w) => {
    if (w.date >= asOfDate) return;
    (w.entries || []).forEach((e) => {
      const ex = EXERCISES[e.exId];
      if (ex && ex.muscle === muscle) {
        const d = Math.round((asOf - new Date(w.date.replace(/-/g, "/"))) / 86400000);
        best = Math.min(best, d);
      }
    });
  });
  return best === Infinity ? 999 : best;
}
// The whole point of a backfilled entry is to restore accurate SCHEDULING (so the muscle
// rotation and "days since trained" stop being wrong), not to fabricate a new PR — so reps
// default to the last REAL number logged for that exercise before the gap started (searching
// backward through actual history), never a guess dressed up as progress. Falls back to the
// exercise's own target midpoint only when there's no real history for it at all.
function backfillReps(exId, realHistory) {
  const ex = EXERCISES[exId];
  for (let i = realHistory.length - 1; i >= 0; i--) {
    const e = (realHistory[i].entries || []).find((x) => x.exId === exId);
    if (e && e.sets && e.sets.length) {
      const top = Math.max(0, ...e.sets.map((s) => +s.reps || 0));
      if (top) return top;
    }
  }
  if (ex.load === "time") return 30;
  const t = (ex.ladder ? rungTarget(ex, exId) : ex.target) || {};
  return (t.lo != null && t.hi != null) ? Math.round((t.lo + t.hi) / 2) : 10;
}
// One approximate session for one date — same shape generateSession()/finishRun() produce, so
// it displays and counts identically everywhere. Deliberately does NOT touch S.ladders or
// S.repCeilings (see the caller) — a backfilled number should never look like a real clearance.
function generateBackfillSession(dateStr, workoutsSoFar, realHistory) {
  const candidates = Object.keys(MUSCLE_TARGETS);
  const ranked = candidates.map((m) => {
    const due = backfillDaysSince(m, dateStr, workoutsSoFar) / MUSCLE_TARGETS[m];
    const trainCount = workoutsSoFar.filter((w) => (w.entries || []).some((e) => { const ex = EXERCISES[e.exId]; return ex && ex.muscle === m; })).length;
    return { m, due, trainCount, r: Math.random() };
  }).sort((a, b) => (b.due - a.due) || (a.trainCount - b.trainCount) || (b.r - a.r));
  const chosenMuscles = [];
  let remaining = 6;
  ranked.forEach(({ m }, i) => {
    if (remaining <= 0) return;
    const n = (i === 0 && (MUSCLE_POOLS[m] || []).length >= 2 && remaining >= 2) ? 2 : 1;
    chosenMuscles.push(m);
    remaining -= n;
  });
  const entries = [];
  chosenMuscles.forEach((m, i) => {
    const n = (i === 0 && (MUSCLE_POOLS[m] || []).length >= 2) ? 2 : 1;
    equipFilteredPool(MUSCLE_POOLS[m] || []).slice(0, n).forEach((exId) => {
      const ex = EXERCISES[exId];
      const reps = ex.load === "time" ? backfillReps(exId, realHistory) : backfillReps(exId, realHistory);
      const setsCount = (ex.ladder ? rungTarget(ex, exId).sets : ex.target.sets) || 3;
      const sets = Array.from({ length: setsCount }, () => ({ reps, load: null, unit: null, rpe: null }));
      const e = { exId, sets };
      if (ex.ladder) e.variation = assignedVariation(exId); // current rung only — never advanced
      entries.push(e);
    });
  });
  const titleMuscles = chosenMuscles.slice(0, 3);
  const title = joinNice(titleMuscles.map((m) => MUSCLE_DISPLAY[m])) || "Full body";
  return {
    id: Date.now() + Math.floor(Math.random() * 1000), date: dateStr, sessionKey: title, entries,
    note: "Approximated — backfilled after a saving gap, exact sets/reps not recorded", _m: Date.now(),
  };
}
// Evenly spreads N sessions/week across [startDate, endDate], skipping any date that already has
// a real logged workout (never overwrite or double up real data).
// All dates in [startDate, endDate] that don't already have a real logged workout — the full set
// the day-picker offers, not what gets filled. Order-preserving, oldest first.
function backfillRangeDates(startDate, endDate) {
  const start = new Date(startDate.replace(/-/g, "/")), end = new Date(endDate.replace(/-/g, "/"));
  const totalDays = Math.round((end - start) / 86400000) + 1;
  if (totalDays <= 0) return [];
  const existingDates = new Set(S.workouts.map((w) => w.date));
  const dates = [];
  for (let i = 0; i < totalDays; i++) {
    const ds = toDate(start.getTime() + i * 86400000);
    if (!existingDates.has(ds)) dates.push(ds);
  }
  return dates;
}
// A starting SUGGESTION only — evenly spread perWeek sessions across the range — for pre-
// checking the day-picker so there's less tapping, not a rule the user is bound to. Every day
// stays individually toggleable; this just decides which start out checked.
function suggestBackfillDates(startDate, endDate, perWeek) {
  const all = backfillRangeDates(startDate, endDate);
  const totalDays = all.length ? (new Date(all[all.length - 1].replace(/-/g, "/")) - new Date(all[0].replace(/-/g, "/"))) / 86400000 + 1 : 0;
  if (!all.length || perWeek <= 0) return new Set();
  const totalSessions = Math.max(1, Math.min(all.length, Math.round((totalDays / 7) * perWeek)));
  const start = new Date(startDate.replace(/-/g, "/"));
  const step = totalDays / totalSessions;
  const picked = new Set();
  for (let i = 0; i < totalSessions; i++) {
    const dayOffset = Math.min(totalDays - 1, Math.round(i * step));
    const ds = toDate(start.getTime() + dayOffset * 86400000);
    if (all.includes(ds)) picked.add(ds);
  }
  return picked;
}
// dates: explicit, user-picked array of date strings (NOT a frequency guess) — the whole point
// of the day-picker is that only days the user actually confirms get filled, nothing implied.
function buildBackfillPreview(dates) {
  const sorted = dates.slice().sort();
  const realHistory = S.workouts.slice(); // fixed reference point for "last real reps" — doesn't grow with fabricated entries
  const workoutsSoFar = S.workouts.slice();
  const sessions = [];
  sorted.forEach((dateStr) => {
    const sess = generateBackfillSession(dateStr, workoutsSoFar, realHistory);
    sessions.push(sess);
    workoutsSoFar.push(sess); // so the NEXT date's rotation sees this one as already trained
  });
  return sessions;
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
      return { m, due, trainCount: muscleTrainCount(m), r: Math.random(), stalled };
    })
    // Exact due ties (routine for same-tier muscles trained in the same session — see
    // muscleTrainCount()'s comment) go to whoever's been trained FEWER times overall, not a coin
    // flip — a real, remembered fairness tiebreak instead of one with no memory of past luck.
    // Random is now only a last resort, for the rarer case trainCount also ties.
    .sort((a, b) => (b.due - a.due) || (a.trainCount - b.trainCount) || (b.r - a.r));

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
// sec/phase describe THIS set specifically (from prescribe()'s perSet[i]) rather than reading a
// single ex.target.sec, since an alternating protocol (row_intervals) has a different duration
// per set — a hard set and the easy set right after it are not interchangeable durations.
function cardioTarget(exId, ex, setIndex, setsCount, sec, phase) {
  sec = sec ?? ex.target.sec;
  // Easy sets are deliberate recovery, not a performance to chase — there's nothing to "beat"
  // and nothing to log, so saying so directly beats reusing the hard-set "beat your strokes"
  // framing on a set where that framing doesn't apply.
  if (phase === "easy") {
    const roundNum = Math.floor(setIndex / 2) + 1, totalRounds = Math.ceil(setsCount / 2);
    return `Round ${roundNum} of ${totalRounds} — easy recovery, no target. Just keep moving.`;
  }
  const lc = lastCardio(exId, setIndex);
  // Repeating the identical text on every one of N identical-looking rows reads as the app not
  // tracking anything at all — label which round it is so it's clear each row IS distinct, even
  // when (as on a first session) there's nothing yet to compare it against. For an alternating
  // protocol, "round" means a hard/easy PAIR, not the raw set index — set index 4 is round 3.
  const roundLabel = phase === "hard" ? `Round ${Math.floor(setIndex / 2) + 1} of ${Math.ceil(setsCount / 2)} — `
    : setsCount > 1 ? `Round ${setIndex + 1} of ${setsCount} — ` : "";
  if (lc) { const p = strokeRate(lc.dist, lc.time || sec); return `${roundLabel}beat ${lc.dist} strokes in ${fmtDur(sec)}${p ? " · " + p : ""}`; }
  return `${roundLabel}${fmtDur(sec)} — log your strokes`;
}

// Safety net: a rep-based prescription under ~20 total reps isn't much of a stimulus
// regardless of how many exercises make up the session. Adds sets (at the same target as the
// last) rather than inflating any single set beyond the exercise's own range — loops because a
// single extra set isn't always enough once readiness has already cut the starting count down.
// Capped so a low-rep-ceiling movement (e.g. an early pull-up rung) can't balloon into 8+ sets.
// Skipped for time/cardio work, which isn't measured in reps.
function applyVolumeFloor(setsCount, perSet, ex, exId) {
  // Excludes prehab specifically (corrective, not a muscle-building movement by design — a
  // 1-set thoracic rotation shouldn't triple into 3 sets chasing an arbitrary rep total).
  // Core stays IN scope even without a muscle tag: it's a real training priority, not
  // corrective filler, and deserves the same volume guarantee as tagged strength work.
  // ANY laddered exercise is excluded, not just a rung with its own ladderTarget override. The
  // "under 20 total reps isn't much of a stimulus" assumption this floor is built on is true for
  // an easy isolation movement (a curl, a raise) but flatly wrong for a hard bodyweight compound
  // (a pull-up, a chin-up, a push-up) — there, a low rep max (say, 8) already IS a near-maximal,
  // real stimulus per set, not evidence of "too light." Before this exclusion, someone whose real
  // chin-up max was 8 could clear 2 sets at their genuine limit and then get padded into a 3rd
  // and 4th set chasing an arbitrary total they were never capable of doing twice, let alone
  // four times — reported directly: "8 is basically my current max. There's no way I can do it
  // twice and then two more sets." A rung with its own ladderTarget was already excluded (still
  // is, redundantly) — this now covers the terminal Full/Weighted rungs too, and every OTHER
  // laddered bodyweight movement (trx_row, diamond_pushup, hanging_knee, pushup_prog,
  // goblet_squat) that had the identical exposure without anyone having reported it yet.
  if (ex.cat === "prehab" || ex.load === "time" || ex.load === "cardio" || ex.ladder || !perSet.length) return { setsCount, perSet };
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
  // See rungTarget()'s comment — some ladders give their currently-assigned rung its own
  // {sets,lo,hi} instead of sharing the exercise-level one. Every ex.target.X below this point
  // (except the cardio branch, which is never laddered) reads through `target` instead, so a
  // rung with its own numbers actually uses them rather than always falling back to the
  // exercise's default range regardless of which movement is currently assigned.
  const target = rungTarget(ex, exId);
  if (ex.load === "cardio") {
    // Alternating protocols (row_intervals) are a sequence of DIFFERENT sets — some hard, some
    // easy — each with its own duration, not N identical sets sharing one duration. phase carries
    // through to cardioTarget/the runner so a hard set asks you to beat your stroke rate and an
    // easy set asks for nothing at all (it's recovery, there's no metric to chase).
    if (ex.intervalPattern) {
      const perSet = ex.intervalPattern.map((ph) => ({ reps: ph.sec, phase: ph.phase }));
      return { setsCount: perSet.length, perSet, note: "Hard sets: beat your stroke rate. Easy sets: just recover — nothing to log." };
    }
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
    const setsCount = deloadActive() ? Math.max(1, Math.ceil(target.sets * 0.6)) : target.sets;
    const reps = Math.round((target.lo + target.hi) / 2);
    return {
      setsCount,
      perSet: Array.from({ length: setsCount }, () => ({ reps, load: null })),
      note: "Controlled reps through a full, comfortable range — quality over quantity",
    };
  }
  // Backdating (RUN.date set) reconstructs a past session — history from ON OR AFTER that date
  // hasn't "happened yet" from its perspective, so it must not leak into what counts as "last."
  const beforeDate = (typeof RUN !== "undefined" && RUN && RUN.date) || undefined;
  const last = lastEntry(exId, ex.ladder ? assignedVariation(exId) : undefined, beforeDate);
  const deload = deloadActive();
  const rd = readiness();
  const mo = momentum(exId, ex, beforeDate);
  // A ladder rung can be timed (chinup_prog/pullup_prog's "Dead hang (time)" starting rung)
  // even though the exercise's own load type is "reps" for its later rungs — ex.load alone
  // doesn't know that. Without this check, the reps-shaped machinery below ran on the raw
  // held-seconds number: the 20-rep volume floor forced extra sets chasing "20 reps" out of a
  // number that's actually seconds, and "beat last time" chased your raw hold time upward with
  // no ceiling, every set, every session. The 45s advance-off-this-rung bar already lives in
  // advanceLadders and only needs ONE clean hold to fire — this doesn't need to hunt a new max
  // every set, so it gets a flat, modest, un-inflated target instead.
  if (ex.ladder && isTimedVariation(ex.ladder[assignedRung(exId)], ex) && ex.load !== "time") {
    const setsCount = deload ? Math.max(1, Math.ceil(target.sets * 0.6)) : target.sets;
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
  let setsCount = target.sets;
  if (deload) setsCount = Math.max(1, Math.ceil(target.sets * 0.6));
  else if (rd && rd.band === "low") setsCount = Math.max(1, target.sets - 1);
  else if (rd && rd.band === "primed" && mo && ex.load !== "time") setsCount = target.sets + 1;

  if (!last) {
    // Seed at the MIDPOINT of the rep range, not the bottom — the bottom is the easiest
    // possible number in the range, not a real calibration attempt. Still self-corrects:
    // clear it clean and next time's target moves toward the top.
    const base = ex.load === "time" ? target.sec : Math.round((target.lo + target.hi) / 2);
    // A plain band (no dumbbell mode) has adjustable TENSION, not a "weight" to find — telling
    // someone to "find a clean working weight" for a resistance band doesn't match what they're
    // actually holding. isNumericLoad(ex, exId) is checked BEFORE the plain ex.load === "reps"
    // check (not after) so it also catches a laddered bodyweight exercise's Weighted terminal
    // rung on its very first session — ex.load is "reps" there too, same as every earlier rung,
    // so checking ex.load alone would always fall into "how many reps" with zero mention of
    // picking a starting weight, even though there's a real weight to hold.
    const baseNote = ex.load === "time" ? "Baseline — see how long you can hold"
      : isNumericLoad(ex, exId) ? "Baseline — find a clean working weight"
      : (ex.load === "reps" || !ex.load) ? "Baseline — see how many clean reps you can do"
      : "Baseline — find a band you feel by the last few reps";
    let baseSets = setsCount, basePerSet = Array.from({ length: setsCount }, () => ({ reps: base, last: null, load: null }));
    ({ setsCount: baseSets, perSet: basePerSet } = applyVolumeFloor(baseSets, basePerSet, ex, exId));
    return { setsCount: baseSets, perSet: basePerSet, note: baseNote };
  }
  const lastSets = last.entry.sets.filter((s) => s.reps != null || s.load != null);
  const numericLoad = isNumericLoad(ex, exId);
  const step = loadStep(ex);
  // See effectiveHi()'s/isResistanceMaxed()'s comments: once resistance is genuinely maxed (band
  // tension, or a numeric load already at S.profile.maxLoad), the printed range's top is no
  // longer the real target — an already-extended S.repCeilings value (or the plain printed hi,
  // if not maxed yet) is, and load-stepping stops (there's nothing heavier to move to).
  const ceilingMaxed = ex.load !== "time" && isResistanceMaxed(ex, exId);
  const hi = effectiveHi(ex, exId);
  const perSet = [];
  let anyAdd = false, steppedTo = null;
  for (let i = 0; i < setsCount; i++) {
    const ls = lastSets[i] || lastSets[lastSets.length - 1] || {};
    const lastReps = ls.reps != null ? +ls.reps : null;
    if (ex.load === "time") {
      const t = lastReps || target.sec;
      perSet.push({ reps: t >= target.sec ? t + 10 : target.sec, last: lastReps, load: ls.load ?? null });
    } else {
      const r = lastReps || target.lo;
      // The last set of an exercise is intentionally pushed close to failure now (see the
      // per-set target guidance in the runner) — clearing the range ON that set is a stronger
      // signal to progress, not a weaker one, so only earlier sets get the RPE<=8 gate.
      const hitTop = r >= hi && (i === setsCount - 1 || !ls.rpe || ls.rpe <= 8);
      if (hitTop) anyAdd = true;
      // Double progression: climb reps to the top of the range, then on the NEXT session
      // reset reps to the bottom and step the weight up — for numeric-load exercises this
      // is computed and pre-filled automatically; you can still type over it. Maxed-out
      // resistance skips load-stepping entirely — there's nothing heavier to move to.
      const lastLoadNum = numericLoad && ls.load != null && ls.load !== "" && isFinite(+ls.load) ? +ls.load : null;
      let nextLoad = ls.load ?? null, loadStepped = false;
      if (hitTop && numericLoad && lastLoadNum != null && !ceilingMaxed) { nextLoad = lastLoadNum + step; loadStepped = true; steppedTo = nextLoad; }
      perSet.push({ reps: hitTop ? target.lo : Math.min(hi, r + 1), last: lastReps, load: nextLoad, addLoad: hitTop, loadStepped, prevLoad: lastLoadNum });
    }
  }
  if (deload) {
    perSet.forEach((p) => { p.addLoad = false; p.loadStepped = false; if (p.last != null) p.reps = p.last; });
    return { setsCount, perSet, note: "Deload — lighter, leave 2–3 reps in reserve" };
  }
  // "Add load" only makes physical sense when a numeric load actually exists (dumbbells on,
  // or a genuine weight-tracked movement) AND there's still room to add it. For a bodyweight
  // exercise with no ladder either (prone row, bird dog, etc.) there's no mechanical way to
  // progress difficulty in-app beyond more reps/sets — and "add tempo or pause reps" was
  // fabricated advice for a feature that doesn't exist (the app tracks neither). The real lever
  // for that case is the rep-range cycle itself (reps reset to lo and climb back to hi, computed
  // above) — that already runs automatically with no user action, so there's nothing else honest
  // to suggest. Same now applies once resistance is maxed (ceilingMaxed): "add load"/"use a
  // firmer band" is replaced with the honest, still-automatic "extended rep target" framing.
  const hasNumericLoad = (ex.load === "weight" || isNumericLoad(ex, exId)) && !ceilingMaxed;
  const bandOnly = ex.load === "band" && !isNumericLoad(ex, exId) && !ceilingMaxed;
  // "Move up to a harder variation" is impossible at a ladder's LAST rung — there's nowhere
  // higher to go. At that point (Weighted pull-up/chin-up, Weighted/band push-up) the real
  // lever is adding more load, which is exactly what hasNumericLoad now correctly detects there.
  const atLastRung = ex.ladder && assignedRung(exId) >= ex.ladder.length - 1;
  const harderText = (ex.ladder && !atLastRung) ? "move up to a harder variation" : hasNumericLoad ? "add load" : bandOnly ? "use a firmer band" : "";
  let note;
  if (rd && rd.band === "low") note = "Low readiness — one fewer set, but push the ones you do";
  else if (mo) note = rd && rd.band === "primed" ? `Primed + cruising — add a set${harderText ? " and " + harderText : ""}` : (harderText ? `Cruising — ${harderText}` : "Cruising");
  else if (anyAdd) note = steppedTo != null ? `Cleared the range — stepped up to ${steppedTo}lb` : ceilingMaxed ? "Cleared the range — maxed out, rep target raised" : (harderText ? `Cleared the range — ${harderText}` : "Cleared the range");
  else note = ex.load === "time" ? "Beat last time's hold" : "Beat last time's reps";
  let finalSets = setsCount, finalPerSet = perSet;
  ({ setsCount: finalSets, perSet: finalPerSet } = applyVolumeFloor(finalSets, finalPerSet, ex, exId));
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
// beforeDate, when passed, ignores any entry on or after it — used when backdating, so
// prescribing/progressing a session for an EARLIER date doesn't leak in data from sessions that,
// from that day's perspective, haven't happened yet (e.g. "beat 15 reps" while backfilling
// Monday, sourced from a session actually logged Wednesday).
function lastEntry(exId, variation, beforeDate) {
  let best = null;
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    if (beforeDate && S.workouts[i].date >= beforeDate) continue;
    const e = S.workouts[i].entries.find((x) => x.exId === exId && (!variation || x.variation === variation));
    if (e) { best = { date: S.workouts[i].date, m: S.workouts[i]._m || 0, entry: e }; break; }
  }
  for (let i = (S.activity || []).length - 1; i >= 0; i--) {
    if (beforeDate && S.activity[i].date >= beforeDate) continue;
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
    // ceilingMaxed: resistance is genuinely maxed (band tension, or S.profile.maxLoad) — see
    // effectiveHi()'s comment. "Push load"/"use a firmer band" isn't actionable there; the rep
    // ceiling itself is already the (automatically) moving target.
    const ceilingMaxed = ex.load !== "time" && ex.load !== "cardio" && isResistanceMaxed(ex, exId);
    const hasNumericLoad = (ex.load === "weight" || isNumericLoad(ex, exId)) && !ceilingMaxed;
    const bandOnly = ex.load === "band" && !isNumericLoad(ex, exId) && !ceilingMaxed;
    // Same terminal-rung fix as prescribe() — "move up" is impossible on the last rung.
    const atLastRung = ex.ladder && assignedRung(exId) >= ex.ladder.length - 1;
    const text = (ex.ladder && !atLastRung) ? "Cruising: move up to a harder variation" : hasNumericLoad ? "Cruising: push load" : bandOnly ? "Cruising: use a firmer band" : ceilingMaxed ? "Cruising: rep target rising (maxed out)" : "Cruising";
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
  const target = rungTarget(ex, exId);
  const hi = effectiveHi(ex, exId);
  const topReps = Math.max(...sets.map((s) => +s.reps || 0));
  const allHit = sets.length >= (target.sets || 1) && sets.every((s) => (+s.reps || 0) >= hi);
  // Same last-set-is-meant-to-be-near-failure reasoning as prescribe()/advanceLadders — only
  // the earlier sets need to have stayed comfortable.
  const lowRpe = sets.slice(0, -1).every((s) => !s.rpe || s.rpe <= 8);
  if (allHit && lowRpe) {
    // A laddered bodyweight exercise never has a numeric load to add — only bands/weights do,
    // and a plain (non-dumbbell-mode) band has tension to firm up, not a numeric load.
    const ceilingMaxed = isResistanceMaxed(ex, exId);
    const hasNumericLoad = (ex.load === "weight" || isNumericLoad(ex, exId)) && !ceilingMaxed;
    const bandOnly = ex.load === "band" && !isNumericLoad(ex, exId) && !ceilingMaxed;
    const atLastRung = ex.ladder && assignedRung(exId) >= ex.ladder.length - 1;
    const text = (ex.ladder && !atLastRung) ? "Top of range: move up to a harder variation" : hasNumericLoad ? "Top of range: +load or +1 rep/set" : bandOnly ? "Top of range: firmer band or +1 rep/set" : ceilingMaxed ? "Top of range: maxed out — rep target rising" : "Top of range: +1 rep or +1 set";
    return { lvl: "good", text };
  }
  if (topReps < target.lo) return { lvl: "warn", text: `Below ${target.lo} reps: hold or regress` };
  return { lvl: "acc", text: `Add reps toward ${target.hi}` };
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
// Which date the protein widget is currently logging against — a late-night shake after
// midnight is really "yesterday's" protein, not today's, and there was previously no way to
// say that at all (addProtein/setProtein were hardcoded to today()). Resets to today on a full
// page load; persists across re-renders within a session so toggling to "Yesterday" sticks
// long enough to actually log against it.
let proteinLogDate = null;
function todaysNutrition(date) { return S.nutrition.find((n) => n.date === (date || today())) || null; }
function proteinToday(date) { const n = todaysNutrition(date); return n ? (+n.protein || 0) : 0; }
function addProtein(g, date) {
  const d = date || today();
  const i = S.nutrition.findIndex((n) => n.date === d);
  if (i >= 0) S.nutrition[i] = { ...S.nutrition[i], protein: Math.max(0, (+S.nutrition[i].protein || 0) + g), _m: Date.now() };
  else S.nutrition.push({ date: d, protein: Math.max(0, g), _m: Date.now() });
  save();
}
function setProtein(g, date) {
  const d = date || today();
  const i = S.nutrition.findIndex((n) => n.date === d);
  const rec = { date: d, protein: Math.max(0, g), _m: Date.now() };
  if (i >= 0) S.nutrition[i] = rec; else S.nutrition.push(rec);
  save();
}

/* ---------- walking (NEAT) ---------- */
// Same fix as protein — this is the treadmill-time tracker (minutes + incline), and it was just
// as hardcoded to today() with no way to log a past day's walk/treadmill session at all.
let walkLogDate = null;
function walkToday(date) { const w = S.walks.find((x) => x.date === (date || today())); return w ? (+w.min || 0) : 0; }
function inclineToday(date) { const w = S.walks.find((x) => x.date === (date || today())); return w && w.incline != null ? +w.incline : null; }
function addWalk(m, date) {
  const d = date || today();
  const i = S.walks.findIndex((x) => x.date === d);
  if (i >= 0) S.walks[i] = { ...S.walks[i], min: Math.max(0, (+S.walks[i].min || 0) + m), _m: Date.now() };
  else S.walks.push({ date: d, min: Math.max(0, m), _m: Date.now() });
  save();
}
function setWalk(m, date) {
  const d = date || today();
  const i = S.walks.findIndex((x) => x.date === d);
  if (i >= 0) S.walks[i] = { ...S.walks[i], min: Math.max(0, m), _m: Date.now() };
  else S.walks.push({ date: d, min: Math.max(0, m), _m: Date.now() });
  save();
}
function setIncline(v, date) {
  const d = date || today();
  const i = S.walks.findIndex((x) => x.date === d);
  if (i >= 0) S.walks[i] = { ...S.walks[i], incline: Math.max(0, v), _m: Date.now() };
  else S.walks.push({ date: d, min: 0, incline: Math.max(0, v), _m: Date.now() });
  save();
}

/* ---------- adherence (week math) ---------- */
function mondayOf(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0,0,0,0); x.setDate(x.getDate() - day); return x; }
function weekStartStr(d) { return toDate(mondayOf(d).getTime()); }
// sessions grouped by week-start; returns last `n` weeks oldest→newest as {week, count}
// Prehab/mobility counts toward the weekly target alongside real strength sessions — both here
// and in sessionsThisWeek() below. Explicitly discussed and decided: showing rehab work as a
// separate "+N rehab/mobility" side-pill while the actual X/Y target number stayed strength-only
// meant logging prehab never visibly moved the number the user is actually looking at — reported
// directly, twice, as "0/4 still showing up" after logging prehab. A/B/C rotation and deload/
// momentum logic still key off S.workouts alone (unaffected) — only the weekly TARGET count and
// its streak change here.
function weeklySessions(n) {
  const counts = {};
  const bump = (dateStr) => { const k = weekStartStr(new Date(dateStr.replace(/-/g, "/"))); counts[k] = (counts[k] || 0) + 1; };
  S.workouts.forEach((w) => bump(w.date));
  (S.activity || []).forEach((a) => bump(a.date));
  const out = [];
  const base = mondayOf(new Date());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setDate(d.getDate() - i * 7);
    const k = toDate(d.getTime());
    out.push({ week: k, count: counts[k] || 0 });
  }
  return out;
}
function sessionsThisWeek() {
  const k = weekStartStr(new Date());
  const w = S.workouts.filter((w) => weekStartStr(new Date(w.date.replace(/-/g, "/"))) === k).length;
  const a = (S.activity || []).filter((a) => weekStartStr(new Date(a.date.replace(/-/g, "/"))) === k).length;
  return w + a;
}
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
/* work-interval countdown for cardio sets (row_intervals: alternating 30s hard / 60s easy).
   Counts DOWN, unlike the count-up hold timer, since the duration is fixed by the protocol, not
   something to hold "as long as you can". EACH SET (from prescribe()'s perSet, which is what
   this reads — not a single ex.target.sec shared by every row) runs its own duration and its own
   label; it does NOT auto-chain into a rest afterward. That used to double up the recovery — a
   30s hard set finishing would silently also start a 60s "rest" bar, stacked on top of the 60s
   easy SET immediately following it in the list — so a round was really hard + easy + an extra
   unrelated 60s, not the intended hard + easy. The easy set right after a hard one already IS
   the rest; nothing needs to run automatically on top of it.  */
let workInt = null, workEnd = 0;
function stopWorkTimer() { if (workInt) clearInterval(workInt); workInt = null; const b = document.getElementById("work-bar"); if (b) b.remove(); }
function startInterval(exId, setIdx) {
  const ex = EXERCISES[exId];
  const pres = prescribe(exId);
  const set = pres.perSet[setIdx] || {};
  const sec = set.reps || ex.target.sec;
  const phase = set.phase; // "hard" | "easy" | undefined (a plain fixed-duration cardio piece)
  stopWorkTimer(); stopHoldTimer(); stopRest();
  workEnd = Date.now() + sec * 1000;
  const bar = document.createElement("div");
  bar.id = "work-bar"; bar.className = `rest-bar work${phase === "easy" ? " easy" : ""}`;
  bar.innerHTML = `<span class="rest-lbl">${phase ? phase.toUpperCase() : "GO"}</span><span class="rest-t" id="work-t">${fmtClock(sec)}</span><button class="rest-x" id="work-skip">SKIP</button>`;
  document.body.appendChild(bar);
  const finish = () => {
    stopWorkTimer();
    restBeep(); if (navigator.vibrate) navigator.vibrate(phase === "easy" ? 120 : [200, 100, 200]);
    RUN.data[exId] = RUN.data[exId] || [];
    RUN.data[exId][setIdx] = RUN.data[exId][setIdx] || { reps: null, load: null, dist: null, unit: null, rpe: null, done: false };
    RUN.data[exId][setIdx].reps = sec;
    RUN.data[exId][setIdx].done = true;
    saveRun();
    // Only a legacy fixed-duration cardio exercise with an explicit restSec (none currently
    // defined — row_intervals now models hard/easy as separate sets instead) auto-chains a rest.
    // An alternating set (phase is set) never does; see the comment above this function.
    if (!phase && ex.restSec) startRest(ex.restSec);
    renderRunner();
  };
  const tick = () => {
    const left = (workEnd - Date.now()) / 1000;
    const t = document.getElementById("work-t"); if (t) t.textContent = fmtClock(left);
    if (left <= 0) finish();
  };
  document.getElementById("work-skip").onclick = finish;
  workInt = setInterval(tick, 250); tick();
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
// exId is optional — when passed and the exercise has a ladderTarget for the currently assigned
// rung, the pill reflects THAT rung's own {sets,lo,hi} instead of always the exercise-level
// default. Without this the summary pill ("3×3-8") and the actual per-set rows below it
// (rung-aware since prescribe() is) would show two different, contradictory ranges.
function targetLabel(ex, exId) {
  if (ex.load === "cardio") {
    if (ex.intervalPattern) {
      const rounds = ex.intervalPattern.length / 2;
      const hard = ex.intervalPattern.find((p) => p.phase === "hard"), easy = ex.intervalPattern.find((p) => p.phase === "easy");
      return `${rounds}× ${fmtDur(hard.sec)} hard / ${fmtDur(easy.sec)} easy`;
    }
    return `${fmtDur(ex.target.sec)} · strokes`;
  }
  const target = exId ? rungTarget(ex, exId) : ex.target;
  if (ex.load === "time") return `${target.sets}×${fmtDur(target.sec)}`;
  // A ladder's timed rung (chinup_prog/pullup_prog's "Dead hang") has ex.load === "reps" at the
  // exercise level — only the CURRENTLY ASSIGNED rung is timed — so ex.load alone can't catch it
  // the way it does for a genuinely time-typed exercise (plank, dead_hang standalone). Without
  // this, the pill showed a rep range ("3×3-8") for what's actually a hold. There's also no
  // stored duration to format here — prescribe() hardcodes a flat 30s target for every ladder
  // dead-hang rung rather than reading one from data (see its comment) — so this just says
  // "hold", matching exactly what the runner's own pill already shows for the same rung.
  if (exId && ex.ladder && isTimedVariation(assignedVariation(exId), ex)) return `${target.sets}× hold`;
  return `${target.sets}×${target.lo}–${target.hi}${ex.side ? "/side" : ""}`;
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
function cueBlock(ex, exId) {
  const text = rungCue(ex, exId);
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
// exId is optional: most callers (session-gear checklist, swap-option previews) want the
// exercise's baseline gear, not gear for one specific rung. Only when a rung genuinely needs
// something the other rungs don't (a box to squat onto, a bar to hang from) does ladderEquip
// override — e.g. hanging_knee's first rung is a FLOOR exercise despite the exercise as a whole
// needing a pull-up bar.
function equipList(ex, exId) {
  const r = ex && ex.ladder && exId != null ? assignedRung(exId) : -1;
  if (ex && ex.ladderEquip && ex.ladderEquip[r] != null) return ex.ladderEquip[r].slice();
  return (ex && Array.isArray(ex.equip)) ? (dumbbellMode(ex) && ex.equipDumbbell ? ex.equipDumbbell : ex.equip).slice() : [];
}
function activeSetup(ex) { return (dumbbellMode(ex) && ex.setupDumbbell) ? ex.setupDumbbell : (ex && ex.setup); }
function activeCue(ex) { return (dumbbellMode(ex) && ex.cueDumbbell) ? ex.cueDumbbell : (ex && ex.cue); }
// Some ladders span genuinely DIFFERENT movements per rung, not one movement at increasing
// difficulty — a dead hang and a weighted pull-up don't share a cue any more than a plank and a
// bicep curl would. Using the single exercise-level cue/setup for every rung meant instructions
// like "lead the chest to the bar" were shown — and literally impossible to follow — on a rung
// that's just a static hang or a shoulder-blade shrug. ladderCue/ladderSetup (parallel arrays,
// same order as ladder) give the CURRENTLY ASSIGNED rung its own real instructions when present;
// a ladder where every rung genuinely is the same movement at a different leverage (trx_row,
// diamond_pushup, dead_hang) has no need for them and keeps using the one exercise-level cue.
function rungCue(ex, exId) {
  const r = ex && ex.ladder ? assignedRung(exId) : -1;
  if (ex && ex.ladderCue && ex.ladderCue[r] != null) return ex.ladderCue[r];
  return activeCue(ex);
}
function rungSetup(ex, exId) {
  const r = ex && ex.ladder ? assignedRung(exId) : -1;
  if (ex && ex.ladderSetup && ex.ladderSetup[r] != null) return ex.ladderSetup[r];
  return activeSetup(ex);
}
function equipLine(ex, exId) {
  const eq = equipList(ex, exId);
  if (!eq.length) return "";
  return `<div class="equipline"><span class="eqk">Equipment</span>${eq.map((e) => `<span class="eqchip">${esc(e)}</span>`).join("")}</div>`;
}
function setupLine(ex, exId) {
  const setup = rungSetup(ex, exId);
  if (!setup) return "";
  return `<div class="setupline"><span class="eqk">Setup</span><span class="eqv">${esc(setup)}</span></div>`;
}
// All equipment the (resolved, swap-aware) session needs today — deduped, order-preserved.
function sessionEquip(sess) {
  const out = [];
  for (const blk of sess.blocks)
    for (const rawId of blk.ex) {
      const exId = resolveEx(rawId);
      const ex = EXERCISES[exId];
      // Rung-aware so a "gather this before you start" list is right even for a ladder rung
      // that needs something the exercise's other rungs don't (a chair for goblet_squat's box
      // squat rung, nothing extra for hanging_knee's floor-only first rung).
      for (const e of equipList(ex, exId)) if (!out.includes(e)) out.push(e);
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

  // sessionsThisWeek() already folds prehab/mobility into this count (see its comment) — actPill
  // is now a BREAKDOWN of that same number ("of which"), not additional credit on top of it, so
  // it can never read as double-counting the same sessions.
  const sw = sessionsThisWeek(), wt = S.profile.weeklyTarget || 4;
  const weekPill = `<span class="pill ${sw >= wt ? "good" : "acc"}">Week ${sw}/${wt}</span>`;
  const actWk = activityThisWeek();
  const actPill = actWk ? `<span class="pill">incl. ${actWk} rehab/mobility</span>` : "";
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

  // protein quick-logger — proteinLogDate lets a late-night shake after midnight get logged
  // against YESTERDAY instead of today, which there was previously no way to do at all.
  const plDate = proteinLogDate || today();
  const isYesterday = plDate === yesterday();
  const pt = proteinToday(plDate), ptgt = S.profile.proteinTarget || 0;
  const ppct = ptgt ? Math.min(100, Math.round((pt / ptgt) * 100)) : 0;
  html += `
    <div class="blk-title"><span class="dot"></span>Protein ${isYesterday ? "— yesterday" : "today"}</div>
    <div class="card">
      <div class="seg" style="margin-bottom:10px">
        <button data-plday="today" class="${!isYesterday ? "on" : ""}">Today</button>
        <button data-plday="yesterday" class="${isYesterday ? "on" : ""}">Yesterday</button>
      </div>
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
        <div class="row"><div class="name tappable" data-exhist="${exId}">${esc(ex.name)} ›</div><span class="pill">${targetLabel(ex, exId)}</span></div>
        ${cueBlock(ex, exId)}
        <div class="meta">${!sg.text || sg.text === "No history yet" ? "" : `<span class="pill ${sg.lvl}">${esc(sg.text)}</span>`}${swapped}${demoLink(ex)}</div>
        ${last ? `<div class="lastnote">${esc(last)}</div>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  // walk / NEAT logger (treadmill time) — after the session, since that's usually when it happens
  const wlDate = walkLogDate || today();
  const wlIsYesterday = wlDate === yesterday();
  const wkMin = walkToday(wlDate), wkTgt = S.profile.walkTarget || 0;
  const wkPct = wkTgt ? Math.min(100, Math.round((wkMin / wkTgt) * 100)) : 0;
  const wkIncline = inclineToday(wlDate);
  html += `
    <div class="blk-title"><span class="dot"></span>Walk ${wlIsYesterday ? "— yesterday" : "today"}</div>
    <div class="card">
      <div class="seg" style="margin-bottom:10px">
        <button data-wlday="today" class="${!wlIsYesterday ? "on" : ""}">Today</button>
        <button data-wlday="yesterday" class="${wlIsYesterday ? "on" : ""}">Yesterday</button>
      </div>
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
  document.querySelectorAll("[data-plday]").forEach((b) => b.onclick = () => { proteinLogDate = b.dataset.plday === "yesterday" ? yesterday() : null; renderToday(); });
  document.querySelectorAll("[data-protein]").forEach((b) => b.onclick = () => { addProtein(+b.dataset.protein, proteinLogDate); renderToday(); });
  const pset = document.getElementById("p-set");
  if (pset) pset.onchange = (e) => { const v = e.target.value.trim(); if (v !== "") { setProtein(Number(v), proteinLogDate); renderToday(); } };
  document.querySelectorAll("[data-wlday]").forEach((b) => b.onclick = () => { walkLogDate = b.dataset.wlday === "yesterday" ? yesterday() : null; renderToday(); });
  document.querySelectorAll("[data-walk]").forEach((b) => b.onclick = () => { addWalk(+b.dataset.walk, walkLogDate); renderToday(); });
  const wset = document.getElementById("w-set");
  if (wset) wset.onchange = (e) => { const v = e.target.value.trim(); if (v !== "") { setWalk(Number(v), walkLogDate); renderToday(); } };
  const wInc = document.getElementById("w-incline");
  if (wInc) wInc.onchange = (e) => { const v = e.target.value; if (v !== "") { setIncline(Number(v), walkLogDate); renderToday(); } };
}

/* ---------- GUIDED WORKOUT RUNNER ---------- */
const RUN_KEY = "forge.run";
let RUN = (() => { try { return JSON.parse(localStorage.getItem(RUN_KEY)) || null; } catch { return null; } })();
function saveRun() { if (RUN) localStorage.setItem(RUN_KEY, JSON.stringify(RUN)); else localStorage.removeItem(RUN_KEY); }

function startRun(sess, dateStr, activityInfo) {
  const rawList = blocksFlat(sess);
  const list = rawList.map(resolveEx);
  // The first real external-load exercise of the session gets a one-line warm-up reminder
  // (see renderRunner) — not a tracked/logged set, just a nudge, so it doesn't need its own
  // data model or touch progression math. Only relevant once real weight is involved.
  const warmupFor = list.find((id) => isNumericLoad(EXERCISES[id], id)) || null;
  // activityInfo ({isPrehab, activityType}) lets a backdated prehab/mobility-only selection
  // save through the same off-day activity path a live "Daily prehab"/"Mobility & stretch"
  // session uses, instead of always landing in S.workouts as a strength session.
  RUN = { title: sess.title, rawList, list, idx: 0, startTs: Date.now(), data: {}, date: dateStr || null, warmupFor, ...(activityInfo || {}) };
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
  // Same idea as varTimed, for the OTHER direction: a laddered bodyweight exercise's final rung
  // (Weighted pull-up/chin-up, Weighted/band push-up) has a real load to add and track, even
  // though ex.load stays "reps" for every other rung. Without this, the input stayed a plain
  // "BW" placeholder forever, with nowhere to even log the weight you strapped on.
  const varWeighted = !!(ex.ladder && !varTimed && /weighted/i.test(curVar || ""));
  const effLoad = varTimed ? "time" : varWeighted ? "weight" : ex.load;
  const timed = effLoad === "time";
  const cardio = effLoad === "cardio";
  const displayName = ex.ladder ? curVar.replace(/\s*\(time\)/i, "") : ex.name;
  // RPE ("how hard did that feel") is meaningless for corrective/stretch work — a wall slide
  // or a thoracic rotation isn't rated on an effort scale the way a working set is.
  const showRpe = ex.cat !== "prehab" && ex.cat !== "mobility";
  // Persistent column headers — the inputs' placeholder text disappears the moment a value
  // is pre-filled (baseline, carried-forward, or a stepped load), which is most of the time.
  const col1Head = cardio || timed ? "sec" : "reps";
  const col2Head = cardio ? "strokes" : timed ? "" : (effLoad === "reps" || !effLoad ? "bw" : (dumbbellMode(ex) ? "lb" : effLoad === "band" ? "band" : "lb"));
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
    if (cardio) tgt = cardioTarget(exId, ex, i, pres.setsCount, p.reps, p.phase);
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
      // "+load" only makes sense when a numeric load exists to add to AND there's still room —
      // a laddered bodyweight exercise (push-ups, pull-ups, squats) clears its range into a
      // harder ladder rung. A bodyweight exercise with no ladder either (prone row, bird dog)
      // has no load or rung to step to — no fabricated "add tempo or pause reps" suffix, since
      // neither is a tracked feature; the rep-range reset-and-reclimb (computed above) is the
      // real, automatic lever. A plain band (not dumbbell mode) has tension, not a numeric load,
      // to add. Once resistance is genuinely maxed (band tension, or S.profile.maxLoad) that
      // same automatic lever takes back over — see effectiveHi()'s comment.
      const ceilingMaxed = !ex.ladder && ex.load !== "time" && ex.load !== "cardio" && ex.cat !== "prehab" && isResistanceMaxed(ex, exId);
      const hasNumericLoad = (ex.load === "weight" || isNumericLoad(ex, exId)) && !ceilingMaxed;
      const bandOnly = ex.load === "band" && !isNumericLoad(ex, exId) && !ceilingMaxed;
      // Same terminal-rung fix as prescribe()/suggest() — no "next rung" exists at the last one.
      const atLastRung = ex.ladder && rung >= ex.ladder.length - 1;
      const addLoadText = p.addLoad ? ((ex.ladder && !atLastRung) ? " · clears to next rung" : hasNumericLoad ? " +load" : bandOnly ? " · use a firmer band" : ceilingMaxed ? " · maxed out, rep target raised" : "") : "";
      tgt = `${p.reps}${p.loadStepped ? ` · stepped to ${p.load}lb (was ${p.prevLoad})` : addLoadText}`;
      // Effort guidance on real strength work — the number alone doesn't say how hard to push it,
      // and evidence points to proximity-to-failure mattering more than the exact rep count.
      if (ex.muscle) tgt += i === pres.setsCount - 1 ? " · last set: push close to failure" : " · leave ~2 in reserve";
    }
    // ex.side only ever reached the summary pill at the top of the page ("3×8-12/side") — during
    // actual set-by-set entry there was no indication a given row is per-side at all, leaving
    // real ambiguity mid-session (is this row both sides, or do I redo all 3 rows on the other
    // leg after?). Applied uniformly after tgt is finalized so it covers every branch above
    // (timed holds, prehab/mobility, and normal reps/load) without duplicating the logic three times.
    if (ex.side && !cardio) tgt += " · each side";
    // An easy set (row_intervals) is pure recovery — there's no metric to chase, so the strokes
    // input is just noise there; a hard set still gets it. Anything non-cardio is unaffected.
    const cellHtml = timed ? `<button class="qbtn holdbtn" data-hold="${i}">⏱ time it</button>`
      : (cardio && p.phase === "easy") ? `<div class="tiny muted center">recovery</div>`
      : runnerLoadCell({ ...ex, load: effLoad }, i, cellVal);
    // Any cardio exercise gets an actual countdown instead of a plain editable number — both
    // row_intervals and row_steady (one continuous 5:00 piece) should be something the app times
    // for you, not just cue text you self-time against a watch. row_intervals is a sequence of
    // separately-timed, separately-labeled hard/easy sets (see prescribe()) — each button only
    // ever runs ITS OWN set's duration; nothing auto-chains into the next set or an extra rest,
    // since the very next row (the easy set right after a hard one) already IS the recovery.
    const col1Cell = cardio
      ? `<button class="qbtn holdbtn${p.phase === "easy" ? " easybtn" : ""}" data-interval="${i}">▶ ${p.phase ? `${fmtDur(p.reps)} ${p.phase}` : `Start ${fmtDur(p.reps)}`}</button>`
      : `<input data-set="${i}" data-f="reps" inputmode="numeric" placeholder="${cardio || timed ? "sec" : "reps"}" value="${esc(repsVal)}" />`;
    rows += `<div class="setrow">
      <button class="setdone ${ev && ev.done ? "on" : ""}" data-set="${i}" title="mark done + rest">${i + 1}</button>
      ${col1Cell}
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
      <div class="row"><div class="name">${esc(ex.name)}</div><span class="pill">${timed ? `${pres.setsCount}× hold` : targetLabel(ex, exId)}</span></div>
      ${ex.ladder ? `<div class="tiny muted" style="margin:-2px 0 4px">Variation: ${esc(displayName)}${timed ? " · timed hold" : ""}</div>` : ""}
      ${ex.ladder && timed ? `<div class="cue">Hold with good form as long as you can — no reps. Tap ‘time it’ to run the clock.</div>` : cueBlock(ex, exId)}
      ${equipLine(ex, exId)}${setupLine(ex, exId)}
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
  document.querySelectorAll("[data-interval]").forEach((b) => b.onclick = () => startInterval(exId, +b.dataset.interval));
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
    // The set INDEX has to come from something present on every row regardless of exercise
    // type — .setdone always renders; [data-f="reps"] does not. An interval-cardio row
    // (row_intervals/row_steady) has no reps INPUT at all — it's replaced by the "▶ Start"
    // countdown button — so reading reps.dataset.set threw a TypeError (null has no .dataset)
    // the moment Finish & Save's captureRun() hit one, which is nearly every session since
    // Conditioning is normally the LAST block. That's a silent-looking failure: the onclick
    // handler just throws and stops, so tapping the button visibly does nothing at all.
    const doneBtn = row.querySelector(".setdone");
    const i = +doneBtn.dataset.set;
    const reps = row.querySelector('[data-f="reps"]'), load = row.querySelector('[data-f="load"]'), dist = row.querySelector('[data-f="dist"]'), rpe = row.querySelector('[data-f="rpe"]');
    const done = doneBtn?.classList.contains("on") || false;
    // Clamp to non-negative and reject garbage (NaN from e.g. a pasted non-numeric value) --
    // a negative rep count isn't just wrong, it can silently corrupt PR tracking (any nonzero
    // number, negative included, is truthy and could win an empty "best so far" comparison).
    const cleanNum = (v) => { if (v == null || v === "") return null; const n = Math.max(0, Number(v)); return isFinite(n) ? n : null; };
    // No reps input at all (interval-cardio row) — its duration was already written directly
    // into RUN.data by startInterval() when the countdown completed; preserve it instead of
    // wiping it to null just because there's nothing live in the DOM to re-read.
    const existingReps = RUN.data[exId] && RUN.data[exId][i] ? RUN.data[exId][i].reps : null;
    let repsNum = reps ? cleanNum(reps.value) : existingReps;
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
      ${equipLine(ex, exId)}${setupLine(ex, exId)}
      <div class="cue" style="margin-top:6px">${esc(rungCue(ex, exId))}</div>
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
    // "table" added — door_row's ["Sturdy table"] didn't match this regex, so a swap panel
    // triggered by "I don't have the equipment" was ranking it as if it were gear-free, same
    // tier as towel_row (which genuinely only needs the pull-up bar the app already assumes).
    const gearFree = (id) => !equipList(EXERCISES[id]).some((e) => /band|dumbbell|suspension|table/i.test(e));
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
  S.swaps[origId] = altId; S._m = Date.now(); S._swapsM = S._m; save();
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
  // For a laddered exercise whose rungs mix timed holds and rep sets (e.g. pull-up progression's
  // "Dead hang" is seconds, every other rung is reps), charting every entry together as one "top
  // reps" line means a 45-second hang and an 8-rep pull-up land on the same axis — a jump between
  // rungs then reads as a huge spike or crash that has nothing to do with actual progress. Only
  // chart/PR entries whose UNIT matches the currently assigned rung; older entries in a different
  // unit are still visible in the raw history list below, just not mixed into the same number.
  const curTimed = ex.ladder ? isTimedVariation(assignedVariation(exId), ex) : null;
  const sameUnit = (h) => curTimed === null || isTimedVariation(h.variation, ex) === curTimed;
  const pts = [];
  hist.filter(sameUnit).forEach((h) => { const top = Math.max(0, ...h.sets.map((s) => +s.reps || 0)); if (top) pts.push({ x: pts.length, y: top }); });
  let pr = null;
  hist.filter(sameUnit).forEach((h) => h.sets.forEach((s) => { const r = +s.reps || 0; if (r > 0 && (!pr || r > pr.reps)) pr = { reps: r, load: s.load }; }));
  const topLabel = curTimed ? "Top-set time" : "Top-set reps";
  const prLabel = pr ? (curTimed ? `PR ${fmtDur(pr.reps)}` : `PR ${pr.reps}${pr.load ? "@" + esc(String(pr.load)) : ""}`) : "";
  const rows = hist.slice().reverse().map((h) => {
    const timed = isTimedVariation(h.variation, ex);
    const sets = h.sets.map((s) => `${s.reps == null ? "?" : timed ? fmtDur(s.reps) : s.reps}${s.load ? "@" + s.load : ""}${s.rpe ? " (RPE" + s.rpe + ")" : ""}`).join(", ");
    return `<div class="row small" style="padding:8px 0;border-top:1px solid var(--line)"><span class="muted">${prettyDate(h.date)}${h.variation ? " · " + esc(h.variation) : ""}${h.tag ? ` · ${esc(h.tag)}` : ""}</span><span>${esc(sets)}</span></div>`;
  }).join("");
  VIEW.innerHTML = `
    <button class="btn ghost sm" id="ex-back" style="margin:8px 0 6px">← Back</button>
    <div class="card">
      <div class="row"><div class="name">${esc(ex.name)}</div><span class="pill">${targetLabel(ex, exId)}</span></div>
      <div class="cue">${esc(rungCue(ex, exId))}</div>
      <div class="meta">${demoLink(ex)}</div>
    </div>
    <div class="card">
      <div class="row"><div class="name">${topLabel}</div>${prLabel ? `<span class="pill good">${esc(prLabel)}</span>` : ""}</div>
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
    // Advance threshold matches whatever was actually PRESCRIBED for this rung — a rung with its
    // own ladderTarget (e.g. scapular pull's 2×10-15) should need to clear ITS ceiling to level
    // up, not the exercise's unrelated default range.
    const advance = isTimedVariation(ex.ladder[r], ex) ? top >= 45 : (top >= rungTarget(ex, e.exId).hi && clearedRpe);
    if (advance) { S.ladders[e.exId] = r + 1; leveled.push(ex.ladder[r + 1].replace(/\s*\(time\)/i, "")); }
  });
  return leveled;
}
// Reps-based equivalent of advanceLadders() for exercises that have run out of RESISTANCE to
// add — a band with no more tension, or a numeric load already at the equipment ceiling the
// user told us they own (S.profile.maxLoad). Without this, clearing the printed rep range on a
// maxed-out exercise just reset reps to the bottom of that SAME range at the SAME resistance,
// forever — "use a firmer band"/"add load" isn't actionable once there's genuinely nothing
// heavier to grab. Extends S.repCeilings[exId] instead, so the rep target itself keeps climbing —
// automatic, no purchase or manual tracking required (matches the standing rule against
// suggesting untracked modalities like tempo/pauses).
function advanceRepCeilings(entries) {
  const raised = [];
  entries.forEach((e) => {
    const ex = EXERCISES[e.exId];
    if (!ex || ex.ladder || ex.load === "time" || ex.load === "cardio" || !ex.target || ex.target.hi == null) return;
    if (!isResistanceMaxed(ex, e.exId)) return; // not maxed — normal load-stepping (or plain reps) still applies
    const hi = effectiveHi(ex, e.exId);
    const top = Math.max(0, ...e.sets.map((s) => +s.reps || 0));
    const clearedRpe = e.sets.slice(0, -1).every((s) => !s.rpe || s.rpe <= 8);
    if (top >= hi && clearedRpe) {
      S.repCeilings = S.repCeilings || {};
      S.repCeilings[e.exId] = hi + 3;
      raised.push(ex.name);
    }
  });
  return raised;
}
function finishRun() {
  const entries = collectRunEntries();
  if (!entries.length) { toast("Mark a set done (tap its number) so it saves"); return; }
  const leveled = advanceLadders(entries);
  const raisedCeilings = advanceRepCeilings(entries);
  const date = RUN.date || today();
  // Today's session (and its "reasons" text — "never trained, prioritized" etc.) is generated
  // once and cached so it doesn't reshuffle on every re-render. But that cache is a snapshot of
  // daysSinceMuscle() at generation time — logging ANY session (especially a backdated one,
  // whose entire point is correcting the record) changes what that reasoning should say, and
  // without invalidating the cache here, the stale "never trained" text would keep showing
  // until the calendar rolled over or someone manually hit Regenerate.
  S.todaySession = null;
  if (RUN.isPrehab) {
    const type = RUN.activityType;
    const title = RUN.title;
    insertActivitySorted({ id: Date.now(), date, type, title, entries, _m: Date.now() });
    S._m = Date.now();
    save();
    stopRest();
    RUN = null;
    saveRun();
    toast(leveled.length ? `Leveled up → ${leveled[0]}` : raisedCeilings.length ? `Maxed out — new rep target for ${raisedCeilings[0]}` : `${title} logged`);
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
  toast(leveled.length ? `Leveled up → ${leveled[0]}` : raisedCeilings.length ? `Maxed out — new rep target for ${raisedCeilings[0]}` : "Workout saved");
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
  const coach = coachRead();

  VIEW.innerHTML = `
    <div class="blk-title"><span class="dot"></span>Coach's read</div>
    <div class="card">${coach.map((n) => `<div class="row small" style="padding:6px 0;border-top:1px solid var(--line)"><span class="pill ${n.lvl}" style="flex-shrink:0;margin-right:8px">${n.lvl === "good" ? "✓" : n.lvl === "warn" ? "!" : "•"}</span><span>${esc(n.text)}</span></div>`).join("")}</div>
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

// Removing a logged workout entirely — needed once backfill (or anything else) can add a session
// that turns out to be wrong (e.g. a day that was actually a real rest day). Undoes exactly what
// insertWorkoutSorted() did; also invalidates the cached today-session the same way finishRun()
// does, since removing a workout changes what "days since trained" should say.
function deleteWorkout(id) {
  S.workouts = S.workouts.filter((w) => w.id !== id);
  S.todaySession = null;
  S._m = Date.now();
  save();
}
// Transient day-picker state for the bulk-backfill tool — not part of S. BF_RANGE holds the
// {start,end} the picker is currently showing every day of; BF_SELECTED is which of those days
// are checked — starts pre-checked with an even-spread suggestion (see suggestBackfillDates()),
// but every day is individually toggleable, and nothing is generated/saved until confirmed.
let BF_RANGE = null;
let BF_SELECTED = null;
let BF_PREVIEW = null;
function BF_START_DEFAULT() {
  const last = S.workouts.length ? S.workouts[S.workouts.length - 1].date : null;
  if (!last) return toDate(Date.now() - 8 * 86400000);
  return toDate(new Date(last.replace(/-/g, "/")).getTime() + 86400000);
}
function commitBackfill(sessions) {
  sessions.forEach((s) => insertWorkoutSorted(s));
  S.todaySession = null;
  S._m = Date.now();
  save();
}
// Transient selection state for the backdate exercise picker — not part of S, reset each visit.
let BD_PICK = new Set();
function renderBackdatePicker(date) {
  BD_PICK = new Set();
  TITLE.textContent = "Log a past session";
  SUB.textContent = prettyDate(date);
  const groups = [];
  for (const [m, label] of Object.entries(MUSCLE_DISPLAY)) {
    const ids = Object.keys(EXERCISES).filter((id) => EXERCISES[id].muscle === m);
    if (ids.length) groups.push({ label, ids });
  }
  const coreIds = Object.keys(EXERCISES).filter((id) => EXERCISES[id].cat === "core");
  if (coreIds.length) groups.push({ label: "Core", ids: coreIds });
  const condIds = Object.keys(EXERCISES).filter((id) => EXERCISES[id].cat === "cond");
  if (condIds.length) groups.push({ label: "Conditioning", ids: condIds });
  // Off-day work (prehab drills, mobility/stretching) was previously impossible to backdate at
  // all — the picker only covered strength-shaped exercises, so a real day of prehab or
  // mobility work had nowhere to go and just vanished from history entirely.
  const prehabIds = Object.keys(EXERCISES).filter((id) => EXERCISES[id].cat === "prehab");
  if (prehabIds.length) groups.push({ label: "Prehab", ids: prehabIds });
  const mobilityIds = Object.keys(EXERCISES).filter((id) => EXERCISES[id].cat === "mobility");
  if (mobilityIds.length) groups.push({ label: "Mobility / stretch", ids: mobilityIds });

  VIEW.innerHTML = `
    <button class="btn ghost sm" id="bd-back" style="margin:8px 0 6px">← Back</button>
    <div class="small muted" style="margin-bottom:8px">Tap everything you actually did on ${esc(prettyDate(date))} — this records reality, not a fresh guess. Sets/reps get entered the normal way, right after.</div>
    ${groups.map((g) => `
      <div class="blk-title"><span class="dot"></span>${esc(g.label)}</div>
      <div class="card">
        <div class="seg" style="flex-wrap:wrap">
          ${g.ids.map((id) => `<button class="flagbtn" data-bdex="${id}">${esc(EXERCISES[id].name)}</button>`).join("")}
        </div>
      </div>`).join("")}
    <button class="btn good" id="bd-log" style="margin:14px 0 24px;width:100%">Log 0 exercises for ${esc(prettyDate(date))}</button>
  `;
  document.getElementById("bd-back").onclick = () => renderMore();
  const logBtn = document.getElementById("bd-log");
  document.querySelectorAll("[data-bdex]").forEach((b) => b.onclick = () => {
    const id = b.dataset.bdex;
    if (BD_PICK.has(id)) BD_PICK.delete(id); else BD_PICK.add(id);
    b.classList.toggle("on", BD_PICK.has(id));
    logBtn.textContent = `Log ${BD_PICK.size} exercise${BD_PICK.size === 1 ? "" : "s"} for ${prettyDate(date)}`;
  });
  logBtn.onclick = () => {
    if (!BD_PICK.size) { toast("Pick at least one exercise"); return; }
    const picked = Array.from(BD_PICK);
    const cats = new Set(picked.map((id) => EXERCISES[id].cat));
    // A selection made ENTIRELY of prehab (or entirely mobility) exercises logs as off-day
    // activity, the same shape a live "Daily prehab"/"Mobility & stretch" session produces —
    // anything else (strength, core, conditioning, or a mix of those with off-day work) logs
    // as a normal workout, same as before.
    let activityInfo = null;
    if (cats.size === 1 && cats.has("prehab")) activityInfo = { isPrehab: true, activityType: "prehab" };
    else if (cats.size === 1 && cats.has("mobility")) activityInfo = { isPrehab: true, activityType: "mobility" };
    const title = activityInfo ? `${activityInfo.activityType === "prehab" ? "Prehab" : "Mobility"} (backdated)` : "Backdated session";
    const sess = { title, blocks: [{ title: "Exercises", ex: picked }] };
    startRun(sess, date, activityInfo);
  };
}
// Diagnostic view of daysSinceMuscle()'s actual reasoning — a "never trained" claim contradicting
// real logged history is a data-visibility problem (wrong device, entries referencing a removed/
// renamed exId, a sync gap), not something guessable from outside the account. This surfaces
// exactly what the app currently sees so it can be screenshotted back instead of guessed at again.
function muscleFreshnessDebugHTML() {
  const rows = Object.keys(MUSCLE_TARGETS).map((m) => {
    let best = null;
    const scan = (arr) => (arr || []).forEach((w) => (w.entries || []).forEach((e) => {
      const ex = EXERCISES[e.exId];
      if (ex && ex.muscle === m) {
        const d = daysAgo(w.date);
        if (!best || d < best.days) best = { days: d, date: w.date, exId: e.exId, name: ex.name };
      }
    }));
    scan(S.workouts); scan(S.activity);
    return { m, label: MUSCLE_DISPLAY[m], best };
  });
  const recentWorkouts = S.workouts.slice(-8).reverse()
    .map((w) => `${w.date} — ${w.sessionKey || "?"} (${(w.entries || []).map((e) => e.exId).join(", ")})`);
  return `
    ${rows.map((r) => `<div class="row small" style="padding:4px 0"><span>${esc(r.label)}</span><span class="muted">${r.best ? `${r.best.days}d — ${esc(r.best.name)} (${esc(r.best.date)})` : "no matching entry found"}</span></div>`).join("")}
    <div class="tiny muted" style="margin-top:10px">Total workouts logged: ${S.workouts.length} · activity entries: ${(S.activity || []).length}</div>
    <div class="tiny muted" style="margin-top:6px">Last 8 workouts (newest first):</div>
    ${recentWorkouts.length ? recentWorkouts.map((w) => `<div class="tiny muted">${esc(w)}</div>`).join("") : `<div class="tiny muted">none</div>`}
  `;
}
// Same idea as muscleFreshnessDebugHTML but for ladder state specifically — shows the CURRENT
// assigned rung/variation next to the variation tag actually stored on the last few logged
// entries, so a "beat my hang time as reps" report can be checked directly instead of guessed
// at from a synthetic reproduction that might not match what really happened on the account.
function ladderDebugHTML() {
  const laddered = Object.entries(EXERCISES).filter(([, ex]) => ex.ladder);
  const rows = laddered.map(([id, ex]) => {
    const rung = assignedRung(id);
    const curVar = ex.ladder[rung];
    const recent = [];
    S.workouts.forEach((w) => { const e = w.entries.find((x) => x.exId === id); if (e) recent.push({ date: w.date, variation: e.variation || "(untagged)", reps: e.sets.map((s) => s.reps).join(",") }); });
    (S.activity || []).forEach((a) => { const e = a.entries.find((x) => x.exId === id); if (e) recent.push({ date: a.date, variation: e.variation || "(untagged)", reps: e.sets.map((s) => s.reps).join(",") }); });
    recent.sort((a, b) => (a.date < b.date ? 1 : -1));
    return { id, name: ex.name, rung, curVar, recent: recent.slice(0, 3) };
  });
  return rows.map((r) => `
    <div style="margin-bottom:10px">
      <div class="small" style="font-weight:600">${esc(r.name)} — assigned: rung ${r.rung + 1} "${esc(r.curVar)}"</div>
      ${r.recent.length ? r.recent.map((e) => `<div class="tiny muted">${esc(e.date)} · tagged "${esc(e.variation)}" · logged [${esc(e.reps)}]</div>`).join("") : `<div class="tiny muted">no history logged</div>`}
    </div>`).join("");
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
        <input id="sync-key" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="8+ characters" value="${esc(SY.key || "")}"/></label>
      <div class="tiny muted" style="margin-top:4px">Shown in plain text on purpose — masking it made it impossible to tell if what you typed actually matched, and a single mismatched character here silently creates a whole new empty account with no error. This is a shared lookup key for your own data, not a login password.</div>
      <button class="btn" id="sync-connect" style="margin-top:12px">${SY.key ? "Sync now" : "Connect & sync"}</button>
      ${SY.key ? `<button class="btn ghost" id="sync-off" style="margin-top:8px">Disconnect this device</button>` : ""}
      <div class="tiny muted" style="margin-top:10px">Use the same passphrase on each device to share data. Anyone with it can read your log, so make it long. Data syncs on open, on change, and when you return to the app.</div>
    </div>
    <div class="blk-title"><span class="dot"></span>Debug: muscle freshness</div>
    <div class="card">
      <div class="tiny muted" style="margin-bottom:8px">What the app currently sees for each muscle — the most recent matching logged exercise, and how many days ago. If a muscle looks wrong here (e.g. says "no matching entry found" despite real history), screenshot this section.</div>
      ${muscleFreshnessDebugHTML()}
    </div>
    <div class="blk-title"><span class="dot"></span>Debug: ladder state</div>
    <div class="card">
      <div class="tiny muted" style="margin-bottom:8px">For every progression ladder (pull-ups, chin-ups, push-ups, etc.) — the rung it's currently assigned, and what variation tag + raw values are actually stored on the last 3 logged sessions. If a target looks wrong (e.g. mixing hold-seconds into a rep count), screenshot this section.</div>
      ${ladderDebugHTML()}
    </div>
    <div class="blk-title"><span class="dot"></span>Log a past session</div>
    <div class="card">
      <div class="small muted">Trained but it never saved, or forgot to log same-day? Pick the date, then pick exactly which exercises you did — this records what actually happened, not a fresh algorithmic guess.</div>
      <label class="fld" style="margin-top:12px"><span class="lt">Date</span>
        <input id="bd-date" type="date" max="${esc(today())}" value="${esc(yesterday())}"/></label>
      <button class="btn ghost" id="bd-go" style="margin-top:10px">Pick exercises →</button>
    </div>
    <div class="blk-title"><span class="dot"></span>Backfill a gap of missing days</div>
    <div class="card">
      <div class="small muted">For a stretch where sessions genuinely happened but never saved (a bug, a device issue). Pick exactly which days you actually trained — nothing is guessed or auto-spread; days you leave unchecked stay empty. Reps default to your last known real numbers, not new PRs, and it never touches ladder rungs or a date that already has a real logged workout.</div>
      ${BF_PREVIEW ? `
        <div class="tiny muted" style="margin-top:12px">Preview — ${BF_PREVIEW.length} session${BF_PREVIEW.length === 1 ? "" : "s"}. Nothing is saved yet.</div>
        <div class="card tight" style="margin-top:8px">${BF_PREVIEW.map((s) => `<div class="row small" style="padding:6px 0;border-top:1px solid var(--line)"><span class="muted">${prettyDate(s.date)}</span><span>${esc(s.sessionKey)} · ${s.entries.length} ex</span></div>`).join("")}</div>
        <button class="btn good" id="bf-confirm" style="margin-top:12px">Add these ${BF_PREVIEW.length} sessions</button>
        <button class="btn ghost" id="bf-cancel" style="margin-top:8px">Discard preview</button>
      ` : BF_RANGE ? `
        <div class="tiny muted" style="margin-top:12px">Tap to toggle each day — pre-checked using your ${esc(S.profile.weeklyTarget || 4)}/week default, but nothing is filled unless it's checked here. ${BF_SELECTED.size} of ${backfillRangeDates(BF_RANGE.start, BF_RANGE.end).length} day(s) selected.</div>
        <div class="flags" style="margin-top:10px">
          ${backfillRangeDates(BF_RANGE.start, BF_RANGE.end).map((d) => `<button class="flagbtn bf-day ${BF_SELECTED.has(d) ? "on" : ""}" data-day="${esc(d)}">${esc(prettyDate(d))}</button>`).join("")}
        </div>
        <button class="btn good" id="bf-genpreview" style="margin-top:12px">Preview ${BF_SELECTED.size} session${BF_SELECTED.size === 1 ? "" : "s"} →</button>
        <button class="btn ghost" id="bf-back" style="margin-top:8px">← Change date range</button>
      ` : `
        <div class="grid2" style="margin-top:12px">
          <label class="fld"><span class="lt">From</span><input id="bf-start" type="date" max="${esc(today())}" value="${esc(BF_START_DEFAULT())}"/></label>
          <label class="fld"><span class="lt">To</span><input id="bf-end" type="date" max="${esc(today())}" value="${esc(yesterday())}"/></label>
        </div>
        <label class="fld" style="margin-top:10px"><span class="lt">Sessions per week (just for the starting suggestion)</span>
          <input id="bf-perweek" inputmode="numeric" value="${esc(S.profile.weeklyTarget || 4)}"/></label>
        <button class="btn ghost" id="bf-showdays" style="margin-top:12px">Show days →</button>
      `}
    </div>
    ${(() => {
      const approx = S.workouts.filter((w) => w.note && /approximated/i.test(w.note));
      if (!approx.length) return "";
      return `<div class="blk-title"><span class="dot"></span>Backfilled sessions</div>
      <div class="card">
        <div class="small muted">Approximated entries currently in your history. Remove any that shouldn't be there — a day you actually rested, or one that landed on the wrong date.</div>
        <div class="card tight" style="margin-top:10px">${approx.map((w) => `<div class="row small" style="padding:6px 0;border-top:1px solid var(--line)"><span class="muted">${prettyDate(w.date)} — ${esc(w.sessionKey)}</span><button class="linkbtn bf-remove" data-id="${w.id}">Remove</button></div>`).join("")}</div>
      </div>`;
    })()}
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
        ${[["dumbbells", "Dumbbells"], ["suspension", "Suspension trainer"], ["bandsMaxed", "Bands maxed out"]].map(([k, l]) => `<button data-equip="${k}" class="flagbtn ${S.equipment[k] ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div class="tiny muted" style="margin-top:8px">"Bands maxed out" = you've genuinely run out of firmer bands to grab. Turns off "use a firmer band" suggestions on band-only exercises and raises the rep target instead, automatically.</div>
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
        <label class="fld"><span class="lt">Max load owned (lb)</span><input id="p-maxload" inputmode="decimal" placeholder="e.g. 50" value="${esc(S.profile.maxLoad ?? "")}"/></label>
      </div>
      <div class="tiny muted" style="margin-top:8px">Dumbbell step = the smallest jump your dumbbells allow. Once weights hit top of their rep range at RPE≤8, the app auto-steps the load by this much next time.</div>
      <div class="tiny muted" style="margin-top:4px">Max load = your heaviest dumbbell (or a band's rated-equivalent max). Once a numeric-load exercise reaches it, the app stops suggesting "add load" — there's nothing heavier to grab — and raises the rep target instead. Leave blank if you're not sure yet.</div>
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
    renderBackdatePicker(d);
  };
  const bfShowDaysBtn = document.getElementById("bf-showdays");
  if (bfShowDaysBtn) bfShowDaysBtn.onclick = () => {
    const start = document.getElementById("bf-start").value;
    const end = document.getElementById("bf-end").value;
    const perWeek = Number(document.getElementById("bf-perweek").value) || S.profile.weeklyTarget || 4;
    if (!start || !end) { toast("Pick both dates"); return; }
    if (start > end) { toast("Start date is after end date"); return; }
    if (end >= today()) { toast("End date must be before today"); return; }
    const days = backfillRangeDates(start, end);
    if (!days.length) { toast("No days available — every date in range already has a real session"); return; }
    BF_RANGE = { start, end };
    BF_SELECTED = suggestBackfillDates(start, end, perWeek);
    renderMore();
  };
  document.querySelectorAll(".bf-day").forEach((b) => b.onclick = () => {
    const d = b.dataset.day;
    if (BF_SELECTED.has(d)) BF_SELECTED.delete(d); else BF_SELECTED.add(d);
    renderMore();
  });
  const bfBackBtn = document.getElementById("bf-back");
  if (bfBackBtn) bfBackBtn.onclick = () => { BF_RANGE = null; BF_SELECTED = null; renderMore(); };
  const bfGenPreviewBtn = document.getElementById("bf-genpreview");
  if (bfGenPreviewBtn) bfGenPreviewBtn.onclick = () => {
    if (!BF_SELECTED.size) { toast("Check at least one day first"); return; }
    BF_PREVIEW = buildBackfillPreview(Array.from(BF_SELECTED));
    BF_RANGE = null; BF_SELECTED = null;
    renderMore();
  };
  const bfConfirmBtn = document.getElementById("bf-confirm");
  if (bfConfirmBtn) bfConfirmBtn.onclick = () => {
    const n = BF_PREVIEW.length;
    commitBackfill(BF_PREVIEW);
    BF_PREVIEW = null;
    toast(`Added ${n} approximated session${n === 1 ? "" : "s"}`);
    renderMore();
  };
  const bfCancelBtn = document.getElementById("bf-cancel");
  if (bfCancelBtn) bfCancelBtn.onclick = () => { BF_PREVIEW = null; renderMore(); };
  document.querySelectorAll(".bf-remove").forEach((b) => b.onclick = () => {
    deleteWorkout(+b.dataset.id);
    toast("Removed");
    renderMore();
  });
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
    const maxLoadVal = document.getElementById("p-maxload").value.trim();
    S.profile.maxLoad = maxLoadVal === "" ? null : (Number(maxLoadVal) || S.profile.maxLoad);
    S._m = Date.now();
    save(); toast("Profile saved");
  };
  document.getElementById("sync-connect").onclick = async () => {
    const k = document.getElementById("sync-key").value.trim();
    if (k.length < 8) { toast("Passphrase: 8+ characters"); return; }
    SY.key = k; SY.url = SY.url || SYNC_ENDPOINT; saveSync();
    await syncNow();
    // The passphrase is used as a literal storage key (no fuzzy match) — a typo silently
    // creates a brand-new, empty account instead of erroring. Surface that with a persistent
    // banner (a toast alone disappears in ~2s, too fast for something this consequential).
    // Previously only shown when the KEY itself was new (isNewKey) — but that meant a REPEAT
    // sync on an already-saved key that comes back empty (the remote copy genuinely has nothing,
    // whatever the reason) reported a plain "Synced" with no indication anything was wrong,
    // reported directly: "I typed in my passphrase several times, hit sync now. Nothing." — the
    // sync itself was "succeeding" (no error), it just had nothing to actually restore, and the
    // UI never said so. This now fires every time, new key or not — an empty result is always
    // worth surfacing, not just the first time a key is entered.
    const empty = !S.workouts.length && !S.checkins.length && !S.measurements.length && !(S.activity || []).length;
    syncEmptyWarn = syncState === "ok" && empty;
    toast(syncState === "ok" ? (syncEmptyWarn ? "Connected — but no data found" : "Synced") : "Sync: " + syncMsg);
    renderMore();
  };
  const offBtn = document.getElementById("sync-off");
  if (offBtn) offBtn.onclick = () => {
    SY = { url: SY.url }; saveSync(); setSyncStatus("off"); syncEmptyWarn = false; toast("Disconnected"); renderMore();
  };
  document.querySelectorAll("#equip-flags .flagbtn").forEach((b) => b.onclick = () => {
    S.equipment[b.dataset.equip] = !S.equipment[b.dataset.equip];
    S._m = Date.now(); S._equipmentM = S._m; save(); b.classList.toggle("on", S.equipment[b.dataset.equip]);
  });
  const bw = document.getElementById("bw-mode");
  if (bw) bw.onclick = () => {
    if (isBodyweightMode()) { for (const k of Object.keys(BW_SWAPS)) delete S.swaps[k]; toast("Band program restored"); }
    else { S.swaps = Object.assign({}, S.swaps, BW_SWAPS); toast("Bodyweight mode on"); }
    S._m = Date.now(); S._swapsM = S._m; save(); renderMore();
  };
  const rs = document.getElementById("reset-swaps");
  if (rs) rs.onclick = () => { S.swaps = {}; S._m = Date.now(); S._swapsM = S._m; save(); toast("Swaps reset"); renderMore(); };
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
  // Registering alone leans on the browser's own background check for a new sw.js, which isn't
  // guaranteed to happen the moment a new version ships. An explicit update() on load and on
  // returning to the tab forces an immediate check instead of waiting on that timing — paired
  // with install now doing real (non-cached) fetches, a genuinely new version should reliably
  // reach an open tab without needing a manual reinstall.
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {}));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()).catch(() => {});
  });
  // The missing half of the update story: reg.update() finding a new sw.js, and that sw.js's own
  // install handler calling skipWaiting(), together get a new service worker ACTIVATED — but
  // activating doesn't change what code is actually RUNNING in an already-open tab. A page keeps
  // executing the app.js it originally loaded until it does a real reload. For a PWA opened from
  // a home-screen icon — routinely backgrounded and foregrounded, rarely fully force-quit and
  // relaunched — that reload might never happen on its own, so a real, already-shipped fix could
  // sit "installed" but never actually take effect for weeks. This is exactly how "Finish & Save"
  // silently failing kept happening on a real device long after the underlying bug was fixed and
  // deployed. `controllerchange` fires the moment a new SW actually takes control — force a
  // reload right then so the newly-active code is what's actually running, unprompted. Safe to do
  // unconditionally: RUN (an in-progress session) is persisted continuously via saveRun() and
  // restored on boot, so this can cost at most whatever's mid-keystroke in an unmarked field, not
  // the session itself.
  let swRefreshed = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swRefreshed) return;
    swRefreshed = true;
    window.location.reload();
  });
}
