/* app.js — Forge. No build step, no deps. Data lives in localStorage. */
"use strict";

const KEY = "forge.v1";
const DEFAULT_STATE = {
  v: 1,
  profile: { heightIn: 68, startWeight: 155 },
  programIndex: 0,        // which session in SESSION_ORDER is next
  workouts: [],           // {id, date, sessionKey, entries:[{exId, variation, sets:[{reps,load,unit,rpe}]}], note}
  checkins: [],           // {date, energy(1-5), sleep(hrs), pains:[{area,sev(0-3)}], note}
  measurements: [],       // {date, weight, waist, chest, arm}
};

let S = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULT_STATE), parsed);
  } catch (e) { return structuredClone(DEFAULT_STATE); }
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }

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
      <div class="mast-meta">${readiness}</div>
      <button class="btn good" id="start-log" style="margin-top:18px">Start &amp; log session →</button>
      ${ci ? "" : `<div class="tip">Check in first to adjust today's targets.</div>`}
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
    S.programIndex = (cur + 1) % SESSION_ORDER.length; save(); renderToday();
  };
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
  let html = `<div class="card tight small muted">Reps · load · RPE (6–10). Pre-filled with last session.</div>`;
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
  S.workouts.push({ id: Date.now(), date: today(), sessionKey: key, entries, note });
  S.programIndex = (SESSION_ORDER.indexOf(key) + 1) % SESSION_ORDER.length;
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

  VIEW.innerHTML = `
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
    }</div>` : ""}`;

  document.getElementById("save-m").onclick = () => {
    const g = (id) => { const v = document.getElementById(id).value.trim(); return v === "" ? null : Number(v); };
    const rec = { date: today(), weight: g("m-weight"), waist: g("m-waist"), chest: g("m-chest"), arm: g("m-arm") };
    if (rec.weight == null && rec.waist == null && rec.chest == null && rec.arm == null) { toast("Enter at least one"); return; }
    const i = S.measurements.findIndex((x) => x.date === today());
    if (i >= 0) S.measurements[i] = Object.assign(S.measurements[i], rec); else S.measurements.push(rec);
    save(); toast("Measurements saved"); renderProgress();
  };
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
  md += `\n---\n_Paste this back to Claude for the weekly re-tune._\n`;
  return md;
}

function renderMore() {
  TITLE.textContent = "More";
  SUB.textContent = "Export · backup · settings";
  VIEW.innerHTML = `
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
    save(); toast("Profile saved");
  };
  document.getElementById("reset").onclick = () => {
    if (confirm("Erase ALL workouts, check-ins, and measurements? This cannot be undone.")) {
      S = structuredClone(DEFAULT_STATE); save(); toast("Reset"); setTab("today");
    }
  };
}

/* ---------- boot ---------- */
setTab("today");
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
