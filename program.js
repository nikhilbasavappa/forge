/* program.js — seeded starter program & exercise library.
 * Posture/scapula-first, home equipment (pull-up bar, bands, suspension trainer,
 * mat, rower). Conservative shoulder loading; ramps as pain stays low.
 * This is data only — app.js handles logging, progression, and adaptation.
 */

const PROGRAM_VERSION = 3;

/* Exercise library.
 * load:   'reps' | 'time' | 'band' | 'weight' | 'reps+load'
 * target: {sets, lo, hi}  (reps range)  OR  {sets, sec}  (timed hold)
 * ladder: easiest -> hardest variations the app can step you through
 * side:   true if reps/time are per-side
 * equip:  array of equipment you must physically have to do this exact variant
 * setup:  one line on how to set the equipment/body up before the first rep
 * q:      YouTube search query for a demo video (must match the exact variant)
 * muscle: primary target for strength-pool exercises (drives session generation —
 *         see MUSCLE_TARGETS/MUSCLE_POOLS in app.js). Omitted for prehab/core/cond/mobility,
 *         which are selected by `cat` instead.
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
  floor_slides: {
    name: "Floor Slides", cat: "prehab", load: "reps", target: { sets: 2, lo: 8, hi: 12 },
    equip: ["Floor"],
    setup: "Lie on your back, knees bent feet flat, arms up in a goalpost, backs of the hands on the floor.",
    cue: "Low back flat to the floor, ribs down. Slide arms overhead keeping wrists and elbows on the floor — same move as wall slides, floor is the flat reference instead of a wall. No wall contact needed.",
    q: "floor slides shoulder exercise"
  },
  band_pull_apart: {
    name: "Band Pull-Apart", cat: "pull", muscle: "rear_delts", load: "band", target: { sets: 3, lo: 12, hi: 20 },
    equip: ["Bands"],
    setup: "Hold a band in front of you at shoulder width and height, arms straight.",
    cue: "Working set for rear delts/mid-back — pick a band you feel by the last reps. Arms straight, retract the shoulder blades, no shrug.",
    q: "band pull apart exercise"
  },
  face_pull: {
    name: "Band Face Pull", cat: "pull", muscle: "rear_delts", load: "band", target: { sets: 3, lo: 12, hi: 20 },
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
    name: "Pull-Up Progression", cat: "pull", muscle: "back", load: "reps", target: { sets: 3, lo: 3, hi: 8 },
    equip: ["Pull-up bar"],
    setup: "Hang from the pull-up bar with an overhand grip (palms away), hands shoulder-width.",
    ladder: ["Dead hang (time)", "Scapular pull (shrug at bottom)", "Negative (slow lower)", "Band-assisted pull-up", "Full pull-up", "Weighted pull-up"],
    // Each rung below is a genuinely different movement, not the same pull-up at increasing
    // difficulty — the exercise-level cue/setup ("lead the chest to the bar") only actually
    // applies to the last two rungs. rungCue()/rungSetup() in app.js prefer these when present.
    ladderSetup: [
      "Hang from the bar with an overhand grip, arms fully extended, feet off the floor.",
      "Hang from the bar with an overhand grip, arms straight.",
      "Jump or step up so your chin is already over the bar, overhand grip.",
      "Loop a resistance band over the bar and under one knee or foot for assistance, then hang overhand.",
      "Hang from the bar with an overhand grip (palms away), hands shoulder-width, arms fully extended.",
      "Add weight with a dip belt, weighted vest, or a loaded backpack, then hang from the bar overhand.",
    ],
    ladderCue: [
      "Just hang — relax into it, brace the core so you don't swing. Timed hold, not reps: build hang time and shoulder stability before adding any pulling.",
      "Without bending the elbows, pull the shoulder blades down and together, then relax back to a dead hang. Small movement, no elbow bend — this is the shoulder-blade set you'll need before the elbows ever bend.",
      "Start at the top (chin over the bar) and lower yourself as slowly as you can, 3–5+ seconds down. The lowering strength is what lets you pull yourself up in the first place.",
      "Pull through a full range with the band taking some of your weight. Use the lightest band that still lets you complete the set — less help each time you retest.",
      "Depress the shoulder blades before the arms move. Pull your chin over the bar, control the descent. Stop 1–2 reps short of failure.",
      "Same full pull-up technique, now loaded. Depress the shoulder blades before the arms move, chin over the bar, control the descent. Add weight in small jumps once you clear the top of your rep range.",
    ],
    cue: "Depress the shoulder blades before the arms. Control the descent. Stop 1–2 reps short of failure.",
    q: "pull up progression beginner"
  },
  trx_row: {
    name: "Suspension / Inverted Row", cat: "pull", muscle: "back", load: "reps", target: { sets: 3, lo: 8, hi: 12 },
    equip: ["Suspension trainer or low bar"],
    setup: "Set a suspension trainer or a bar at hip height; lie underneath, grip the handles, body straight. No suspension trainer? Swap to the Table Inverted Row.",
    cue: "Body straight. Retract shoulder blades, pull elbows back. Walk feet forward to add difficulty.",
    ladder: ["Feet back (easy)", "Feet under bar", "Feet forward", "Feet elevated"],
    q: "inverted row suspension trainer"
  },
  door_row: {
    name: "Table Inverted Row", cat: "pull", muscle: "back", load: "reps", target: { sets: 3, lo: 8, hi: 15 },
    equip: ["Sturdy table"],
    setup: "Lie under a sturdy table and grip the edge with both hands (or loop a towel around a latched door's handles and hold both ends). Plant your feet, hang with a straight body, and pull your chest up to your hands.",
    cue: "Retract the shoulder blades and lead with the elbows. The more horizontal your body, the harder it gets. Control the descent.",
    q: "bodyweight inverted row under table no equipment"
  },
  band_row: {
    name: "Band Seated Row", cat: "pull", muscle: "back", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    equip: ["Bands"],
    setup: "Sit on the floor, loop a band around your feet (or anchor it low), a handle in each hand, arms extended.",
    cue: "Anchor low. Row to the hips, retract shoulder blades. Keep shoulders back at full extension.",
    // Seated + feet-anchored is band-specific; the dumbbell equivalent is a standing bent-over
    // row, not the same body position — different setup/cue, not a find-replace of "band".
    equipDumbbell: ["Dumbbells"],
    setupDumbbell: "Hinge forward at the hips, flat back, a dumbbell in each hand hanging straight down.",
    cueDumbbell: "Hinged over, flat back. Row the dumbbells to the hips, retract the shoulder blades. Keep shoulders back at full extension.",
    q: "seated band row exercise"
  },

  // ---- Push (chest = priority weak spot; conservative on the shoulder) ----
  pushup_prog: {
    name: "Push-Up Progression", cat: "push", muscle: "chest", load: "reps", target: { sets: 3, lo: 6, hi: 12 },
    equip: ["Floor"],
    setup: "Hands under the shoulders in a plank. Hands up on a counter/wall makes it easier; feet up on a chair/bed makes it harder.",
    ladder: ["Hands elevated (high)", "Hands elevated (low)", "Knee push-up", "Full push-up", "Feet elevated (upper chest)", "Weighted / band"],
    // "Body straight" (the exercise-level cue) is flat wrong for the knee push-up rung — the
    // whole point there is the knees are down and the torso-to-knee line is what stays straight,
    // not torso-to-feet. The base cue's "once strong, elevate the feet" line is also forward-
    // looking advice that's only relevant BEFORE you reach the feet-elevated rung — stale once
    // you're already there or past it. Writing all 6 out avoids both problems.
    ladderSetup: [
      "Hands on a high surface — a countertop or sturdy table — feet on the floor, body in a straight line.",
      "Hands on a lower surface — a chair seat, coffee table, or low step — feet on the floor, body in a straight line.",
      "Plank on your knees instead of your toes, hands under the shoulders.",
      "Hands under the shoulders in a plank, feet together or hip-width, body in a straight line from head to heels.",
      "Feet up on a chair or the edge of a bed, hands on the floor under the shoulders, body in a straight line.",
      "Add a weight plate or loaded backpack on your back, or loop a band across your shoulders and under your hands, then set up in a full plank.",
    ],
    ladderCue: [
      "Hands under the shoulders on the elevated surface, elbows ~45°, body straight from head to heels, lower under control. The higher your hands, the easier — pick a height that leaves 1–2 reps in reserve.",
      "Same as the last rung, just lower — closer to the floor increases the load. Elbows ~45°, body straight, lower under control.",
      "Knees down, hands under shoulders, straight line from knees to head — don't let the hips sag or pike. Lower the chest toward the floor, elbows ~45°.",
      "Hands under shoulders, elbows ~45°, body straight, lower under control. Once this is easy for all sets, the next rung elevates the FEET to shift work toward the upper chest — your lagging area.",
      "Same push-up technique, feet elevated — shifts the work toward the upper chest, your lagging area. Elbows ~45°, body straight, lower under control.",
      "Same full push-up technique (feet elevated too, if you're ready for it), now loaded. Elbows ~45°, body straight, lower under control. Add load in small increments once you clear the top of your rep range.",
    ],
    cue: "Hands under shoulders, elbows ~45°, body straight, lower under control. Higher hands = easier. Once strong, elevate the FEET (chair/bed) — that shifts the work to the upper chest, your lagging area.",
    q: "decline push up upper chest"
  },
  band_press: {
    name: "Band / Floor Chest Press", cat: "push", muscle: "chest", load: "band", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Bands", "Anchor point"],
    setup: "Anchor a band behind you at chest height (or lie on it), a handle in each hand starting low by the ribs.",
    cue: "Press LOW-TO-HIGH — hands start low, drive up and together — to bias the upper chest (your lagging area). Adduct across the chest at lockout, control the return.",
    // Diagonal, anchor-resisted path with adduction at lockout — same mismatch as band_fly.
    // Gravity can't replicate "low-to-high, hands together" lying down; stays band-only.
    noDumbbellMode: true,
    q: "low to high band chest press upper chest"
  },
  pike_pushup: {
    name: "Pike Push-Up", cat: "push", muscle: "chest", load: "reps", target: { sets: 2, lo: 6, hi: 10 },
    equip: ["Floor"],
    setup: "Start in a downward-dog: hips high, hands and feet on the floor, head between the arms.",
    cue: "Hips high, lower the head toward the floor. Stop if the left shoulder is symptomatic.",
    q: "pike push up exercise"
  },
  band_pressdown: {
    name: "Band Triceps Pushdown", cat: "push", muscle: "triceps", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    equip: ["Bands", "Anchor point"],
    setup: "Anchor a band high (over a door or the pull-up bar), grip it with both hands, elbows pinned to your sides.",
    cue: "Anchor the band high. Pin the elbows to your sides, extend fully, control back up. Shoulder-friendly triceps work.",
    // A bent-over dumbbell kickback keeps the same "elbow pinned, extend the forearm" pattern the
    // band version uses — an overhead extension would be a different plane entirely, not a clean
    // substitute. Had no equipDumbbell fields at all before, so this never converted even with
    // the toggle on.
    equipDumbbell: ["Dumbbells"],
    setupDumbbell: "Hinge forward at the hips, flat back, a dumbbell in each hand, elbows pinned high at your sides, forearms hanging straight down.",
    cueDumbbell: "Elbows pinned at your sides, extend the forearms straight back until fully extended, control the return. Same shoulder-friendly triceps isolation as the band version, now resisted by gravity instead of band tension.",
    q: "dumbbell triceps kickback exercise"
  },
  band_fly: {
    name: "Band Chest Fly", cat: "push", muscle: "chest", load: "band", target: { sets: 3, lo: 12, hi: 15 },
    equip: ["Bands", "Anchor point"],
    setup: "Anchor a band low behind you, a handle in each hand, arms open at chest height with a slight elbow bend.",
    cue: "Anchor LOW behind you and arc the hands up-and-together (low-to-high) to hit the upper chest. Slight fixed elbow bend, squeeze the chest, control the stretch. Isolates the pecs without loading the triceps.",
    // Diagonal, anchor-resisted crossover — a dumbbell (gravity only) can't pull the hands
    // together at the top the way a band anchored behind you can. Stays band-only.
    noDumbbellMode: true,
    q: "low to high band chest fly upper chest"
  },
  lateral_raise: {
    name: "Lateral Raise (delt width)", cat: "push", muscle: "side_delts", load: "band", target: { sets: 3, lo: 12, hi: 20 },
    equip: ["Bands or dumbbells"],
    setup: "Stand on the middle of a band with a handle in each hand (or hold a light weight / water bottle in each hand) at your sides.",
    cue: "Raise out to shoulder height, slight forward tilt, pinkies leading; control the descent. Light and strict — this is the side-delt 'cap' for shoulder width. Water bottles work if you've no bands/dumbbells yet.",
    // The base setup/cue already mentioned dumbbells inline as a workaround, but with no
    // equipDumbbell fields the equipment chip stayed "Bands or dumbbells" forever even in
    // dumbbell mode, and isNumericLoad() already treats this as a weighted/progressable
    // exercise once the toggle is on (the name matches the dumbbellMode regex) — so the app was
    // tracking it as weight-based without ever cleanly saying so.
    equipDumbbell: ["Dumbbells"],
    setupDumbbell: "Stand tall, a dumbbell in each hand at your sides.",
    cueDumbbell: "Raise out to shoulder height, slight forward tilt, pinkies leading; control the descent. Light and strict — this is the side-delt 'cap' for shoulder width.",
    q: "dumbbell lateral raise side delt form"
  },
  band_upright_row: {
    name: "Band Upright Row", cat: "pull", muscle: "side_delts", load: "band", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Bands"],
    setup: "Stand on the middle of a band, a handle in each hand in front of your thighs, palms facing your body.",
    cue: "Pull the handles straight up along your body, leading with the elbows, to about chest height — no higher, that's where the shoulder risk starts. Pause, lower under control. A second angle on the side delts, different loading curve than the lateral raise.",
    // A straight vertical pull along the body — gravity resists this the same way a band does,
    // so it translates cleanly, just with different setup wording.
    equipDumbbell: ["Dumbbells"],
    setupDumbbell: "Hold a dumbbell in each hand in front of your thighs, palms facing your body.",
    cueDumbbell: "Pull the dumbbells straight up along your body, leading with the elbows, to about chest height — no higher, that's where the shoulder risk starts. Pause, lower under control. A second angle on the side delts, different loading curve than the lateral raise.",
    q: "band upright row exercise"
  },
  band_curl: {
    name: "Biceps Curl (supinated)", cat: "pull", muscle: "biceps", load: "band", target: { sets: 3, lo: 8, hi: 15 },
    equip: ["Bands"],
    setup: "Stand on the middle of a band, a handle in each hand, palms forward, elbows pinned.",
    cue: "Elbows pinned, full range, squeeze hard at the top, slow descent. 8–15 reps near failure, add load over time. Builds the peak / long head. Use dumbbells once you have them — bands run out of tension here.",
    equipDumbbell: ["Dumbbells"],
    setupDumbbell: "Hold a dumbbell in each hand, palms forward, elbows pinned.",
    cueDumbbell: "Elbows pinned, full range, squeeze hard at the top, slow descent. 8–15 reps near failure, add load over time. Builds the peak / long head.",
    q: "dumbbell biceps curl exercise"
  },
  hammer_curl: {
    name: "Hammer Curl (neutral grip)", cat: "pull", muscle: "biceps", load: "band", target: { sets: 3, lo: 8, hi: 15 },
    equip: ["Bands or dumbbells"],
    setup: "Stand on a band (or hold a weight in each hand) with a neutral grip, thumbs up, elbows pinned.",
    cue: "Palms neutral (thumbs up), curl with control. Trains the brachialis under the biceps — adds thickness and pushes the peak up. Load it: dumbbells beat bands here.",
    // Same gap as lateral_raise: no equipDumbbell fields despite the cue itself saying dumbbells
    // are the better tool, so the equipment chip and setup text never actually switched over.
    equipDumbbell: ["Dumbbells"],
    setupDumbbell: "Hold a dumbbell in each hand with a neutral grip (palms facing each other), elbows pinned.",
    cueDumbbell: "Palms neutral (thumbs up), curl with control. Trains the brachialis under the biceps — adds thickness and pushes the peak up.",
    q: "dumbbell hammer curl exercise"
  },

  // ---- Legs ----
  goblet_squat: {
    name: "Goblet / Bodyweight Squat", cat: "legs", muscle: "legs", load: "reps", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Floor"],
    setup: "Stand feet shoulder-width, toes slightly out. Hold a weight/loaded backpack at your chest if you have one, otherwise bodyweight.",
    ladder: ["Box squat", "Bodyweight squat", "Tempo bodyweight", "Goblet (band/weight)"],
    // Box squat needs a literal object to sit onto (never stated); tempo squat's protocol was
    // never explained at all. ladderEquip covers the box; ladderSetup/ladderCue cover the rest.
    ladderEquip: [
      ["Floor", "Sturdy chair or step"],
      null,
      null,
      ["Floor", "Weight or loaded backpack"],
    ],
    ladderSetup: [
      "Stand in front of a sturdy chair or step, feet shoulder-width, toes slightly out.",
      "Stand feet shoulder-width, toes slightly out, bodyweight only — no added load yet.",
      "Stand feet shoulder-width, toes slightly out, bodyweight only.",
      "Stand feet shoulder-width, toes slightly out, holding a weight or loaded backpack at your chest.",
    ],
    ladderCue: [
      "Sit back and down onto the chair, tap it lightly with your hips, then stand back up — don't relax your weight fully onto it. Builds depth and control before free-standing squats.",
      "Chest up, knees track over toes, hips between the heels. Drive through the full foot. Once this feels easy, the next rung adds slow tempo before you add any weight.",
      "Same bodyweight squat, but slow it down: 3 seconds lowering, 1 second pause at the bottom, then stand. The extra time under tension is what makes bodyweight alone still count as progress.",
      "Hold the load at your chest, elbows in. Chest up, knees track over toes, hips between the heels, drive through the full foot.",
    ],
    cue: "Chest up, knees track over toes, hips between the heels. Drive through the full foot.",
    q: "goblet squat exercise"
  },
  split_squat: {
    name: "Split Squat", cat: "legs", muscle: "legs", load: "reps", target: { sets: 3, lo: 8, hi: 12 }, side: true,
    equip: ["Floor"],
    setup: "Stand in a long split stance, back heel lifted, torso tall.",
    cue: "Long stance. Lower the back knee straight down. Weight on the front heel.",
    q: "split squat exercise form"
  },
  rdl: {
    name: "Hip Hinge / RDL", cat: "legs", muscle: "legs", load: "band", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Bands or backpack"],
    setup: "Stand on the middle of a band holding the handles at your thighs (or hold a loaded backpack), feet hip-width.",
    cue: "Hips back, soft knees, flat back. Load the hamstrings, stand tall via the glutes.",
    equipDumbbell: ["Dumbbells"],
    setupDumbbell: "Hold a dumbbell in each hand in front of your thighs, feet hip-width.",
    cueDumbbell: "Hips back, soft knees, flat back. Load the hamstrings, stand tall via the glutes.",
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
    // Lateral anti-rotation resistance from a side anchor — gravity can't replicate a dumbbell
    // pulling you sideways. Stays band-only regardless of dumbbell ownership.
    noDumbbellMode: true,
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
    // Rung 1 ("Lying leg raise") is a FLOOR exercise — it doesn't use the bar at all, despite
    // the exercise-level setup/cue and equip[] both being written for the hanging rungs. That's
    // a direct contradiction, not just a missing detail — hence ladderEquip too, not just text.
    ladderEquip: [
      ["Floor"],
      null,
      null,
      null,
    ],
    ladderSetup: [
      "Lie flat on your back on the floor, legs straight, hands at your sides or under your lower back.",
      "Hang from the bar with an overhand grip, legs relaxed.",
      "Hang from the bar with an overhand grip, legs straight and still.",
      "Hang from the bar with an overhand grip, legs straight and together.",
    ],
    ladderCue: [
      "No bar needed. Keeping legs straight, raise them to vertical by curling the pelvis, then lower under control without letting your lower back arch off the floor.",
      "Curl the pelvis to bring the knees up toward the chest, then lower under control. Small, controlled — not a kick or a swing.",
      "Raise the knees by curling the pelvis up, not just swinging the legs. Direct, loadable ab work.",
      "Keeping legs straight, raise them to hip height (or higher) by curling the pelvis, then lower under control. The straight-leg lever is what makes this the hardest rung.",
    ],
    cue: "Hang from the bar. Raise the knees by curling the pelvis up — not just swinging the legs. Direct, loadable ab work.",
    q: "hanging knee raise exercise"
  },

  // ---- Conditioning ----
  row_steady: {
    name: "Rower — Steady", cat: "cond", load: "cardio", target: { sets: 1, sec: 300 },
    equip: ["Rower"],
    setup: "Strap your feet in, grip the handle, sit tall at the catch.",
    cue: "Easy-moderate pace for the set time. Log your STROKE COUNT — beating your strokes in the same time is how you get fitter. Legs → hips → arms; reverse on the return.",
    q: "rowing machine technique pace"
  },
  row_intervals: {
    name: "Rower — Intervals", cat: "cond", load: "cardio", target: { sets: 12 },
    // 6 rounds of 30s hard / 60s easy, modeled as 12 SEPARATE alternating sets — not 6 sets that
    // each secretly bundle a hard AND an easy phase into one timer/target. The old bundled model
    // made "beat your stroke rate" ambiguous (one strokes field covering both a 30s hard push and
    // a 60s easy paddle can't mean anything), and it silently chained a 60s rest onto EVERY one
    // of the 6 rows on top of the 60s easy phase already being logged as its own thing — meaning
    // a full round of hard+easy was really hard+easy+ANOTHER 60s, not the intended hard+easy.
    // Each entry here is its own set: its own timer, its own single target, no auto-chained rest
    // tacked on afterward — the easy set immediately following a hard one already IS the rest.
    intervalPattern: [
      { sec: 30, phase: "hard" }, { sec: 60, phase: "easy" },
      { sec: 30, phase: "hard" }, { sec: 60, phase: "easy" },
      { sec: 30, phase: "hard" }, { sec: 60, phase: "easy" },
      { sec: 30, phase: "hard" }, { sec: 60, phase: "easy" },
      { sec: 30, phase: "hard" }, { sec: 60, phase: "easy" },
      { sec: 30, phase: "hard" }, { sec: 60, phase: "easy" },
    ],
    equip: ["Rower"],
    setup: "Strap your feet in, grip the handle.",
    cue: "6 rounds of 30s HARD then 60s EASY — but each is its own separate set, not one combined set. Tap a hard set's timer and push the pace; log your strokes when it ends. Tap the easy set right after it and just paddle — nothing to log, it's pure recovery. Repeat.",
    q: "rowing machine interval workout technique"
  },

  // ---- Bodyweight / household substitutes (Phase 1, before bands/dumbbells) ----
  chinup_prog: {
    name: "Chin-Up Progression (biceps)", cat: "pull", muscle: "biceps", load: "reps", target: { sets: 3, lo: 3, hi: 8 },
    equip: ["Pull-up bar"],
    setup: "Hang from the bar with an underhand grip (palms toward you), hands shoulder-width.",
    ladder: ["Dead hang (time)", "Scapular pull", "Negative chin (slow lower)", "Chair-assisted chin-up", "Full chin-up", "Weighted chin-up"],
    // Same rationale as pullup_prog's ladderCue/ladderSetup — grip is underhand throughout, and
    // rung 3 is chair-assisted (not band-assisted like pullup_prog's rung 3), so this can't share
    // the pull-up progression's arrays even though the ladders line up 1:1 in structure.
    ladderSetup: [
      "Hang from the bar with an underhand grip (palms toward you), arms fully extended, feet off the floor.",
      "Hang from the bar with an underhand grip, arms straight.",
      "Jump or step up so your chin is already over the bar, underhand grip.",
      "Stand on a sturdy chair or step under the bar, underhand grip.",
      "Hang from the bar with an underhand grip (palms toward you), hands shoulder-width, arms fully extended.",
      "Add weight with a dip belt, weighted vest, or a loaded backpack, then hang from the bar underhand.",
    ],
    ladderCue: [
      "Just hang — relax into it, brace the core so you don't swing. Timed hold, not reps: build grip and shoulder stability before adding any pulling.",
      "Without bending the elbows, pull the shoulder blades down and together, then relax back to a dead hang. Small movement, no elbow bend — this is the shoulder-blade set you'll need before the elbows ever bend.",
      "Start at the top (chin over the bar) and lower yourself as slowly as you can, 3–5+ seconds down. The lowering strength is what lets you pull yourself up in the first place.",
      "Use your legs to take some of the load on the way up. Push less with your legs each session as you get stronger, until the pull is arms-and-back alone.",
      "Underhand grip loads the biceps hard plus the back. Lead the chest to the bar, control the lower. Stop 1–2 reps short of failure.",
      "Same full chin-up technique, now loaded. Lead the chest to the bar, control the lower. Add weight in small jumps once you clear the top of your rep range.",
    ],
    cue: "Underhand grip (palms toward you) — loads the biceps hard plus the back. Lead the chest to the bar, control the lower. Your main biceps builder until you have load.",
    q: "chin up progression beginner"
  },
  diamond_pushup: {
    name: "Diamond Push-Up (triceps)", cat: "push", muscle: "triceps", load: "reps", target: { sets: 3, lo: 6, hi: 12 },
    equip: ["Floor"],
    setup: "Plank with the hands together under your chest, thumbs and index fingers forming a diamond.",
    ladder: ["Hands elevated", "Knee diamond", "Full diamond", "Feet elevated"],
    cue: "Hands together under the chest, elbows tracking back (not flared). Triceps focus — drop to hands-elevated if the shoulder complains.",
    q: "diamond push up exercise"
  },
  deep_pushup: {
    name: "Deep / Feet-Elevated Push-Up (chest)", cat: "push", muscle: "chest", load: "reps", target: { sets: 3, lo: 8, hi: 12 },
    equip: ["Floor", "Chair"],
    setup: "Feet up on a chair/bed for the upper chest, or hands on two books for a deeper pec stretch.",
    cue: "Feet up on a chair/bed to bias the UPPER chest (your lagging area), or hands on books for a deeper pec stretch. Control the bottom. The bodyweight chest-fly stand-in.",
    q: "feet elevated decline push up upper chest"
  },
  backpack_curl: {
    name: "Backpack Curl", cat: "pull", muscle: "biceps", load: "weight", target: { sets: 3, lo: 10, hi: 15 },
    equip: ["Backpack"],
    setup: "Load a backpack with books or water jugs; hold it by the base or top handle, elbows pinned.",
    cue: "Load a backpack with books or water jugs. Curl with elbows pinned, squeeze the top, slow lower. Add books to progress.",
    q: "backpack biceps curl no weights"
  },
  sl_rdl: {
    name: "Single-Leg RDL", cat: "legs", muscle: "legs", load: "reps", target: { sets: 3, lo: 8, hi: 12 }, side: true,
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

/* Session generation — no fixed deck. Each session is assembled live from what's actually
 * due: which muscles haven't been trained recently (weighted by priority), today's readiness,
 * and pain flags. See generateSession() in app.js.
 *
 * MUSCLE_TARGETS: ideal days between sessions that train this muscle (lower = trained more
 * often). Reflects his stated priorities: chest/back/biceps are the gaps and get trained
 * most often; triceps/legs ride along and are deliberately less frequent.
 */
