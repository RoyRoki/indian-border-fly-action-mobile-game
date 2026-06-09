# BORDERHAWK: Himalayan Skies

A vertical-scrolling air-action mobile game. You pilot an IAF Tejas along
India's entire border, **west to east — Sir Creek to Kibithu** — through 10
checkpoint sectors, holding the line against waves of hostile drones, strike
jets, and gunship helicopters. Every sector ends with a boss gunship; killing
it **secures the checkpoint and saves your progress** (localStorage), so you
always re-scramble from the last secured sector.

| # | Checkpoint | Region | Terrain |
|---|------------|--------|---------|
| 1 | Sir Creek | Gujarat | marshland |
| 2 | Longewala | Rajasthan | Thar desert |
| 3 | Attari–Wagah | Punjab | green fields |
| 4 | Akhnoor | Jammu | foothills |
| 5 | Kargil–Dras | Ladakh | snow |
| 6 | Siachen Glacier | Ladakh | ice |
| 7 | Pangong–Galwan | Ladakh | high desert |
| 8 | Nathu La | Sikkim | alpine |
| 9 | Tawang | Arunachal | alpine |
| 10 | Kibithu–Walong | Arunachal | forest |

Secure all ten and the campaign ends with **BORDER SECURED**.

The entire game engine (entities, waves, physics, collision, scoring,
particles) is written in **Rust** and compiled to **WebAssembly**
(`wasm32-unknown-unknown`, no wasm-bindgen — plain C-ABI exports and shared
linear memory). JavaScript is only a thin canvas renderer, input mapper, and
WebAudio synth.

## Build & run

```sh
./build.sh                          # cargo build → web/game.wasm (~48 KB)
python3 -m http.server 8080 -d web  # any static server works
# open http://localhost:8080  (on your phone: http://<your-mac-ip>:8080)
```

Headless engine test (no browser needed):

```sh
node test/smoke.mjs
```

## How to play

- **Touch**: drag anywhere — the jet flies toward your finger (offset above it).
- **Desktop**: move the mouse, or steer with WASD / arrow keys.
- The cannon auto-fires. Tap / Space to start and restart.

| Power-up | Effect |
|----------|--------|
| **W** (saffron) | Upgrades wing guns (up to triple-spread, 14 s) |
| **M** (red) | Homing Astra missile pods (12 s) |
| **S** (blue) | Energy shield that absorbs hits (8 s) |

Enemies: recon **drones** (weave, 100 pts) · **strike jets** (dive and fire
aimed shots, 250 pts) · **gunship helis** (hover and fire 3-round spreads,
400 pts) · **boss gunship** every 5th wave (radial + aimed barrages, 5000 pts).
Difficulty scales with the wave number. Hi-score persists in localStorage.

## Global leaderboard

After a run, enter your **call sign and city** once (saved locally) and your
score is submitted to a global leaderboard — open it with the 🏆 button on the
menu. Backed by a Vercel Function (`web/api/leaderboard.js`) + **Vercel Blob**:
each score is a zero-content blob whose pathname encodes
`score.sector.name.city.timestamp` (names/cities base64url-encoded, full
Unicode support), so reads are a single `list()` call and concurrent writes
can never race. Top 50, deduped to each pilot's best score.

## Architecture

```
src/lib.rs      Rust engine. Exports: init(seed), frame(dt, x, y, pressed) -> n,
                draw_ptr(), hud_ptr(). Each frame writes n draw commands
                (stride-6 f32: kind, x, y, rot, scale, aux) plus a 16-float HUD
                block (mode, score, lives, wave, scroll, boss hp, timers,
                sound-event queue) into static buffers in linear memory.
web/game.js     Reads those buffers, draws procedural sprites on a letterboxed
                480×800 canvas, plays synthesized SFX, sends pointer/keys back.
web/index.html  Mobile-ready shell (viewport, touch-action none).
test/smoke.mjs  Drives the WASM engine headlessly and asserts gameplay
                progression (waves advance, score increases, boss killable).
```
