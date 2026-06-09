// BORDERHAWK: Himalayan Skies — JS glue: canvas renderer, input, audio.
// All game logic lives in Rust/WASM; this file just draws what the engine says.

const W = 480, H = 800;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// ---------- wasm ----------
async function loadWasm() {
  try {
    return await WebAssembly.instantiateStreaming(fetch('game.wasm'), {});
  } catch {
    // server sent a non-wasm MIME type; fall back to ArrayBuffer
    const bytes = await (await fetch('game.wasm')).arrayBuffer();
    return WebAssembly.instantiate(bytes, {});
  }
}
const { instance } = await loadWasm();
const wasm = instance.exports;
wasm.init((Math.random() * 0xffffffff) >>> 0);
const mem = () => new Float32Array(wasm.memory.buffer);
const DRAW_PTR = wasm.draw_ptr() / 4;
const HUD_PTR = wasm.hud_ptr() / 4;

// ---------- layout ----------
let scale = 1, ox = 0, oy = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  scale = Math.min(innerWidth / W, innerHeight / H);
  ox = (innerWidth - W * scale) / 2;
  oy = (innerHeight - H * scale) / 2;
  canvas._dpr = dpr;
}
addEventListener('resize', resize);
resize();

// ---------- input ----------
// ?autostart=1 skips the menu (handy for testing/screenshots)
const autostart = new URLSearchParams(location.search).has('autostart');
let pointer = { x: W / 2, y: H - 140, down: autostart };
if (autostart) setTimeout(() => { pointer.down = false; }, 300);
const keys = {};
function toGame(e) {
  return { x: (e.clientX - ox) / scale, y: (e.clientY - oy) / scale };
}
canvas.addEventListener('pointerdown', e => {
  const p = toGame(e);
  pointer.x = p.x; pointer.y = p.y - 90; pointer.down = true;
  unlockAudio();
  e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  if (!pointer.down && e.pointerType !== 'mouse') return;
  const p = toGame(e);
  pointer.x = p.x;
  pointer.y = p.y - (e.pointerType === 'mouse' ? 0 : 90);
});
addEventListener('pointerup', () => { pointer.down = false; });
addEventListener('pointercancel', () => { pointer.down = false; });
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space' || e.code === 'Enter') unlockAudio(); });
addEventListener('keyup', e => { keys[e.code] = false; });