const MUSCLE_TARGETS = { back: 2.5, chest: 2.5, rear_delts: 3, side_delts: 3.5, biceps: 2.5, triceps: 3.5, legs: 3.5 };
const MUSCLE_DISPLAY = { back: "Back", chest: "Chest", rear_delts: "Rear Delts", side_delts: "Side Delts", biceps: "Biceps", triceps: "Triceps", legs: "Legs" };
// Which logged measurement is a real-world proxy for a muscle's actual growth, if any exists.
// Back and rear delts have no circumference measurement in the app, so they're never
// stall-boosted by this — there's nothing to measure them against.
const MUSCLE_MEASUREMENT = { chest: "chest", side_delts: "shoulders", biceps: "armAvg", legs: "thighAvg" };

/* Curated pool for the opening posture/scapula block — always 3 of these 4, rotated so it's
 * not the identical trio every time. Separate from PREHAB_ROUTINE/MOBILITY_ROUTINE (app.js),
 * which are the standalone off-day routines. */
const PREHAB_BLOCK_POOL = ["wall_slides", "scap_pushup", "thoracic_open", "prone_ytw"];

const PAIN_AREAS = ["Winged scapula / L shoulder blade", "L shoulder (old dislocation)", "Neck / upper back", "Lower back", "Other"];

