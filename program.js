/* program.js — seeded starter program & exercise library.
 * Posture/scapula-first, home equipment (pull-up bar, bands, suspension trainer,
 * mat, rower). Conservative shoulder loading; ramps as pain stays low.
 * This is data only — app.js handles logging, progression, and adaptation.
 */

const PROGRAM_VERSION = 1;

/* Exercise library.
 * load:   'reps' | 'time' | 'band' | 'weight' | 'reps+load'
 * target: {sets, lo, hi}  (reps range)  OR  {sets, sec}  (timed hold)
 * ladder: easiest -> hardest variations the app can step you through
 * side:   true if reps/time are per-side
 * q:      YouTube search query for a demo video
 */
const EXERCISES = {
  // ---- Prehab / posture (most sessions open with these) ----
  wall_slides: {
    name: "Scapular Wall Slides", cat: "prehab", load: "reps", target: { sets: 2, lo: 8, hi: 12 },
    cue: "Low back flat to wall, ribs down. Slide arms overhead keeping wrists and elbows on the wall.",
    q: "scapular wall slides exercise"
  },
  band_pull_apart: {
    name: "Band Pull-Apart", cat: "pull", load: "band", target: { sets: 3, lo: 12, hi: 20 },
    cue: "Working set for rear delts/mid-back — pick a band you feel by the last reps. Arms straight, retract the shoulder blades, no shrug.",
    q: "band pull apart exercise"
  },
  face_pull: {
    name: "Band Face Pull", cat: "pull", load: "band", target: { sets: 3, lo: 12, hi: 20 },
    cue: "Working set, not a warmup — progress the band. Pull to the face, elbows high, rotate hands back at the end.",
    q: "band face pull exercise"
  },
  scap_pushup: {
    name: "Scapular Push-Up", cat: "prehab", load: "reps", target: { sets: 2, lo: 8, hi: 12 },
    cue: "Plank position, arms locked. Move only the shoulder blades: protract and retract.",
    q: "scapular push up exercise"
  },
  prone_ytw: {
    name: "Prone Y-T-W", cat: "prehab", load: "reps", target: { sets: 2, lo: 8, hi: 10 },
    cue: "Face down. Lift arms into Y, then T, then W, thumbs up. Small range, lower traps.",
    q: "prone Y T W raises exercise"
  },
  thoracic_open: {
    name: "Open-Book Thoracic Rotation", cat: "prehab", load: "reps", target: { sets: 1, lo: 6, hi: 8 }, side: true,
    cue: "Side-lying, knees bent. Rotate the top arm to the floor behind you. Move from the mid-back.",
    q: "open book thoracic rotation exercise"
  },

  // ---- Pull ----
  pullup_prog: {
    name: "Pull-Up Progression", cat: "pull", load: "reps", target: { sets: 3, lo: 3, hi: 8 },
    ladder: ["Dead hang (time)", "Scapular pull (shrug at bottom)", "Negative (slow lower)", "Band-assisted pull-up", "Full pull-up", "Weighted pull-up"],
    cue: "Depress the shoulder blades before the arms. Control the descent. Stop 1–2 reps short of failure.",
    q: "pull up progression beginner"
  },
  trx_row: {
    name: "Suspension / Inverted Row", cat: "pull", load: "reps", target: { sets: 3, lo: 8, hi: 12 },
    cue: "Body straight. Retract shoulder blades, pull elbows back. Walk feet forward to add difficulty.",
    ladder: ["Feet back (easy)", "Feet under bar", "Feet forward", "Feet elevated"],
    q: "inverted row suspension trainer"
  },
  band_row: {
    name: "Band Seated Row", cat: "pull", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    cue: "Anchor low. Row to the hips, retract shoulder blades. Keep shoulders back at full extension.",
    q: "seated band row exercise"
  },

  // ---- Push (chest = priority weak spot; conservative on the shoulder) ----
  pushup_prog: {
    name: "Push-Up Progression", cat: "push", load: "reps", target: { sets: 3, lo: 6, hi: 12 },
    ladder: ["Hands elevated (high)", "Hands elevated (low)", "Knee push-up", "Full push-up", "Feet elevated", "Weighted / band"],
    cue: "Hands under shoulders, elbows ~45°, body straight. Lower under control. Higher hands = easier.",
    q: "push up progression beginner"
  },
  band_press: {
    name: "Band / Floor Chest Press", cat: "push", load: "band", target: { sets: 3, lo: 10, hi: 15 },
    cue: "Press forward, adduct across the chest at lockout. Control the return.",
    q: "resistance band chest press"
  },
  pike_pushup: {
    name: "Pike Push-Up", cat: "push", load: "reps", target: { sets: 2, lo: 6, hi: 10 },
    cue: "Hips high, lower the head toward the floor. Stop if the left shoulder is symptomatic.",
    q: "pike push up exercise"
  },
  band_pressdown: {
    name: "Band Triceps Pushdown", cat: "push", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    cue: "Anchor the band high. Pin the elbows to your sides, extend fully, control back up. Shoulder-friendly triceps work.",
    q: "band triceps pushdown exercise"
  },
  band_fly: {
    name: "Band Chest Fly", cat: "push", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    cue: "Anchor behind you, slight fixed elbow bend. Arc the hands together in front and squeeze the chest; control the stretch. Isolates the pecs without loading the triceps.",
    q: "resistance band chest fly"
  },
  band_curl: {
    name: "Biceps Curl (supinated)", cat: "pull", load: "band", target: { sets: 3, lo: 8, hi: 15 },
    cue: "Elbows pinned, full range, squeeze hard at the top, slow descent. 8–15 reps near failure, add load over time. Builds the peak / long head. Use dumbbells once you have them — bands run out of tension here.",
    q: "dumbbell biceps curl exercise"
  },
  hammer_curl: {
    name: "Hammer Curl (neutral grip)", cat: "pull", load: "band", target: { sets: 3, lo: 8, hi: 15 },
    cue: "Palms neutral (thumbs up), curl with control. Trains the brachialis under the biceps — adds thickness and pushes the peak up. Load it: dumbbells beat bands here.",
    q: "hammer curl exercise"
  },

  // ---- Legs ----
  goblet_squat: {
    name: "Goblet / Bodyweight Squat", cat: "legs", load: "reps", target: { sets: 3, lo: 10, hi: 15 },
    ladder: ["Box squat", "Bodyweight squat", "Tempo bodyweight", "Goblet (band/weight)"],
    cue: "Chest up, knees track over toes, hips between the heels. Drive through the full foot.",
    q: "goblet squat exercise"
  },
  split_squat: {
    name: "Split Squat", cat: "legs", load: "reps", target: { sets: 3, lo: 8, hi: 12 }, side: true,
    cue: "Long stance. Lower the back knee straight down. Weight on the front heel.",
    q: "split squat exercise form"
  },
  rdl: {
    name: "Hip Hinge / RDL", cat: "legs", load: "band", target: { sets: 3, lo: 10, hi: 15 },
    cue: "Hips back, soft knees, flat back. Load the hamstrings, stand tall via the glutes.",
    q: "romanian deadlift hip hinge form"
  },
  calf_raise: {
    name: "Calf Raise", cat: "legs", load: "reps", target: { sets: 2, lo: 12, hi: 20 },
    cue: "Full range, pause at the top, slow descent. Single-leg when easy.",
    q: "standing calf raise exercise"
  },

  // ---- Core ----
  dead_bug: {
    name: "Dead Bug", cat: "core", load: "reps", target: { sets: 3, lo: 8, hi: 10 }, side: true,
    cue: "Low back flat to the floor. Extend opposite arm and leg slowly. Exhale on extension.",
    q: "dead bug exercise"
  },
  pallof: {
    name: "Pallof Press", cat: "core", load: "band", target: { sets: 3, lo: 10, hi: 12 }, side: true,
    cue: "Band anchored to the side. Press straight out, resist rotation. Brace the trunk.",
    q: "pallof press exercise"
  },
  plank: {
    name: "Plank", cat: "core", load: "time", target: { sets: 3, sec: 30 },
    cue: "Forearms down, ribs tucked, glutes squeezed, straight line. Stop when form breaks.",
    q: "forearm plank exercise form"
  },
  hollow_hold: {
    name: "Hollow Hold", cat: "core", load: "time", target: { sets: 3, sec: 20 },
    cue: "Low back pressed down, arms and legs extended off the floor. Bend knees to regress.",
    q: "hollow hold exercise"
  },
  hanging_knee: {
    name: "Hanging Knee Raise", cat: "core", load: "reps", target: { sets: 3, lo: 8, hi: 12 },
    ladder: ["Lying leg raise", "Hanging knee tuck", "Hanging knee raise", "Hanging leg raise"],
    cue: "Hang from the bar. Raise the knees by curling the pelvis up — not just swinging the legs. Direct, loadable ab work.",
    q: "hanging knee raise exercise"
  },

  // ---- Conditioning ----
  row_steady: {
    name: "Rower — Steady", cat: "cond", load: "time", target: { sets: 1, sec: 300 },
    cue: "Easy-moderate pace. Legs, then hips, then arms; reverse the order on the return.",
    q: "rowing machine technique"
  },
  row_intervals: {
    name: "Rower — Intervals", cat: "cond", load: "time", target: { sets: 6, sec: 30 },
    cue: "30s hard / 60s easy. Strong, smooth strokes.",
    q: "rowing machine interval workout technique"
  },
};

