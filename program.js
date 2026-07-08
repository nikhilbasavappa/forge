/* program.js — seeded starter program & exercise library.
 * Posture/scapula-first, home equipment (pull-up bar, bands, suspension trainer,
 * mat, rower). Conservative shoulder loading; ramps as pain stays low.
 * This is data only — app.js handles logging, progression, and adaptation.
 */

const PROGRAM_VERSION = 2;

/* Exercise library.
 * load:   'reps' | 'time' | 'band' | 'weight' | 'reps+load'
 * target: {sets, lo, hi}  (reps range)  OR  {sets, sec}  (timed hold)
 * ladder: easiest -> hardest variations the app can step you through
 * side:   true if reps/time are per-side
 * equip:  array of equipment you must physically have to do this exact variant
 * setup:  one line on how to set the equipment/body up before the first rep
 * q:      YouTube search query for a demo video (must match the exact variant)
 */
const EXERCISES = {
  // ---- Prehab / posture (most sessions open with these) ----
  wall_slides: {
    name: "Scapular Wall Slides", cat: "prehab", load: "reps", target: { sets: 2, lo: 8, hi: 12 },
    equip: ["Wall", "Floor"],
    setup: "Stand with your back and low back flat against a wall, arms up in a goalpost, backs of the hands on the wall.",
    cue: "Low back flat to wall, ribs down. Slide arms overhead keeping wrists and elbows on the wall.",
    q: "scapular wall slides exercise"
  },
  band_pull_apart: {
    name: "Band Pull-Apart", cat: "pull", load: "band", target: { sets: 3, lo: 12, hi: 20 },
    equip: ["Bands"],
    setup: "Hold a band in front of you at shoulder width and height, arms straight.",
    cue: "Working set for rear delts/mid-back — pick a band you feel by the last reps. Arms straight, retract the shoulder blades, no shrug.",
    q: "band pull apart exercise"
  },
  face_pull: {
    name: "Band Face Pull", cat: "pull", load: "band", target: { sets: 3, lo: 12, hi: 20 },
    equip: ["Bands", "Anchor point"],
    setup: "Anchor a band at face height (door hinge or the pull-up bar), a handle in each hand, step back for tension.",
    cue: "Working set, not a warmup — progress the band. Pull to the face, elbows high, rotate hands back at the end.",
    q: "band face pull exercise"
  },
  scap_pushup: {
    name: "Scapular Push-Up", cat: "prehab", load: "reps", target: { sets: 2, lo: 8, hi: 12 },
    equip: ["Floor"],
    setup: "Get into a straight-arm plank, hands under the shoulders, arms locked.",
    cue: "Plank position, arms locked. Move only the shoulder blades: protract and retract.",
    q: "scapular push up exercise"
  },
  prone_ytw: {
    name: "Prone Y-T-W", cat: "prehab", load: "reps", target: { sets: 2, lo: 8, hi: 10 },
    equip: ["Floor"],
    setup: "Lie face-down on the floor, forehead down, arms out overhead in a Y.",
    cue: "Face down. Lift arms into Y, then T, then W, thumbs up. Small range, lower traps.",
    q: "prone Y T W raises exercise"
  },
  thoracic_open: {
    name: "Open-Book Thoracic Rotation", cat: "prehab", load: "reps", target: { sets: 1, lo: 6, hi: 8 }, side: true,
    equip: ["Floor"],
    setup: "Lie on your side, knees bent to 90°, both arms stacked straight out in front.",
    cue: "Side-lying, knees bent. Rotate the top arm to the floor behind you. Move from the mid-back.",
    q: "open book thoracic rotation exercise"
  },

  // ---- Pull ----
  pullup_prog: {
    name: "Pull-Up Progression", cat: "pull", load: "reps", target: { sets: 3, lo: 3, hi: 8 },
    equip: ["Pull-up bar"],
    setup: "Hang from the pull-up bar with an overhand grip (palms away), hands shoulder-width.",
    ladder: ["Dead hang (time)", "Scapular pull (shrug at bottom)", "Negative (slow lower)", "Band-assisted pull-up", "Full pull-up", "Weighted pull-up"],
    cue: "Depress the shoulder blades before the arms. Control the descent. Stop 1–2 reps short of failure.",
    q: "pull up progression beginner"
  },
  trx_row: {
    name: "Suspension / Inverted Row", cat: "pull", load: "reps", target: { sets: 3, lo: 8, hi: 12 },
    equip: ["Suspension trainer or low bar"],
    setup: "Set a suspension trainer or a bar at hip height; lie underneath, grip the handles, body straight. No suspension trainer? Swap to the Table Inverted Row.",
    cue: "Body straight. Retract shoulder blades, pull elbows back. Walk feet forward to add difficulty.",
    ladder: ["Feet back (easy)", "Feet under bar", "Feet forward", "Feet elevated"],
    q: "inverted row suspension trainer"
  },
  door_row: {
    name: "Table Inverted Row", cat: "pull", load: "reps", target: { sets: 3, lo: 8, hi: 15 },
    equip: ["Sturdy table"],
    setup: "Lie under a sturdy table and grip the edge with both hands (or loop a towel around a latched door's handles and hold both ends). Plant your feet, hang with a straight body, and pull your chest up to your hands.",
    cue: "Retract the shoulder blades and lead with the elbows. The more horizontal your body, the harder it gets. Control the descent.",
    q: "bodyweight inverted row under table no equipment"
  },
  band_row: {
    name: "Band Seated Row", cat: "pull", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    equip: ["Bands"],
    setup: "Sit on the floor, loop a band around your feet (or anchor it low), a handle in each hand, arms extended.",
    cue: "Anchor low. Row to the hips, retract shoulder blades. Keep shoulders back at full extension.",
    q: "seated band row exercise"
  },

  // ---- Push (chest = priority weak spot; conservative on the shoulder) ----
  pushup_prog: {
    name: "Push-Up Progression", cat: "push", load: "reps", target: { sets: 3, lo: 6, hi: 12 },
    equip: ["Floor"],
    setup: "Hands under the shoulders in a plank. Hands up on a counter/wall makes it easier; feet up on a chair/bed makes it harder.",
    ladder: ["Hands elevated (high)", "Hands elevated (low)", "Knee push-up", "Full push-up", "Feet elevated (upper chest)", "Weighted / band"],
    cue: "Hands under shoulders, elbows ~45°, body straight, lower under control. Higher hands = easier. Once strong, elevate the FEET (chair/bed) — that shifts the work to the upper chest, your lagging area.",
    q: "decline push up upper chest"
  },
  band_press: {
    name: "Band / Floor Chest Press", cat: "push", load: "band", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Bands", "Anchor point"],
    setup: "Anchor a band behind you at chest height (or lie on it), a handle in each hand starting low by the ribs.",
    cue: "Press LOW-TO-HIGH — hands start low, drive up and together — to bias the upper chest (your lagging area). Adduct across the chest at lockout, control the return.",
    q: "low to high band chest press upper chest"
  },
  pike_pushup: {
    name: "Pike Push-Up", cat: "push", load: "reps", target: { sets: 2, lo: 6, hi: 10 },
    equip: ["Floor"],
    setup: "Start in a downward-dog: hips high, hands and feet on the floor, head between the arms.",
    cue: "Hips high, lower the head toward the floor. Stop if the left shoulder is symptomatic.",
    q: "pike push up exercise"
  },
  band_pressdown: {
    name: "Band Triceps Pushdown", cat: "push", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    equip: ["Bands", "Anchor point"],
    setup: "Anchor a band high (over a door or the pull-up bar), grip it with both hands, elbows pinned to your sides.",
    cue: "Anchor the band high. Pin the elbows to your sides, extend fully, control back up. Shoulder-friendly triceps work.",
    q: "band triceps pushdown exercise"
  },
  band_fly: {
    name: "Band Chest Fly", cat: "push", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    equip: ["Bands", "Anchor point"],
    setup: "Anchor a band low behind you, a handle in each hand, arms open at chest height with a slight elbow bend.",
    cue: "Anchor LOW behind you and arc the hands up-and-together (low-to-high) to hit the upper chest. Slight fixed elbow bend, squeeze the chest, control the stretch. Isolates the pecs without loading the triceps.",
    q: "low to high band chest fly upper chest"
  },
  lateral_raise: {
    name: "Lateral Raise (delt width)", cat: "push", load: "band", target: { sets: 3, lo: 12, hi: 20 },
    equip: ["Bands or dumbbells"],
    setup: "Stand on the middle of a band with a handle in each hand (or hold a light weight / water bottle in each hand) at your sides.",
    cue: "Raise out to shoulder height, slight forward tilt, pinkies leading; control the descent. Light and strict — this is the side-delt 'cap' for shoulder width. Water bottles work if you've no bands/dumbbells yet.",
    q: "dumbbell lateral raise side delt form"
  },
  band_curl: {
    name: "Biceps Curl (supinated)", cat: "pull", load: "band", target: { sets: 3, lo: 8, hi: 15 },
    equip: ["Bands"],
    setup: "Stand on the middle of a band, a handle in each hand, palms forward, elbows pinned.",
    cue: "Elbows pinned, full range, squeeze hard at the top, slow descent. 8–15 reps near failure, add load over time. Builds the peak / long head. Use dumbbells once you have them — bands run out of tension here.",
    q: "dumbbell biceps curl exercise"
  },
  hammer_curl: {
    name: "Hammer Curl (neutral grip)", cat: "pull", load: "band", target: { sets: 3, lo: 8, hi: 15 },
    equip: ["Bands or dumbbells"],
    setup: "Stand on a band (or hold a weight in each hand) with a neutral grip, thumbs up, elbows pinned.",
    cue: "Palms neutral (thumbs up), curl with control. Trains the brachialis under the biceps — adds thickness and pushes the peak up. Load it: dumbbells beat bands here.",
    q: "hammer curl exercise"
  },

  // ---- Legs ----
  goblet_squat: {
    name: "Goblet / Bodyweight Squat", cat: "legs", load: "reps", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Floor"],
    setup: "Stand feet shoulder-width, toes slightly out. Hold a weight/loaded backpack at your chest if you have one, otherwise bodyweight.",
    ladder: ["Box squat", "Bodyweight squat", "Tempo bodyweight", "Goblet (band/weight)"],
    cue: "Chest up, knees track over toes, hips between the heels. Drive through the full foot.",
    q: "goblet squat exercise"
  },
  split_squat: {
    name: "Split Squat", cat: "legs", load: "reps", target: { sets: 3, lo: 8, hi: 12 }, side: true,
    equip: ["Floor"],
    setup: "Stand in a long split stance, back heel lifted, torso tall.",
    cue: "Long stance. Lower the back knee straight down. Weight on the front heel.",
    q: "split squat exercise form"
  },
  rdl: {
    name: "Hip Hinge / RDL", cat: "legs", load: "band", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Bands or backpack"],
    setup: "Stand on the middle of a band holding the handles at your thighs (or hold a loaded backpack), feet hip-width.",
    cue: "Hips back, soft knees, flat back. Load the hamstrings, stand tall via the glutes.",
    q: "romanian deadlift hip hinge form"
  },
  calf_raise: {
    name: "Calf Raise", cat: "legs", load: "reps", target: { sets: 2, lo: 12, hi: 20 },
    equip: ["Floor"],
    setup: "Stand tall, balls of the feet on the floor or the edge of a step, heels free to drop.",
    cue: "Full range, pause at the top, slow descent. Single-leg when easy.",
    q: "standing calf raise exercise"
  },

  // ---- Core ----
  dead_bug: {
    name: "Dead Bug", cat: "core", load: "reps", target: { sets: 3, lo: 8, hi: 10 }, side: true,
    equip: ["Floor"],
    setup: "Lie on your back, arms reaching at the ceiling, hips and knees bent to 90°.",
    cue: "Low back flat to the floor. Extend opposite arm and leg slowly. Exhale on extension.",
    q: "dead bug exercise"
  },
  pallof: {
    name: "Pallof Press", cat: "core", load: "band", target: { sets: 3, lo: 10, hi: 12 }, side: true,
    equip: ["Bands", "Anchor point"],
    setup: "Anchor a band at chest height to your side; hold it at your chest with both hands, step out for tension.",
    cue: "Band anchored to the side. Press straight out, resist rotation. Brace the trunk.",
    q: "pallof press exercise"
  },
  plank: {
    name: "Plank", cat: "core", load: "time", target: { sets: 3, sec: 30 },
    equip: ["Floor"],
    setup: "Forearms and toes on the floor, elbows under the shoulders, body in a straight line.",
    cue: "Forearms down, ribs tucked, glutes squeezed, straight line. Stop when form breaks.",
    q: "forearm plank exercise form"
  },
  hollow_hold: {
    name: "Hollow Hold", cat: "core", load: "time", target: { sets: 3, sec: 20 },
    equip: ["Floor"],
    setup: "Lie on your back, press the low back into the floor, arms and legs extended off the floor.",
    cue: "Low back pressed down, arms and legs extended off the floor. Bend knees to regress.",
    q: "hollow hold exercise"
  },
  hanging_knee: {
    name: "Hanging Knee Raise", cat: "core", load: "reps", target: { sets: 3, lo: 8, hi: 12 },
    equip: ["Pull-up bar"],
    setup: "Hang from the bar with an overhand grip, legs straight and still.",
    ladder: ["Lying leg raise", "Hanging knee tuck", "Hanging knee raise", "Hanging leg raise"],
    cue: "Hang from the bar. Raise the knees by curling the pelvis up — not just swinging the legs. Direct, loadable ab work.",
    q: "hanging knee raise exercise"
  },

  // ---- Conditioning ----
  row_steady: {
    name: "Rower — Steady", cat: "cond", load: "cardio", target: { sets: 1, sec: 300 },
    equip: ["Rower"],
    setup: "Strap your feet in, grip the handle, sit tall at the catch.",
    cue: "Easy-moderate pace for the set time. Log your METERS — beating your distance in the same time is how you get fitter. Legs → hips → arms; reverse on the return.",
    q: "rowing machine technique pace"
  },
  row_intervals: {
    name: "Rower — Intervals", cat: "cond", load: "time", target: { sets: 6, sec: 30 },
    equip: ["Rower"],
    setup: "Strap your feet in, grip the handle. Each set is 30s hard / 60s easy.",
    cue: "30s hard / 60s easy. Strong, smooth strokes.",
    q: "rowing machine interval workout technique"
  },

  // ---- Bodyweight / household substitutes (Phase 1, before bands/dumbbells) ----
  chinup_prog: {
    name: "Chin-Up Progression (biceps)", cat: "pull", load: "reps", target: { sets: 3, lo: 3, hi: 8 },
    equip: ["Pull-up bar"],
    setup: "Hang from the bar with an underhand grip (palms toward you), hands shoulder-width.",
    ladder: ["Dead hang (time)", "Scapular pull", "Negative chin (slow lower)", "Chair-assisted chin-up", "Full chin-up", "Weighted chin-up"],
    cue: "Underhand grip (palms toward you) — loads the biceps hard plus the back. Lead the chest to the bar, control the lower. Your main biceps builder until you have load.",
    q: "chin up progression beginner"
  },
  prone_row: {
    name: "Prone Row / Bat Wing", cat: "pull", load: "reps", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Floor"],
    setup: "Lie face-down, arms hanging toward the floor (elevate your chest on a bed edge for more range).",
    cue: "Face-down, arms hanging. Row the elbows up high and squeeze the shoulder blades for a count. Rear delts and mid-back without a band.",
    q: "prone row bat wing rear delt exercise"
  },
  diamond_pushup: {
    name: "Diamond Push-Up (triceps)", cat: "push", load: "reps", target: { sets: 3, lo: 6, hi: 12 },
    equip: ["Floor"],
    setup: "Plank with the hands together under your chest, thumbs and index fingers forming a diamond.",
    ladder: ["Hands elevated", "Knee diamond", "Full diamond", "Feet elevated"],
    cue: "Hands together under the chest, elbows tracking back (not flared). Triceps focus — drop to hands-elevated if the shoulder complains.",
    q: "diamond push up exercise"
  },
  deep_pushup: {
    name: "Deep / Feet-Elevated Push-Up (chest)", cat: "push", load: "reps", target: { sets: 3, lo: 8, hi: 12 },
    equip: ["Floor", "Chair"],
    setup: "Feet up on a chair/bed for the upper chest, or hands on two books for a deeper pec stretch.",
    cue: "Feet up on a chair/bed to bias the UPPER chest (your lagging area), or hands on books for a deeper pec stretch. Control the bottom. The bodyweight chest-fly stand-in.",
    q: "feet elevated decline push up upper chest"
  },
  backpack_curl: {
    name: "Backpack Curl", cat: "pull", load: "weight", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Backpack"],
    setup: "Load a backpack with books or water jugs; hold it by the base or top handle, elbows pinned.",
    cue: "Load a backpack with books or water jugs. Curl with elbows pinned, squeeze the top, slow lower. Add books to progress.",
    q: "backpack biceps curl no weights"
  },
  sl_rdl: {
    name: "Single-Leg RDL", cat: "legs", load: "reps", target: { sets: 3, lo: 8, hi: 12 }, side: true,
    equip: ["Floor"],
    setup: "Stand on one leg, slight knee bend, other foot ready to extend behind. Hold a loaded backpack to add load.",
    cue: "Hinge at the hip on one leg, back flat, free leg extending behind for balance. Feel the hamstring. Hold a backpack to load it.",
    q: "single leg romanian deadlift bodyweight"
  },
  bird_dog: {
    name: "Bird Dog (anti-rotation)", cat: "core", load: "reps", target: { sets: 3, lo: 8, hi: 10 }, side: true,
    equip: ["Floor"],
    setup: "On all fours, hands under the shoulders, knees under the hips, spine neutral.",
    cue: "On all fours, extend opposite arm + leg without letting the hips rotate. Slow and braced. Anti-rotation core, no band needed.",
    q: "bird dog exercise"
  },

  // ---- Mobility / decompression (off-day + cooldown) ----
  dead_hang: {
    name: "Dead Hang", cat: "mobility", load: "time", target: { sets: 3, sec: 30 },
    equip: ["Pull-up bar"],
    setup: "Hang from the bar, overhand grip, feet off the floor (or lightly touching to regress).",
    ladder: ["Active scapular hang (shoulders engaged)", "Passive dead hang", "Single-arm assisted", "Weighted hang"],
    cue: "Hang from the bar. START ACTIVE — pull the shoulders gently DOWN out of the shrug and stay engaged — before any fully passive hanging. Decompresses the shoulder and builds grip. Build time slowly; stop if the shoulder feels unstable.",
    q: "dead hang shoulder decompression active scapular"
  },
  doorway_pec: {
    name: "Doorway Pec Stretch", cat: "mobility", load: "time", target: { sets: 2, sec: 30 }, side: true,
    equip: ["Doorway"],
    setup: "Forearm on the door frame, elbow near shoulder height; step through the doorway and turn away.",
    cue: "Forearm on the door frame, elbow near shoulder height, step through and turn away. Opens the chest and front shoulder — the anti-hunch stretch.",
    q: "doorway pec stretch"
  },
  hip_flexor: {
    name: "Half-Kneeling Hip Flexor Stretch", cat: "mobility", load: "time", target: { sets: 2, sec: 30 }, side: true,
    equip: ["Floor"],
    setup: "Half-kneel, one knee down on something soft, the other foot planted in front.",
    cue: "Half-kneeling. Tuck the pelvis under and squeeze the back glute, THEN lean forward. Stretches the desk-tight hip flexor. Don't arch the low back.",
    q: "half kneeling hip flexor stretch"
  },
  deep_squat_hold: {
    name: "Deep Squat Hold", cat: "mobility", load: "time", target: { sets: 2, sec: 30 },
    equip: ["Floor"],
    setup: "Sink into your deepest squat, heels flat, elbows inside the knees.",
    cue: "Sink into the deepest squat you can, heels down, elbows gently pushing the knees out. Hip and ankle mobility for cleaner squats.",
    q: "deep squat hold mobility"
  },
  cat_cow: {
    name: "Cat-Cow", cat: "mobility", load: "reps", target: { sets: 1, lo: 8, hi: 10 },
    equip: ["Floor"],
    setup: "On all fours, hands under the shoulders, knees under the hips.",
    cue: "On all fours, slowly alternate arching (cow) and rounding (cat) the spine with your breath. Gentle spinal mobility.",
    q: "cat cow spinal mobility"
  },
};

