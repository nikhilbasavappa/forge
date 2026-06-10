# Forge

Home strength, posture, and recomposition tracker. A no-build PWA — open it on a
phone and "Add to Home Screen."

## Use
- **Today** — the next session in a rotating A/B/C deck, with cues, targets, and demo links.
- **Check-in** — energy, sleep, and pain. Adjusts the day's targets (shoulder flag reduces pressing; low energy drops a set).
- **Progress** — bodyweight, energy, top-set reps, and tape measurements.
- **More** — export a weekly summary, back up data, edit profile.

All data is stored locally on the device (localStorage). Use **More → Download backup** periodically.

## Stack
Plain HTML/CSS/JS. No framework, no build step, no server. Native fonts, works offline via a service worker.

## Run locally
```
python3 -m http.server 4173
```
Then open http://localhost:4173.
