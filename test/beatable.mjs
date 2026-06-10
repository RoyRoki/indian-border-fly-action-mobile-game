// Beatability probe: a dodging, powerup-collecting bot plays the final sector.
// If this bot can secure Kibithu, a decent human can finish the campaign.
import { readFile } from 'node:fs/promises';

const buf = await readFile(process.env.WASM ?? new URL('../web/game.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(buf, {});
const w = instance.exports;
const W = 480, H = 800, dt = 1 / 60;
w.init(+(process.env.SEED ?? 29));
const hud = () => new Float32Array(w.memory.buffer, w.hud_ptr(), 24);
const drawAt = (n) => new Float32Array(w.memory.buffer, w.draw_ptr(), n * 6);

const startSector = +(process.argv[2] ?? 9);
const night = process.argv[3] === 'night'; // probe the Vajra Nights campaign
if (w.set_campaign) w.set_campaign(night ? 1 : 0);
w.set_checkpoint(startSector);
if (w.start_game) { w.start_game(); w.frame(dt, 240, 600, 0); }
else { w.frame(dt, 240, 600, 0); w.frame(dt, 240, 600, 1); } // pre-start_game engines tap-start

let tx = 240, ty = 640;
let victory = false, deaths = 0, maxWave = 0, metBoss = false, minBossHp = Infinity;
const LIMIT = 60 * 60 * 25; // 25 sim-minutes

for (let i = 0; i < LIMIT && !victory; i++) {
  const n = w.frame(dt, tx, ty, 0);
  const h = hud();
  if (h[0] === 3) { victory = true; break; }
  if (h[0] === 2) {
    deaths++;
    for (let j = 0; j < 70; j++) w.frame(dt, 240, 600, 0);
    w.frame(dt, 240, 600, 1);
    tx = 240; ty = 640;
    continue;
  }
  // night hunters fire homing missiles (kind 3 shots are drawn rotated but
  // still kind 7 draws) — the column model handles them like aimed shots
  maxWave = Math.max(maxWave, h[3]);
  if (h[6] > 0) { metBoss = true; minBossHp = Math.min(minBossHp, h[5]); }

  const d = drawAt(n);
  let px = tx, py = ty; // approx: player tracks target closely
  const shots = [], enemies = [], pows = [];
  for (let c = 0; c < n; c++) {
    const k = d[c * 6], x = d[c * 6 + 1], y = d[c * 6 + 2];
    if (k === 0) { px = x; py = y; }
    else if (k === 7) shots.push([x, y]);
    else if (k >= 3 && k <= 6) enemies.push([x, y, k]);
    else if (k === 8) pows.push([x, y]);
  }

  // pick safest x: penalize columns near shots/enemies, reward enemy alignment & powerups
  let bestX = px, bestScore = -Infinity;
  for (let cx = 30; cx <= W - 30; cx += 15) {
    let s = -Math.abs(cx - px) * 0.15; // prefer small moves
    for (const [sx, sy] of shots) {
      const dy = py - sy;
      if (dy > -40 && dy < 300) s -= 3200 / (Math.abs(sx - cx) + 18) / (Math.abs(dy) * 0.02 + 1);
    }
    for (const [ex, ey, ek] of enemies) {
      const dy = py - ey;
      if (ek === 6) { s += 600 / (Math.abs(ex - cx) + 30); continue; } // boss: stay on its column
      if (dy > -60 && dy < 260) s -= 2600 / (Math.abs(ex - cx) + 24); // don't sit under close enemies
      if (dy >= 260) s += 130 / (Math.abs(ex - cx) + 30);             // line up on far ones
    }
    for (const [gx, gy] of pows) if (gy > 200) s += 800 / (Math.abs(gx - cx) + 40);
    if (s > bestScore) { bestScore = s; bestX = cx; }
  }
  tx = bestX;
  // y: chase powerups when close, otherwise hold a deep lane and back off from near shots
  let wantY = 660;
  for (const [gx, gy] of pows) if (Math.abs(gx - px) < 60 && gy > 350) wantY = Math.min(740, gy);
  for (const [sx, sy] of shots) if (Math.abs(sx - px) < 30 && Math.abs(sy - py) < 90) wantY = 740;
  ty = wantY;
}

const h = hud();
console.log(`${night ? 'NIGHT ' : ''}sector ${startSector}: victory=${victory} deaths=${deaths} maxWave=${maxWave} metBoss=${metBoss} minBossHp=${minBossHp === Infinity ? '-' : minBossHp.toFixed(0)} endSector=${h[16]}`);
process.exit(victory || (startSector < 9 && h[16] > startSector) ? 0 : 1);