/* Swap alternatives — same muscle, different angle/equipment/load.
 * Used by the one-tap swap (e.g., a movement aggravates the shoulder). */
const ALTS = {
  pullup_prog: ["chinup_prog", "door_row", "band_row"],
  trx_row: ["door_row", "band_row"],
  door_row: ["band_row", "trx_row"],
  band_row: ["door_row", "trx_row"],
  lateral_raise: ["band_upright_row", "prone_ytw"],
  band_upright_row: ["lateral_raise", "prone_ytw"],
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
  face_pull: ["band_pull_apart", "prone_ytw"],
  band_pull_apart: ["prone_ytw", "face_pull"],
  prone_ytw: ["face_pull", "band_pull_apart"],
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
  wall_slides: ["floor_slides", "scap_pushup"],
  floor_slides: ["scap_pushup", "wall_slides"],
  scap_pushup: ["floor_slides", "wall_slides"],
  thoracic_open: ["floor_slides", "wall_slides"],
  row_steady: ["row_intervals"],
  row_intervals: ["row_steady"],
};

/* One-tap "no bands yet" mode — maps band moves to bodyweight/household equivalents. */
const BW_SWAPS = {
  band_press: "deep_pushup",
  band_fly: "deep_pushup",
  band_pressdown: "diamond_pushup",
  band_pull_apart: "prone_ytw",
  // prone_row (the old "lie face-down, arms hanging" fallback) required an elevated edge
  // (bed/bench) to hang the arms with any real range of motion — on flat floor, or improvised
  // as a standing bent-over arm-swing with no load, it's not a real exercise, just gravity
  // acting on ~5-8% of bodyweight through a token range. prone_ytw is genuinely floor-only
  // (no elevation needed, sweeps the whole arm through Y/T/W) so it's the honest fallback here.
  face_pull: "prone_ytw",
  band_curl: "chinup_prog",
  hammer_curl: "backpack_curl",
  pallof: "bird_dog",
  rdl: "sl_rdl",
  band_row: "door_row",
  trx_row: "door_row",
};