/* Sessions — a rotating A/B/C deck. Do "the next one" whenever you train,
 * so 3 or 5 days a week both work and travel never breaks the plan.
 */
const SESSIONS = {
  A: {
    name: "A · Back & Arms",
    focus: "Mid-back, lats, rear delts, biceps + triceps, core",
    blocks: [
      { title: "Prehab", ex: ["wall_slides", "scap_pushup", "thoracic_open"] },
      { title: "Strength", ex: ["pullup_prog", "trx_row", "face_pull", "band_curl", "hammer_curl", "band_pressdown"] },
      { title: "Core", ex: ["dead_bug", "hanging_knee"] },
      { title: "Conditioning", ex: ["row_steady"] },
    ],
  },
  B: {
    name: "B · Chest & Delts",
    focus: "Chest (upper bias), side delts, triceps, legs, core",
    blocks: [
      { title: "Prehab", ex: ["wall_slides", "face_pull", "prone_ytw"] },
      { title: "Strength", ex: ["pushup_prog", "band_press", "lateral_raise", "diamond_pushup", "goblet_squat"] },
      { title: "Core", ex: ["plank", "pallof"] },
      { title: "Conditioning", ex: ["row_steady"] },
    ],
  },
  C: {
    name: "C · Full Body & Arms",
    focus: "Mid-back, upper chest, side delts, hamstrings, biceps, engine",
    blocks: [
      { title: "Prehab", ex: ["scap_pushup", "prone_ytw", "thoracic_open"] },
      { title: "Strength", ex: ["band_row", "band_fly", "lateral_raise", "rdl", "band_curl", "hammer_curl"] },
      { title: "Core", ex: ["hollow_hold", "hanging_knee"] },
      { title: "Conditioning", ex: ["row_intervals"] },
    ],
  },
};