// ---------- audio (tiny synth) ----------
let ac = null;
function unlockAudio() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
}
function tone(freq, dur, type = 'square', vol = 0.04, slide = 0) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination);
  o.start(); o.stop(ac.currentTime + dur);
}
function noise(dur, vol = 0.12, low = 800) {
  if (!ac) return;
  const n = ac.sampleRate * dur, buf = ac.createBuffer(1, n, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low;
  const g = ac.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
}
const SFX = {
  1: () => tone(880, 0.05, 'square', 0.018, -440),          // shoot
  2: () => noise(0.25, 0.10, 1200),                          // boom
  3: () => { noise(0.6, 0.18, 700); tone(70, 0.5, 'sawtooth', 0.06, -40); }, // big boom
  4: () => { tone(523, 0.08, 'square', 0.05); setTimeout(() => tone(659, 0.08, 'square', 0.05), 70); setTimeout(() => tone(784, 0.12, 'square', 0.05), 140); }, // powerup
  5: () => { noise(0.35, 0.14, 900); tone(200, 0.3, 'sawtooth', 0.07, -150); }, // player hit
  6: () => { tone(98, 0.7, 'sawtooth', 0.08, -20); setTimeout(() => tone(98, 0.7, 'sawtooth', 0.08, -20), 500); }, // boss warning
  7: () => tone(320, 0.18, 'sawtooth', 0.03, 300),           // missile
};

// ---------- procedural sprites ----------
function sprite(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.translate(w / 2, h / 2);
  fn(g);
  return c;
}

const sprPlayer = sprite(72, 72, g => {
  // IAF Tejas-style delta, nose up
  g.fillStyle = '#9fb4c8';
  g.beginPath();
  g.moveTo(0, -30); g.lineTo(7, -8); g.lineTo(26, 16); g.lineTo(26, 22); g.lineTo(7, 16);
  g.lineTo(5, 26); g.lineTo(-5, 26); g.lineTo(-7, 16); g.lineTo(-26, 22); g.lineTo(-26, 16);
  g.lineTo(-7, -8); g.closePath(); g.fill();
  g.fillStyle = '#7d93a8';
  g.fillRect(-3, -2, 6, 24);
  // canopy
  g.fillStyle = '#1d3a5f';
  g.beginPath(); g.ellipse(0, -10, 4, 9, 0, 0, Math.PI * 2); g.fill();
  // tricolor roundel on wings
  for (const sx of [-16, 16]) {
    g.fillStyle = '#ff9933'; g.beginPath(); g.arc(sx, 14, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(sx, 14, 3.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#138808'; g.beginPath(); g.arc(sx, 14, 1.6, 0, Math.PI * 2); g.fill();
  }
  // wing edges
  g.strokeStyle = '#cfdce8'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -30); g.lineTo(26, 16); g.moveTo(0, -30); g.lineTo(-26, 16); g.stroke();
});

const sprDrone = sprite(44, 44, g => {
  g.fillStyle = '#4a4f57';
  g.fillRect(-13, -3, 26, 6); g.fillRect(-3, -13, 6, 26);
  g.fillStyle = '#2d3138';
  for (const [x, y] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) {
    g.beginPath(); g.arc(x * 0.85, y * 0.85, 7, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#c23b3b'; g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd9d9'; g.beginPath(); g.arc(0, 0, 2, 0, Math.PI * 2); g.fill();
});

const sprJet = sprite(52, 56, g => {
  // hostile jet, nose down
  g.fillStyle = '#5d6670';
  g.beginPath();
  g.moveTo(0, 26); g.lineTo(6, 8); g.lineTo(22, -8); g.lineTo(22, -14); g.lineTo(6, -8);
  g.lineTo(4, -22); g.lineTo(-4, -22); g.lineTo(-6, -8); g.lineTo(-22, -14); g.lineTo(-22, -8);
  g.lineTo(-6, 8); g.closePath(); g.fill();
  g.fillStyle = '#444b53'; g.fillRect(-3, -20, 6, 30);
  g.fillStyle = '#8c2f2f';
  g.beginPath(); g.arc(-14, -9, 3.4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(14, -9, 3.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#11161c';
  g.beginPath(); g.ellipse(0, 8, 3.4, 7, 0, 0, Math.PI * 2); g.fill();
});

const sprHeliBody = sprite(64, 60, g => {
  g.fillStyle = '#56604f';
  g.beginPath(); g.ellipse(0, 2, 14, 20, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(-4, -28, 8, 18);
  g.fillStyle = '#3e463a';
  g.fillRect(-22, 4, 44, 5);
  g.fillStyle = '#20262e';
  g.beginPath(); g.ellipse(0, 12, 7, 8, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8c2f2f';
  g.beginPath(); g.arc(0, -24, 4, 0, Math.PI * 2); g.fill();
});

const sprBoss = sprite(150, 120, g => {
  g.fillStyle = '#454d44';
  g.beginPath(); g.ellipse(0, 0, 34, 46, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#39403a';
  g.fillRect(-66, -8, 132, 14);
  g.fillStyle = '#2b3129';
  g.beginPath(); g.ellipse(-52, -1, 9, 16, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(52, -1, 9, 16, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#161b21';
  g.beginPath(); g.ellipse(0, 18, 13, 15, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#741f1f';
  g.beginPath(); g.arc(-20, -28, 6, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(20, -28, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5d6650';
  g.fillRect(-10, -52, 20, 24);
});

const sprBullet = sprite(10, 22, g => {
  const grd = g.createLinearGradient(0, -10, 0, 10);
  grd.addColorStop(0, '#fff7c0'); grd.addColorStop(1, '#ffb02e');
  g.fillStyle = grd;
  g.beginPath(); g.ellipse(0, 0, 3, 9, 0, 0, Math.PI * 2); g.fill();
});

const sprMissile = sprite(14, 30, g => {
  g.fillStyle = '#dde4ea';
  g.beginPath(); g.moveTo(0, -13); g.lineTo(4, -5); g.lineTo(4, 9); g.lineTo(-4, 9); g.lineTo(-4, -5); g.closePath(); g.fill();
  g.fillStyle = '#c23b3b'; g.fillRect(-4, 5, 8, 4);
  g.fillStyle = '#ffae3d';
  g.beginPath(); g.moveTo(-3, 9); g.lineTo(3, 9); g.lineTo(0, 14); g.closePath(); g.fill();
});

const sprShot = sprite(14, 14, g => {
  const grd = g.createRadialGradient(0, 0, 1, 0, 0, 6);
  grd.addColorStop(0, '#ffe9e9'); grd.addColorStop(0.5, '#ff5f4f'); grd.addColorStop(1, 'rgba(255,60,40,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
});

const POW_COLORS = ['#ff9933', '#e84d4d', '#3da5ff'];
const POW_LETTERS = ['W', 'M', 'S'];
const sprPows = [0, 1, 2].map(k => sprite(40, 40, g => {
  g.fillStyle = POW_COLORS[k];
  g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.fill();
  g.fillStyle = POW_COLORS[k];
  g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(POW_LETTERS[k], 0, 1);
}));

// ---------- terrain (seamless-ish scrolling tiles) ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTerrain(seed) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  // snowfield base
  g.fillStyle = '#dfe7ee'; g.fillRect(0, 0, W, H);
  // subtle snow texture patches
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(${200 + r() * 30 | 0},${214 + r() * 25 | 0},${226 + r() * 20 | 0},0.5)`;
    g.beginPath(); g.ellipse(r() * W, r() * H, 18 + r() * 60, 8 + r() * 30, r() * 3, 0, Math.PI * 2); g.fill();
  }
  // rocky ridges with snow caps (kept away from tile edges so the seam hides)
  for (let i = 0; i < 9; i++) {
    const cx = r() * W, cy = 60 + r() * (H - 120), len = 70 + r() * 130, ang = r() * Math.PI;
    g.save(); g.translate(cx, cy); g.rotate(ang);
    g.fillStyle = '#a8b6bf';
    g.beginPath();
    g.moveTo(-len / 2, 12);
    for (let x = -len / 2; x <= len / 2; x += 14) g.lineTo(x, -6 - r() * 22);
    g.lineTo(len / 2, 12); g.closePath(); g.fill();
    g.fillStyle = '#f4f8fb';
    g.beginPath();
    g.moveTo(-len / 2, -2);
    for (let x = -len / 2; x <= len / 2; x += 14) g.lineTo(x, -10 - r() * 16);
    g.lineTo(len / 2, -2); g.closePath(); g.fill();
    g.restore();
  }
  // pine clusters
  for (let i = 0; i < 26; i++) {
    const cx = r() * W, cy = 40 + r() * (H - 80);
    for (let j = 0; j < 5; j++) {
      const x = cx + (r() - 0.5) * 50, y = cy + (r() - 0.5) * 40, s = 5 + r() * 6;
      g.fillStyle = '#3c5a44';
      g.beginPath(); g.moveTo(x, y - s * 1.6); g.lineTo(x + s, y + s); g.lineTo(x - s, y + s); g.closePath(); g.fill();
      g.fillStyle = 'rgba(244,248,251,0.7)';
      g.beginPath(); g.moveTo(x, y - s * 1.6); g.lineTo(x + s * 0.5, y - s * 0.3); g.lineTo(x - s * 0.5, y - s * 0.3); g.closePath(); g.fill();
    }
  }
  // winding border road / fence line
  g.strokeStyle = 'rgba(120,90,60,0.55)';
  g.lineWidth = 7; g.setLineDash([18, 12]);
  g.beginPath();
  let bx = 80 + r() * (W - 160);
  g.moveTo(bx, 70);
  for (let y = 70; y <= H - 70; y += 80) {
    bx = Math.max(50, Math.min(W - 50, bx + (r() - 0.5) * 160));
    g.lineTo(bx, y);
  }
  g.stroke(); g.setLineDash([]);
  // frozen lake
  const lx = 60 + r() * (W - 120), ly = 100 + r() * (H - 200);
  g.fillStyle = '#a9cfdd';
  g.beginPath(); g.ellipse(lx, ly, 30 + r() * 40, 20 + r() * 25, r(), 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.beginPath(); g.ellipse(lx - 8, ly - 6, 14, 8, 0.4, 0, Math.PI * 2); g.fill();
  return c;
}

function makeClouds(seed) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  for (let i = 0; i < 10; i++) {
    const cx = r() * W, cy = 50 + r() * (H - 100);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (let j = 0; j < 6; j++) {
      g.beginPath();
      g.ellipse(cx + (r() - 0.5) * 120, cy + (r() - 0.5) * 40, 30 + r() * 50, 16 + r() * 22, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

const terrains = [makeTerrain(101), makeTerrain(202)];
const clouds = makeClouds(303);

// ---------- HUD helpers ----------
const hiKey = 'borderhawk_hiscore';
let hiscore = +(localStorage.getItem(hiKey) || 0);
let lastWave = 0, waveFlash = 0, lastMode = -1;

function drawScrollLayer(img2, scrollPx, alpha = 1) {
  const off = ((scrollPx % H) + H) % H;
  ctx.globalAlpha = alpha;
  if (Array.isArray(img2)) {
    // alternate two tiles so adjacent bands differ
    const idx = Math.floor(((scrollPx) / H) % 2 + 2) % 2;
    ctx.drawImage(img2[idx], 0, off - H);
    ctx.drawImage(img2[1 - idx], 0, off);
  } else {
    ctx.drawImage(img2, 0, off - H);
    ctx.drawImage(img2, 0, off);
  }
  ctx.globalAlpha = 1;
}

function text(str, x, y, size, color, align = 'center', weight = 'bold') {
  ctx.font = `${weight} ${size}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(10,16,24,0.65)';
  ctx.fillText(str, x + Math.max(1, size / 16), y + Math.max(1, size / 16));
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function tricolorBar(x, y, w, h) {
  ctx.fillStyle = '#ff9933'; ctx.fillRect(x, y, w / 3, h);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x + w / 3, y, w / 3, h);
  ctx.fillStyle = '#138808'; ctx.fillRect(x + 2 * w / 3, y, w / 3, h);
}

// ---------- particle colors ----------
const TRI = ['#ff9933', '#f2f2f2', '#138808'];

// ---------- main loop ----------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;

  // keyboard steering
  const spd = 460 * dt;
  if (keys.ArrowLeft || keys.KeyA) pointer.x -= spd;
  if (keys.ArrowRight || keys.KeyD) pointer.x += spd;
  if (keys.ArrowUp || keys.KeyW) pointer.y -= spd;
  if (keys.ArrowDown || keys.KeyS) pointer.y += spd;
  pointer.x = Math.max(0, Math.min(W, pointer.x));
  pointer.y = Math.max(0, Math.min(H, pointer.y));
  const pressed = pointer.down || keys.Space || keys.Enter ? 1 : 0;

  const nCmds = wasm.frame(dt, pointer.x, pointer.y, pressed);
  const f = mem();
  const hud = f.subarray(HUD_PTR, HUD_PTR + 16);
  const cmds = f.subarray(DRAW_PTR, DRAW_PTR + nCmds * 6);
  const [mode, score, lives, wave, scroll, bossHp, bossMax, weapon, shieldT, missileT] = hud;

  // sound events
  const evn = hud[10];
  for (let i = 0; i < evn; i++) { const fn = SFX[hud[11 + i]]; if (fn) fn(); }

  // hi-score
  if (score > hiscore) { hiscore = score; localStorage.setItem(hiKey, String(hiscore)); }
  if (mode === 1 && wave !== lastWave) { lastWave = wave; waveFlash = 2.0; }
  if (mode !== 1) lastWave = 0;
  if (waveFlash > 0) waveFlash -= dt;
  lastMode = mode;

  // ---- render ----
  const dpr = canvas._dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#06090f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

  drawScrollLayer(terrains, scroll);
  drawScrollLayer(clouds, scroll * 1.7, 0.9);

  // draw commands
  for (let i = 0; i < nCmds; i++) {
    const o = i * 6;
    const kind = cmds[o], x = cmds[o + 1], y = cmds[o + 2], rot = cmds[o + 3], sc = cmds[o + 4], aux = cmds[o + 5];
    ctx.save();
    ctx.translate(x, y);
    switch (kind) {
      case 0: // player
        if (aux > 0.5) ctx.globalAlpha = 0.35;
        ctx.rotate(rot);
        ctx.drawImage(sprPlayer, -36, -36);
        break;
      case 1:
        ctx.rotate(rot);
        ctx.drawImage(sprBullet, -5, -11);
        break;
      case 2:
        ctx.rotate(rot);
        ctx.drawImage(sprMissile, -7, -15);
        break;
      case 3: // drone, rot = prop spin
        ctx.drawImage(sprDrone, -22, -22);
        ctx.strokeStyle = 'rgba(40,40,40,0.6)'; ctx.lineWidth = 2;
        for (const [px, py] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
          ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
          ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke();
          ctx.restore();
        }
        break;
      case 4:
        ctx.rotate(rot);
        ctx.drawImage(sprJet, -26, -28);
        break;
      case 5: // heli, aux = time for rotor
        ctx.drawImage(sprHeliBody, -32, -30);
        ctx.save(); ctx.rotate(aux * 18);
        ctx.strokeStyle = 'rgba(25,28,24,0.75)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(30, 0);
        ctx.moveTo(0, -30); ctx.lineTo(0, 30); ctx.stroke();
        ctx.restore();
        break;
      case 6: // boss, aux = time for rotors
        ctx.drawImage(sprBoss, -75, -60);
        for (const rx of [-52, 52]) {
          ctx.save(); ctx.translate(rx, -1); ctx.rotate(aux * 16);
          ctx.strokeStyle = 'rgba(20,22,20,0.7)'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(34, 0);
          ctx.moveTo(0, -34); ctx.lineTo(0, 34); ctx.stroke();
          ctx.restore();
        }
        break;
      case 7:
        ctx.drawImage(sprShot, -7, -7);
        break;
      case 8:
        ctx.translate(0, Math.sin(now / 200 + x) * 3);
        ctx.drawImage(sprPows[aux | 0], -20, -20);
        break;
      case 9: { // particle: sc = alpha, aux = kind + subcolor*0.25
        const pk = Math.floor(aux);
        ctx.globalAlpha = sc;
        if (pk === 0) { // fire
          ctx.fillStyle = sc > 0.5 ? '#ffd23e' : '#ff7a2e';
          ctx.beginPath(); ctx.arc(0, 0, 3 + (1 - sc) * 7, 0, Math.PI * 2); ctx.fill();
        } else if (pk === 1) { // smoke
          ctx.fillStyle = '#6a6f76';
          ctx.beginPath(); ctx.arc(0, 0, 4 + (1 - sc) * 9, 0, Math.PI * 2); ctx.fill();
        } else if (pk === 2) { // spark
          ctx.fillStyle = '#fff3b0';
          ctx.fillRect(-1.5, -1.5, 3, 3);
        } else if (pk === 3) { // tricolor trail
          ctx.fillStyle = TRI[Math.round((aux - 3) * 4) % 3];
          ctx.beginPath(); ctx.arc(0, 0, 2.5 * sc + 0.5, 0, Math.PI * 2); ctx.fill();
        } else { // snow fleck
          ctx.globalAlpha = sc * 0.8;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 10: // shield ring, aux = time left
        ctx.rotate(rot);
        ctx.globalAlpha = aux < 2 ? 0.25 + 0.25 * Math.sin(now / 60) : 0.5;
        ctx.strokeStyle = '#54c8ff'; ctx.lineWidth = 3;
        ctx.setLineDash([14, 8]);
        ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        break;
    }
    ctx.restore();
  }

  // ---- HUD ----
  if (mode === 1 || mode === 2) {
    text(String(score).padStart(6, '0'), 12, 26, 24, '#ffffff', 'left');
    text('HI ' + String(hiscore).padStart(6, '0'), W - 12, 22, 14, '#dce6f0', 'right');
    text('WAVE ' + wave, W - 12, 44, 14, '#dce6f0', 'right');
    for (let i = 0; i < lives; i++) {
      ctx.save();
      ctx.translate(24 + i * 26, 56);
      ctx.scale(0.42, 0.42);
      ctx.drawImage(sprPlayer, -36, -36);
      ctx.restore();
    }
    // power-up status pips
    let py = 84;
    if (weapon > 1) { text('W' + weapon, 18, py, 13, '#ff9933', 'left'); py += 18; }
    if (missileT > 0) { text('M ' + Math.ceil(missileT), 18, py, 13, '#e84d4d', 'left'); py += 18; }
    if (shieldT > 0) { text('S ' + Math.ceil(shieldT), 18, py, 13, '#3da5ff', 'left'); }
    if (bossMax > 0) {
      const bw = W - 120;
      ctx.fillStyle = 'rgba(10,14,20,0.6)';
      ctx.fillRect(60, 70, bw, 12);
      ctx.fillStyle = '#d4382e';
      ctx.fillRect(62, 72, (bw - 4) * Math.max(0, bossHp / bossMax), 8);
      text('BOSS', W / 2, 64, 12, '#ffd9d9');
    }
    if (waveFlash > 0 && mode === 1) {
      ctx.globalAlpha = Math.min(1, waveFlash);
      text(wave % 5 === 0 ? '⚠ BOSS INBOUND ⚠' : 'WAVE ' + wave, W / 2, H * 0.38, 34, wave % 5 === 0 ? '#ff5f4f' : '#ffffff');
      ctx.globalAlpha = 1;
    }
  }

  if (mode === 0) {
    ctx.fillStyle = 'rgba(6,10,16,0.45)';
    ctx.fillRect(0, 0, W, H);
    tricolorBar(W / 2 - 110, H * 0.30 - 58, 220, 6);
    text('BORDERHAWK', W / 2, H * 0.30, 52, '#ffffff');
    text('HIMALAYAN SKIES', W / 2, H * 0.30 + 38, 19, '#ff9933');
    text('Defend the northern frontier.', W / 2, H * 0.46, 16, '#c8d4e0');
    text('Drag to fly · cannon auto-fires', W / 2, H * 0.46 + 26, 16, '#c8d4e0');
    text('W = wing guns · M = Astra missiles · S = shield', W / 2, H * 0.46 + 52, 14, '#9fb0c2');
    if (Math.floor(now / 600) % 2) text('TAP TO SCRAMBLE', W / 2, H * 0.68, 24, '#ffd23e');
    if (hiscore > 0) text('HI-SCORE ' + hiscore, W / 2, H * 0.78, 16, '#dce6f0');
  } else if (mode === 2) {
    ctx.fillStyle = 'rgba(6,10,16,0.55)';
    ctx.fillRect(0, 0, W, H);
    text('MISSION FAILED', W / 2, H * 0.36, 40, '#ff5f4f');
    text('SCORE ' + score, W / 2, H * 0.36 + 46, 24, '#ffffff');
    if (score >= hiscore && score > 0) text('★ NEW HI-SCORE ★', W / 2, H * 0.36 + 78, 18, '#ffd23e');
    if (Math.floor(now / 600) % 2) text('TAP TO RE-SCRAMBLE', W / 2, H * 0.62, 22, '#ffd23e');
  }

  ctx.restore();
}
requestAnimationFrame(loop);
