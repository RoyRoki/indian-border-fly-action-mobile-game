// Headless smoke test: drive the WASM engine like the browser would.
import { readFile } from 'node:fs/promises';

const buf = await readFile(new URL('../web/game.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(buf, {});
const w = instance.exports;

const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

for (const name of ['init', 'frame', 'draw_ptr', 'hud_ptr', 'memory'])
  if (!(name in w)) fail(`missing export ${name}`);

w.init(42);
const hud = () => new Float32Array(w.memory.buffer, w.hud_ptr(), 16);
const dt = 1 / 60;

// menu idles
let n = w.frame(dt, 240, 600, 0);
if (hud()[0] !== 0) fail('expected menu mode 0');

// tap to start
w.frame(dt, 240, 600, 1);
if (hud()[0] !== 1) fail('tap did not start game, mode=' + hud()[0]);

// play 60 simulated seconds chasing the middle; count draw cmds sanity
let maxCmds = 0, sawEnemyDraw = false, sawEvents = 0;
const draw = () => new Float32Array(w.memory.buffer, w.draw_ptr(), 420 * 6);
for (let i = 0; i < 3600; i++) {
  const t = i * dt;
  const x = 240 + Math.sin(t * 1.7) * 180;
  const y = 620 + Math.cos(t * 1.1) * 100;
  n = w.frame(dt, x, y, 0);
  if (n > 420) fail('draw overflow ' + n);
  maxCmds = Math.max(maxCmds, n);
  sawEvents += hud()[10];
  const d = draw();
  for (let c = 0; c < n; c++) {
    const k = d[c * 6];
    if (k >= 3 && k <= 6) sawEnemyDraw = true;
    const [px, py] = [d[c * 6 + 1], d[c * 6 + 2]];
    if (!Number.isFinite(px) || !Number.isFinite(py)) fail(`NaN coords cmd kind ${k}`);
  }
}
const h = hud();
console.log(`after 60s: mode=${h[0]} score=${h[1]} lives=${h[2]} wave=${h[3]} maxCmds=${maxCmds} events=${sawEvents}`);
if (!sawEnemyDraw) fail('no enemies ever drawn');
if (h[1] <= 0) fail('score never increased (collisions broken?)');
if (h[3] < 2 && h[0] === 1) fail('wave never advanced');
if (sawEvents <= 0) fail('no sound events emitted');

// if we died, tap should restart after delay
if (h[0] === 2) {
  for (let i = 0; i < 70; i++) w.frame(dt, 240, 600, 0);
  w.frame(dt, 240, 600, 1);
  if (hud()[0] !== 1) fail('restart from game over failed');
  console.log('game-over restart: OK');
}
console.log('SMOKE TEST PASSED');