/* Sessions — a rotating A/B/C deck. Do "the next one" whenever you train,
 * so 3 or 5 days a week both work and travel never breaks the plan.
 */
const SESSIONS = {
  A: {
    name: "A · Pull, Chest & Arms",
    focus: "Back, rear delts, chest, biceps (peak + thickness), core",
    blocks: [
      { title: "Prehab", ex: ["wall_slides", "scap_pushup", "thoracic_open"] },
      { title: "Strength", ex: ["pullup_prog", "trx_row", "face_pull", "band_press", "band_curl", "hammer_curl"] },
      { title: "Core", ex: ["dead_bug", "hanging_knee"] },
      { title: "Conditioning", ex: ["row_steady"] },
    ],
  },
  B: {
    name: "B · Push & Legs",
    focus: "Chest (priority) + triceps, legs, core",
    blocks: [
      { title: "Prehab", ex: ["wall_slides", "face_pull", "prone_ytw"] },
      { title: "Strength", ex: ["pushup_prog", "band_fly", "band_pressdown", "goblet_squat", "split_squat"] },
      { title: "Core", ex: ["plank", "pallof"] },
      { title: "Conditioning", ex: ["row_steady"] },
    ],
  },
  C: {
    name: "C · Full Body & Engine",
    focus: "Posterior chain, chest, rear delts, biceps, engine",
    blocks: [
      { title: "Prehab", ex: ["scap_pushup", "prone_ytw", "thoracic_open"] },
      { title: "Strength", ex: ["rdl", "trx_row", "face_pull", "band_press", "hammer_curl"] },
      { title: "Core", ex: ["hollow_hold", "hanging_knee"] },
      { title: "Conditioning", ex: ["row_intervals"] },
    ],
  },
};

const SESSION_ORDER = ["A", "B", "C"];

const PAIN_AREAS = ["Winged scapula / R shoulder blade", "L shoulder (old dislocation)", "Neck / upper back", "Lower back", "Other"];