const SESSION_ORDER = ["A", "B", "C"];

const PAIN_AREAS = ["Winged scapula / L shoulder blade", "L shoulder (old dislocation)", "Neck / upper back", "Lower back", "Other"];

/* Swap alternatives — same muscle, different angle/equipment/load.
 * Used by the one-tap swap (e.g., a movement aggravates the shoulder). */
const ALTS = {
  pullup_prog: ["chinup_prog", "door_row", "band_row"],
  trx_row: ["door_row", "band_row", "prone_row"],
  door_row: ["band_row", "prone_row", "trx_row"],
  band_row: ["door_row", "prone_row", "trx_row"],
  lateral_raise: ["pike_pushup", "prone_ytw"],
  band_press: ["pushup_prog", "band_fly", "deep_pushup"],
  pushup_prog: ["band_press", "band_fly", "deep_pushup"],
  band_fly: ["deep_pushup", "pushup_prog", "band_press"],
  deep_pushup: ["pushup_prog", "band_fly"],
  pike_pushup: ["band_press", "pushup_prog"],
  band_pressdown: ["diamond_pushup", "pushup_prog"],
  diamond_pushup: ["band_pressdown", "pushup_prog"],
  band_curl: ["chinup_prog", "backpack_curl", "hammer_curl"],
  hammer_curl: ["backpack_curl", "chinup_prog", "band_curl"],
  chinup_prog: ["band_curl", "backpack_curl", "pullup_prog"],
  backpack_curl: ["band_curl", "chinup_prog"],
  face_pull: ["prone_row", "band_pull_apart", "prone_ytw"],
  band_pull_apart: ["prone_ytw", "prone_row", "face_pull"],
  prone_row: ["face_pull", "prone_ytw"],
  prone_ytw: ["face_pull", "prone_row", "band_pull_apart"],
  goblet_squat: ["split_squat"],
  split_squat: ["goblet_squat", "sl_rdl"],
  rdl: ["sl_rdl", "goblet_squat"],
  sl_rdl: ["rdl", "split_squat"],
  calf_raise: [],
  dead_bug: ["bird_dog", "hollow_hold", "plank"],
  hanging_knee: ["dead_bug", "hollow_hold"],
  pallof: ["bird_dog", "dead_bug"],
  bird_dog: ["pallof", "dead_bug"],
  plank: ["hollow_hold", "dead_bug"],
  hollow_hold: ["plank", "dead_bug"],
  wall_slides: ["scap_pushup"],
  scap_pushup: ["wall_slides"],
  thoracic_open: ["wall_slides"],
  row_steady: ["row_intervals"],
  row_intervals: ["row_steady"],
};

/* One-tap "no bands yet" mode — maps band moves to bodyweight/household equivalents. */
const BW_SWAPS = {
  band_press: "deep_pushup",
  band_fly: "deep_pushup",
  band_pressdown: "diamond_pushup",
  band_pull_apart: "prone_ytw",
  face_pull: "prone_row",
  band_curl: "chinup_prog",
  hammer_curl: "backpack_curl",
  pallof: "bird_dog",
  rdl: "sl_rdl",
  band_row: "door_row",
  trx_row: "door_row",
};
