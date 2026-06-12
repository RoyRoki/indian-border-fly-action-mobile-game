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

// ---------- campaign 0: India's border, west → east (day) ----------
const SECTORS = [
  { name: 'SIR CREEK',       region: 'Gujarat',   biome: 'marsh' },
  { name: 'LONGEWALA',       region: 'Rajasthan', biome: 'desert' },
  { name: 'ATTARI–WAGAH',    region: 'Punjab',    biome: 'plains' },
  { name: 'AKHNOOR',         region: 'Jammu',     biome: 'foothills' },
  { name: 'KARGIL–DRAS',     region: 'Ladakh',    biome: 'snow' },
  { name: 'SIACHEN GLACIER', region: 'Ladakh',    biome: 'ice' },
  { name: 'PANGONG–GALWAN',  region: 'Ladakh',    biome: 'highdesert' },
  { name: 'NATHU LA',        region: 'Sikkim',    biome: 'alpine' },
  { name: 'TAWANG',          region: 'Arunachal', biome: 'alpine' },
  { name: 'KIBITHU–WALONG',  region: 'Arunachal', biome: 'forest' },
];

// ---------- campaign 1: VAJRA NIGHTS — Operation First Light ----------
// Ten night ops (borders 11–20) flown from 22:00 to sunrise, ending at
// Walong, where India's sun rises first. `phase` 0 = midnight → 1 = morning;
// `time` is the mission clock shown on the HUD.
const NIGHT_SECTORS = [
  { name: 'GHOST CREEK',       region: 'Gujarat',   biome: 'marsh',      phase: 0.00, time: '22:00' },
  { name: 'THAR MIDNIGHT',     region: 'Rajasthan', biome: 'desert',     phase: 0.00, time: '23:30' },
  { name: 'AMRITSAR BLACKOUT', region: 'Punjab',    biome: 'plains',     phase: 0.00, time: '00:45' },
  { name: 'CHENAB SHADOW',     region: 'Jammu',     biome: 'foothills',  phase: 0.02, time: '01:45' },
  { name: 'ZOJI LA GHOSTPASS', region: 'Ladakh',    biome: 'snow',       phase: 0.05, time: '02:45' },
  { name: 'KARAKORAM VEIL',    region: 'Ladakh',    biome: 'ice',        phase: 0.10, time: '03:30' },
  { name: 'CHUSHUL STARFALL',  region: 'Ladakh',    biome: 'highdesert', phase: 0.22, time: '04:15' },
  { name: 'DOKLAM DAWNWATCH',  region: 'Sikkim',    biome: 'alpine',     phase: 0.45, time: '05:00' },
  { name: 'SELA FIRSTLIGHT',   region: 'Arunachal', biome: 'alpine',     phase: 0.72, time: '05:40' },
  { name: 'WALONG SUNRISE',    region: 'Arunachal', biome: 'forest',     phase: 1.00, time: '06:15' },
];

// Each campaign keeps its own checkpoint — finishing 1–10 does NOT roll into
// 11–20; Vajra Nights is its own run with its own starting point.
const cpKeys = ['borderhawk_checkpoint', 'borderhawk_checkpoint_night'];
let savedCp = cpKeys.map(k => Math.min(+(localStorage.getItem(k) || 0), SECTORS.length - 1));
let campaign = 0;
const params = new URLSearchParams(location.search);
// ?night=1 forces the night campaign (testing/screenshots — skips the lock)
const forceNight = params.get('night') !== null;
if (forceNight) campaign = 1;
wasm.set_campaign(campaign);
// ?cp=N forces a starting sector (testing/screenshots)
const cpOverride = params.get('cp');
if (cpOverride !== null) savedCp[campaign] = Math.min(Math.max(+cpOverride || 0, 0), SECTORS.length - 1);
wasm.set_checkpoint(savedCp[campaign]);
// ?boss=N jumps straight to a sector's boss fight (testing/screenshots)
const bossOverride = params.get('boss');
if (bossOverride !== null) wasm.jump_to_boss(Math.min(Math.max(+bossOverride || 0, 0), SECTORS.length - 1));
// ?ff=N fast-forwards N engine frames before rendering (testing/screenshots)
const ff = +(params.get('ff') || 0);
for (let i = 0; i < ff; i++) wasm.frame(1 / 60, W / 2, H - 140, 0);
const secArr = () => (campaign === 1 ? NIGHT_SECTORS : SECTORS);
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
  oy = 0;
  canvas._dpr = dpr;
}
addEventListener('resize', resize);
resize();

// ---------- input ----------
// ?autostart=1 skips the menu (handy for testing/screenshots)
const autostart = params.has('autostart');
let pointer = { x: W / 2, y: H - 140, down: false };
if (autostart) wasm.start_game();
const keys = {};
function toGame(e) {
  return { x: (e.clientX - ox) / scale, y: (e.clientY - oy) / scale };
}
canvas.addEventListener('pointerdown', e => {
  const p = toGame(e);
  unlockAudio();
  e.preventDefault();
  // the menu is a mission-select screen — taps pick a card, not the plane
  if (lastMode === 0) { menuTap(p, e.timeStamp); return; }
  pointer.x = p.x; pointer.y = p.y - 90; pointer.down = true;
});
canvas.addEventListener('pointermove', e => {
  if (!pointer.down && e.pointerType !== 'mouse') return;
  const p = toGame(e);
  pointer.x = p.x;
  pointer.y = p.y - (e.pointerType === 'mouse' ? 0 : 90);
});
addEventListener('pointerup', () => { pointer.down = false; });
addEventListener('pointercancel', () => { pointer.down = false; });
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return; // typing in forms
  keys[e.code] = true;
  if (e.code === 'Space' || e.code === 'Enter') unlockAudio();
  // keyboard mission select: Enter/Space = day campaign, N = night ops
  if (lastMode === 0 && !uiOpen()) {
    if (e.code === 'Space' || e.code === 'Enter') startCampaign(0);
    else if (e.code === 'KeyN') {
      if (nightUnlocked()) startCampaign(1);
      else lockedT = 2.2;
    }
  }
});
addEventListener('keyup', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  keys[e.code] = false;
});

// ---------- leaderboard & pilot profile ----------
const profKey = 'borderhawk_profile';
// campaign completions → gold stars (max 5); old saves had only a completed flag
const winsKey = 'borderhawk_wins';
let wins = Math.min(5, +(localStorage.getItem(winsKey) || 0) || (localStorage.getItem('borderhawk_completed') ? 1 : 0));
// Vajra Nights completions → diamonds (max 5)
const diaKey = 'borderhawk_diamonds';
let diamonds = Math.min(5, +(localStorage.getItem(diaKey) || 0));
// the night campaign is for 5-star pilots only
const nightUnlocked = () => wins >= 5 || forceNight;

// ---------- mission select (menu) ----------
const CARD_DAY = { x: 36, y: 252, w: W - 72, h: 104 };
const CARD_NIGHT = { x: 36, y: 376, w: W - 72, h: 104 };
let lockedT = 0; // "5-star pilots only" flash when tapping the locked card
const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
function startCampaign(c) {
  campaign = c;
  wasm.set_campaign(c);
  wasm.set_checkpoint(savedCp[c]);
  wasm.start_game();
  submitState = '';
}
function menuTap(p) {
  // "↺ RESTART" links (bottom-right strip of each card) clear that
  // campaign's checkpoint without launching
  const dayRestart = { x: CARD_DAY.x + CARD_DAY.w - 130, y: CARD_DAY.y + CARD_DAY.h - 34, w: 126, h: 30 };
  const nightRestart = { x: CARD_NIGHT.x + CARD_NIGHT.w - 130, y: CARD_NIGHT.y + CARD_NIGHT.h - 34, w: 126, h: 30 };
  if (savedCp[0] > 0 && inRect(p, dayRestart)) {
    savedCp[0] = 0;
    localStorage.setItem(cpKeys[0], '0');
    return;
  }
  if (nightUnlocked() && savedCp[1] > 0 && inRect(p, nightRestart)) {
    savedCp[1] = 0;
    localStorage.setItem(cpKeys[1], '0');
    return;
  }
  if (inRect(p, CARD_DAY)) { startCampaign(0); return; }
  if (inRect(p, CARD_NIGHT)) {
    if (nightUnlocked()) startCampaign(1);
    else {
      lockedT = 2.2;
      tone(150, 0.3, 'sawtooth', 0.08, -70); // denied buzz
    }
  }
}
let profile = null;
try { profile = JSON.parse(localStorage.getItem(profKey) || 'null'); } catch { /* corrupt */ }
let pendingScore = null; // {score, sector} awaiting profile entry
let submitState = '';    // '', 'sending', 'ok', 'fail'
const $ = (id) => document.getElementById(id);
const profileOverlay = $('profileOverlay'), lbOverlay = $('lbOverlay'), lbbtn = $('lbbtn');
const uiOpen = () => profileOverlay.classList.contains('open') || lbOverlay.classList.contains('open');
const esc = (x) => String(x).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

async function postScore(s) {
  submitState = 'sending';
  try {
    const r = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // night sectors post as 11–20 so the board shows how deep the op went
      body: JSON.stringify({
        name: profile.name,
        city: profile.city,
        score: s.score,
        sector: s.sector + (s.night ? 10 : 0),
        wins,
        dia: diamonds,
      }),
    });
    submitState = r.ok ? 'ok' : 'fail';
  } catch { submitState = 'fail'; }
}
function maybeSubmit(score, sector) {
  if (score <= 0) return;
  pendingScore = { score, sector, night: campaign === 1 };
  if (profile?.name) postScore(pendingScore);
  else {
    $('pname').value = profile?.name || '';
    $('pcity').value = profile?.city || '';
    profileOverlay.classList.add('open');
    setTimeout(() => $('pname').focus(), 50);
  }
}
$('psave').onclick = () => {
  const name = $('pname').value.trim().slice(0, 14);
  if (!name) { $('pname').focus(); return; }
  profile = { name, city: $('pcity').value.trim().slice(0, 14) };
  localStorage.setItem(profKey, JSON.stringify(profile));
  profileOverlay.classList.remove('open');
  if (pendingScore) postScore(pendingScore);
};
$('pskip').onclick = () => {
  profileOverlay.classList.remove('open');
  pendingScore = null;
  submitState = '';
};
lbbtn.onclick = async () => {
  lbOverlay.classList.add('open');
  $('lbstatus').textContent = 'loading…';
  $('lbrows').innerHTML = '';
  $('lbpilotcount').textContent = '';
  try {
    const qs = profile?.name
      ? `?name=${encodeURIComponent(profile.name)}&city=${encodeURIComponent(profile.city || '')}`
      : '';
    const r = await fetch('/api/leaderboard' + qs);
    const { top, myRank, myEntry, totalPilots } = await r.json();
    if (!top?.length) { $('lbstatus').textContent = 'No scores yet — be the first!'; return; }
    $('lbstatus').textContent = '';
    if (totalPilots) $('lbpilotcount').textContent = totalPilots;
    const medals = ['🥇', '🥈', '🥉'];
    const makeRow = (t, rank) => {
      const me = myRank === rank;
      const dia = t.dia > 0
        ? ` <span class="dia" title="Vajra Nights victories ×${Math.min(t.dia, 5)}">${'💎'.repeat(Math.min(t.dia, 5))}</span>`
        : '';
      const stars = t.wins > 0 && !t.dia
        ? ` <span class="stars" title="secured the whole border ×${Math.min(t.wins, 5)}">${'★'.repeat(Math.min(t.wins, 5))}</span>`
        : '';
      return `<div class="row${me ? ' me' : ''}">
        <span class="rank">${medals[rank - 1] || rank}</span>
        <span class="who">${esc(t.name)}${stars}${dia} <small>· ${esc(t.city)} · S${(t.sector | 0) + 1}</small></span>
        <span class="pts">${t.score}</span></div>`;
    };
    const shown = top.map((t, i) => makeRow(t, i + 1)).join('');
    const myRow = myRank > 10 && myEntry
      ? `<div class="row-divider">· · ·</div>` + makeRow(myEntry, myRank)
      : '';
    $('lbrows').innerHTML = shown + myRow;
  } catch { $('lbstatus').textContent = 'Could not load leaderboard.'; }
};
$('lbclose').onclick = () => lbOverlay.classList.remove('open');
lbOverlay.addEventListener('click', e => { if (e.target === lbOverlay) lbOverlay.classList.remove('open'); });

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
  8: () => { // secret weapon klaxon
    for (const d of [0, 220, 440]) setTimeout(() => tone(180, 0.3, 'sawtooth', 0.1, -90), d);
    noise(0.5, 0.1, 500);
  },
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

// AMCA "RUDRA" — 5th-gen stealth fighter, flown only in Vajra Nights
const sprPlayerNight = sprite(72, 72, g => {
  g.fillStyle = '#343c4a';
  g.beginPath();
  g.moveTo(0, -32); g.lineTo(6, -12); g.lineTo(28, 10); g.lineTo(28, 16); g.lineTo(8, 12);
  g.lineTo(10, 24); g.lineTo(4, 28); g.lineTo(-4, 28); g.lineTo(-10, 24); g.lineTo(-8, 12);
  g.lineTo(-28, 16); g.lineTo(-28, 10); g.lineTo(-6, -12); g.closePath(); g.fill();
  g.fillStyle = '#272e3a';
  g.fillRect(-3, -6, 6, 26);
  // canted twin tails
  g.fillStyle = '#2c3442';
  g.beginPath(); g.moveTo(8, 14); g.lineTo(14, 26); g.lineTo(6, 24); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-8, 14); g.lineTo(-14, 26); g.lineTo(-6, 24); g.closePath(); g.fill();
  // glowing canopy
  const cgrd = g.createLinearGradient(0, -20, 0, -4);
  cgrd.addColorStop(0, '#9ff1ff'); cgrd.addColorStop(1, '#1d5f7a');
  g.fillStyle = cgrd;
  g.beginPath(); g.ellipse(0, -12, 3.6, 8, 0, 0, Math.PI * 2); g.fill();
  // cyan leading-edge glow
  g.strokeStyle = 'rgba(90,220,255,0.85)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(0, -32); g.lineTo(28, 10); g.moveTo(0, -32); g.lineTo(-28, 10); g.stroke();
  // engine glow
  g.fillStyle = 'rgba(120,210,255,0.9)';
  for (const sx of [-4.5, 4.5]) { g.beginPath(); g.ellipse(sx, 27, 2.6, 4, 0, 0, Math.PI * 2); g.fill(); }
  // low-visibility roundels
  g.strokeStyle = 'rgba(160,180,200,0.8)'; g.lineWidth = 1.2;
  for (const sx of [-17, 17]) {
    g.beginPath(); g.arc(sx, 11, 4, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(sx, 11, 1.6, 0, Math.PI * 2); g.stroke();
  }
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

// ---------- Vajra Nights hostiles ----------
// phantom drone — black flying wing, nose toward the player, red eye
const sprPhantom = sprite(48, 44, g => {
  g.fillStyle = '#1c2026';
  g.beginPath();
  g.moveTo(0, 16); g.lineTo(22, -6); g.lineTo(14, -13); g.lineTo(0, -5);
  g.lineTo(-14, -13); g.lineTo(-22, -6); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,70,70,0.55)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(-22, -6); g.lineTo(0, 16); g.lineTo(22, -6); g.stroke();
  g.fillStyle = '#ff4040';
  g.beginPath(); g.arc(0, 3, 3.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd9d9';
  g.beginPath(); g.arc(0, 3, 1.2, 0, Math.PI * 2); g.fill();
});

// night hunter — heavy black gunship with weapon pods and an amber visor
const sprHunter = sprite(76, 64, g => {
  g.fillStyle = '#181c22'; g.fillRect(-30, 2, 60, 6); // stub wings
  g.fillStyle = '#23282f';
  g.beginPath(); g.ellipse(0, 2, 16, 24, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(-4, -31, 8, 18); // tail boom
  g.fillStyle = '#11141a';
  for (const sx of [-26, 26]) g.fillRect(sx - 4, 3, 8, 13); // weapon pods
  g.fillStyle = '#ff7a2e';
  g.beginPath(); g.ellipse(0, 14, 8, 7, 0, 0, Math.PI * 2); g.fill(); // visor
  g.fillStyle = '#ffd9a0';
  g.beginPath(); g.ellipse(0, 14, 3.4, 3, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8c2f2f';
  g.beginPath(); g.arc(0, -28, 3.4, 0, Math.PI * 2); g.fill();
});

// ---------- the ten sector bosses ----------
// One unique machine per sector; some hide a secret weapon that fires
// when their hull drops below 35% (the engine flags it via the draw rot).
const BOSSES = [
  { name: 'MARSH STALKER' },
  { name: 'DESERT FORTRESS', secret: 'SANDSTORM BARRAGE' },
  { name: 'WAGAH ACE' },
  { name: 'AKHNOOR WARLORD' },
  { name: 'RIDGE ARTILLERY', secret: 'AVALANCHE SHELLS' },
  { name: 'WHITE PHANTOM' },
  { name: 'LAKE SENTINEL', secret: 'TWIN WHIRLWIND' },
  { name: 'RAZOR WING' },
  { name: 'STORM BRINGER', secret: 'LIGHTNING STORM' },
  { name: 'DRAGON COMMAND', secret: 'DRAGON FURY' },
];

const sprBosses = [
  // 0 MARSH STALKER — Sir Creek hover gunboat
  sprite(150, 120, g => {
    g.fillStyle = '#3a4a43';
    g.beginPath(); g.ellipse(0, 22, 52, 15, 0, 0, Math.PI * 2); g.fill(); // skirt
    g.fillStyle = '#5f7268';
    g.beginPath(); g.ellipse(0, -2, 40, 26, 0, 0, Math.PI * 2); g.fill(); // hull
    g.fillStyle = '#4c5c54'; g.fillRect(-40, -6, 80, 10);
    for (const sx of [-46, 46]) { // side fan pods
      g.fillStyle = '#2f3b36'; g.beginPath(); g.arc(sx, 2, 16, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1d2522'; g.beginPath(); g.arc(sx, 2, 11, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#9fd4c8';
    g.beginPath(); g.ellipse(0, -16, 7, 5, 0, 0, Math.PI * 2); g.fill(); // cockpit
    g.fillStyle = '#28312c'; g.fillRect(-4, 18, 8, 16); // bow gun
    g.fillStyle = '#c23b3b';
    for (const sx of [-30, 30]) { g.beginPath(); g.arc(sx, -16, 3, 0, Math.PI * 2); g.fill(); }
  }),
  // 1 DESERT FORTRESS — Longewala flying slab
  sprite(150, 120, g => {
    g.fillStyle = '#c9b078';
    g.beginPath();
    g.moveTo(-66, 0); g.lineTo(-44, -32); g.lineTo(44, -32); g.lineTo(66, 0);
    g.lineTo(44, 32); g.lineTo(-44, 32); g.closePath(); g.fill();
    g.fillStyle = '#a8925e';
    g.beginPath();
    g.moveTo(-48, 0); g.lineTo(-32, -22); g.lineTo(32, -22); g.lineTo(48, 0);
    g.lineTo(32, 22); g.lineTo(-32, 22); g.closePath(); g.fill();
    for (const sx of [-34, 34]) { // turrets, barrels toward the player
      g.fillStyle = '#8a774c'; g.fillRect(sx - 9, 10, 18, 14);
      g.fillStyle = '#5e5134'; g.fillRect(sx - 3, 22, 6, 16);
    }
    g.fillStyle = '#332f24'; g.fillRect(-18, -28, 36, 7); // cockpit slit
    g.fillStyle = '#8c2f2f'; // insignia
    g.beginPath(); g.moveTo(0, -10); g.lineTo(9, 0); g.lineTo(0, 10); g.lineTo(-9, 0); g.closePath(); g.fill();
  }),
  // 2 WAGAH ACE — twin-tail superiority jet, nose toward the player
  sprite(150, 120, g => {
    g.fillStyle = '#3c4654';
    g.beginPath();
    g.moveTo(0, 46); g.lineTo(10, 14); g.lineTo(58, -16); g.lineTo(58, -26); g.lineTo(11, -12);
    g.lineTo(8, -40); g.lineTo(-8, -40); g.lineTo(-11, -12); g.lineTo(-58, -26); g.lineTo(-58, -16);
    g.lineTo(-10, 14); g.closePath(); g.fill();
    g.fillStyle = '#2c343f'; g.fillRect(-5, -36, 10, 56); // spine
    for (const sx of [-16, 16]) { // twin tails
      g.fillStyle = '#4a5566';
      g.beginPath(); g.moveTo(sx, -22); g.lineTo(sx + 7, -46); g.lineTo(sx - 7, -42); g.closePath(); g.fill();
    }
    g.fillStyle = '#ffb02e'; g.fillRect(-58, -24, 24, 4); g.fillRect(34, -24, 24, 4); // gold trim
    g.fillStyle = '#0f1822';
    g.beginPath(); g.ellipse(0, 18, 5, 11, 0, 0, Math.PI * 2); g.fill(); // canopy
    g.fillStyle = '#8c2f2f';
    for (const sx of [-40, 40]) { g.beginPath(); g.arc(sx, -16, 4, 0, Math.PI * 2); g.fill(); }
  }),
  // 3 AKHNOOR WARLORD — the classic twin-rotor gunship
  sprite(150, 120, g => {
    g.fillStyle = '#454d44';
    g.beginPath(); g.ellipse(0, 0, 34, 46, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#39403a'; g.fillRect(-66, -8, 132, 14);
    g.fillStyle = '#2b3129';
    g.beginPath(); g.ellipse(-52, -1, 9, 16, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(52, -1, 9, 16, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#161b21';
    g.beginPath(); g.ellipse(0, 18, 13, 15, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#741f1f';
    g.beginPath(); g.arc(-20, -28, 6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(20, -28, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5d6650'; g.fillRect(-10, -52, 20, 24);
  }),
  // 4 RIDGE ARTILLERY — snow-camo gun platform with one huge cannon
  sprite(150, 120, g => {
    g.fillStyle = '#cfd6da';
    g.beginPath(); g.ellipse(0, -6, 48, 28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#aab6bd';
    g.beginPath(); g.ellipse(-18, -12, 16, 9, 0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(22, 0, 13, 8, -0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6a747a'; g.fillRect(-7, 10, 14, 40); // the cannon
    g.fillStyle = '#4d565b'; g.fillRect(-10, 42, 20, 8); // muzzle
    g.fillStyle = '#8b969c'; g.fillRect(-60, -10, 18, 10); g.fillRect(42, -10, 18, 10); // rotor arms
    g.fillStyle = '#2e3338';
    g.beginPath(); g.ellipse(0, -16, 9, 6, 0, 0, Math.PI * 2); g.fill(); // visor
    g.fillStyle = '#c23b3b';
    for (const sx of [-36, 36]) { g.beginPath(); g.arc(sx, -20, 3, 0, Math.PI * 2); g.fill(); }
  }),
  // 5 WHITE PHANTOM — pale crescent wing, glows and ghosts
  sprite(150, 120, g => {
    g.fillStyle = '#dfe9f2';
    g.beginPath();
    g.moveTo(0, 30);
    g.quadraticCurveTo(50, 26, 64, -18); g.quadraticCurveTo(30, -2, 0, -2);
    g.quadraticCurveTo(-30, -2, -64, -18); g.quadraticCurveTo(-50, 26, 0, 30);
    g.closePath(); g.fill();
    g.strokeStyle = '#9fc4dd'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-64, -18); g.quadraticCurveTo(-30, 4, 0, 4); g.quadraticCurveTo(30, 4, 64, -18); g.stroke();
    const grd = g.createRadialGradient(0, 10, 1, 0, 10, 14);
    grd.addColorStop(0, '#bdf0ff'); grd.addColorStop(1, 'rgba(120,200,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 10, 14, 0, Math.PI * 2); g.fill(); // core glow
    g.fillStyle = '#54c8ff';
    g.beginPath(); g.arc(0, 10, 4, 0, Math.PI * 2); g.fill();
  }),
  // 6 LAKE SENTINEL — bronze quad-rotor with a single great eye
  sprite(150, 120, g => {
    g.strokeStyle = '#7a5c38'; g.lineWidth = 10;
    g.beginPath(); g.moveTo(-44, -28); g.lineTo(44, 28); g.moveTo(44, -28); g.lineTo(-44, 28); g.stroke();
    for (const [sx, sy] of [[-44, -28], [44, -28], [-44, 28], [44, 28]]) {
      g.fillStyle = '#4e3c26'; g.beginPath(); g.arc(sx, sy, 12, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#9c7a4a'; g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.fill(); // hub
    g.strokeStyle = '#5e4628'; g.lineWidth = 4;
    g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#2b211a'; g.beginPath(); g.arc(0, 2, 13, 0, Math.PI * 2); g.fill(); // eye
    g.fillStyle = '#e84d4d'; g.beginPath(); g.arc(0, 2, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd9d9'; g.beginPath(); g.arc(-2, 0, 2.4, 0, Math.PI * 2); g.fill();
  }),
  // 7 RAZOR WING — serrated stealth chevron
  sprite(150, 120, g => {
    g.fillStyle = '#41335c';
    g.beginPath();
    g.moveTo(0, 32); g.lineTo(66, -24); g.lineTo(48, -26); g.lineTo(33, -12); g.lineTo(20, -24);
    g.lineTo(8, -10); g.lineTo(0, -20); g.lineTo(-8, -10); g.lineTo(-20, -24); g.lineTo(-33, -12);
    g.lineTo(-48, -26); g.lineTo(-66, -24); g.closePath(); g.fill();
    g.strokeStyle = '#7a64a8'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-66, -24); g.lineTo(0, 32); g.lineTo(66, -24); g.stroke();
    g.fillStyle = '#15101f';
    g.beginPath(); g.moveTo(0, 18); g.lineTo(6, 4); g.lineTo(-6, 4); g.closePath(); g.fill(); // cockpit
    g.fillStyle = '#c23b3b';
    for (const sx of [-58, 58]) { g.beginPath(); g.arc(sx, -22, 3, 0, Math.PI * 2); g.fill(); }
  }),
  // 8 STORM BRINGER — gunmetal heavy heli with lightning livery
  sprite(150, 120, g => {
    g.fillStyle = '#3a4046'; g.fillRect(-56, -8, 112, 13); // stub wings
    g.fillStyle = '#4d545c';
    g.beginPath(); g.ellipse(0, 0, 20, 36, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#343a41'; g.fillRect(-4, -52, 8, 22); // tail boom
    g.fillStyle = '#161b21';
    g.beginPath(); g.ellipse(0, 16, 11, 12, 0, 0, Math.PI * 2); g.fill(); // nose sensor
    for (const sx of [-9, 9]) { g.fillStyle = '#23282d'; g.fillRect(sx - 3, 28, 6, 14); } // chin guns
    g.fillStyle = '#ffd23e'; // lightning bolt
    g.beginPath(); g.moveTo(-4, -26); g.lineTo(6, -12); g.lineTo(0, -10); g.lineTo(8, 4);
    g.lineTo(-6, -8); g.lineTo(0, -10); g.closePath(); g.fill();
    g.fillStyle = '#2b3129';
    g.beginPath(); g.ellipse(-50, -2, 8, 13, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(50, -2, 8, 13, 0, 0, Math.PI * 2); g.fill();
  }),
  // 9 DRAGON COMMAND — the crimson flagship at Kibithu
  sprite(150, 120, g => {
    g.fillStyle = '#3a1414'; g.fillRect(-70, -8, 140, 14); // pylons
    g.fillStyle = '#5a1f1f';
    g.beginPath(); g.ellipse(0, 0, 36, 50, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a1414';
    g.beginPath(); g.ellipse(0, -18, 26, 18, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7c2a2a'; // dragon snout
    g.beginPath(); g.moveTo(0, 56); g.lineTo(14, 34); g.lineTo(-14, 34); g.closePath(); g.fill();
    g.fillStyle = '#ffae3d'; // eyes
    for (const sx of [-8, 8]) { g.beginPath(); g.arc(sx, 36, 3.4, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#c98a3d'; g.lineWidth = 2; // gold trim
    g.beginPath(); g.ellipse(0, 0, 28, 42, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#2b1010';
    g.beginPath(); g.ellipse(-60, -1, 9, 15, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(60, -1, 9, 15, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1c0b0b';
    g.beginPath(); g.arc(0, 4, 11, 0, Math.PI * 2); g.fill(); // core housing
  }),
];

// ---------- Vajra Nights boss roster ----------
// Same ten airframes, rebuilt for night ops: darker hulls, faster patterns,
// 60% more hull (the engine handles the stats — these are the names).
const NIGHT_BOSSES = [
  { name: 'CREEK WRAITH' },
  { name: 'DUNE REAPER', secret: 'MIDNIGHT SIROCCO' },
  { name: 'BLACKOUT ACE' },
  { name: 'SHADOW WARLORD' },
  { name: 'GLACIER HOWITZER', secret: 'BLIZZARD RAIN' },
  { name: 'NIGHT PHANTOM' },
  { name: 'STAR SENTINEL', secret: 'METEOR WHIRL' },
  { name: 'DARK RAZOR' },
  { name: 'THUNDER GOD', secret: "HEAVEN'S WRATH" },
  { name: 'ECLIPSE COMMAND', secret: 'TOTAL ECLIPSE' },
];
const bossArr = () => (campaign === 1 ? NIGHT_BOSSES : BOSSES);

// cool-tint a sprite for night ops (keeps shape, darkens + blues the hull)
function nightify(src, tint = 'rgba(28,40,76,0.55)') {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = tint;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
const sprDroneN = nightify(sprDrone);
const sprJetN = nightify(sprJet);
const sprHeliBodyN = nightify(sprHeliBody);
const sprBossesNight = sprBosses.map(s => nightify(s, 'rgba(24,34,70,0.5)'));

// crescent moon / rising sun for the night-to-morning sky
const sprMoon = sprite(64, 64, g => {
  g.fillStyle = '#eef2da';
  g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(-9, -7, 19, 0, Math.PI * 2); g.fill();
});
const sprSun = sprite(120, 120, g => {
  const grd = g.createRadialGradient(0, 0, 4, 0, 0, 56);
  grd.addColorStop(0, 'rgba(255,236,170,0.95)');
  grd.addColorStop(0.35, 'rgba(255,180,80,0.55)');
  grd.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, 56, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff3d0';
  g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.fill();
});

// spinning rotor cross, used by several bosses
function rotor(x, y, len, ang, width = 4) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.strokeStyle = 'rgba(20,22,20,0.7)'; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0);
  ctx.moveTo(0, -len); ctx.lineTo(0, len); ctx.stroke();
  ctx.restore();
}

const sprBullet = sprite(10, 22, g => {
  const grd = g.createLinearGradient(0, -10, 0, 10);
  grd.addColorStop(0, '#fff7c0'); grd.addColorStop(1, '#ffb02e');
  g.fillStyle = grd;
  g.beginPath(); g.ellipse(0, 0, 3, 9, 0, 0, Math.PI * 2); g.fill();
});

// RUDRA plasma bolt — the night jet's cannon
const sprPlasma = sprite(12, 24, g => {
  const grd = g.createLinearGradient(0, -10, 0, 10);
  grd.addColorStop(0, '#e8feff'); grd.addColorStop(1, '#39b9ff');
  g.fillStyle = grd;
  g.beginPath(); g.ellipse(0, 0, 3, 9, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(120,225,255,0.6)'; g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(0, 0, 4.4, 10.5, 0, 0, Math.PI * 2); g.stroke();
});

// hunter homing missile (enemy shot kind 3) — drawn nose-up, rotated to velocity
const sprHoming = sprite(16, 32, g => {
  g.fillStyle = 'rgba(255,90,60,0.35)'; // exhaust glow
  g.beginPath(); g.ellipse(0, 11, 4, 6, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3a3f47';
  g.beginPath(); g.moveTo(0, -14); g.lineTo(4, -6); g.lineTo(4, 8); g.lineTo(-4, 8); g.lineTo(-4, -6); g.closePath(); g.fill();
  g.fillStyle = '#ff4040'; g.fillRect(-4, -2, 8, 4);
  g.fillStyle = '#ffae3d';
  g.beginPath(); g.moveTo(-3, 8); g.lineTo(3, 8); g.lineTo(0, 13); g.closePath(); g.fill();
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

// cluster shell (bursts into fragments mid-air)
const sprShell = sprite(26, 26, g => {
  g.strokeStyle = '#7a3fb0'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.stroke();
  const grd = g.createRadialGradient(0, 0, 1, 0, 0, 9);
  grd.addColorStop(0, '#fff3c8'); grd.addColorStop(0.6, '#ffb02e'); grd.addColorStop(1, 'rgba(255,140,30,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
});

// fortress bomb (falls straight down)
const sprBomb = sprite(14, 26, g => {
  g.fillStyle = '#ffae3d'; // tail flame
  g.beginPath(); g.moveTo(-3, -9); g.lineTo(3, -9); g.lineTo(0, -13); g.closePath(); g.fill();
  g.fillStyle = '#2e3338';
  g.beginPath(); g.moveTo(-4, -9); g.lineTo(4, -9); g.lineTo(4, 5); g.lineTo(0, 11); g.lineTo(-4, 5); g.closePath(); g.fill();
  g.fillStyle = '#4d565b'; g.fillRect(-6, -9, 12, 3); // fins
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

// per-biome palettes: [base, patchRGB, ridge, ridgeCap, vegStyle, vegColor, water, lakeCount]
const BIOMES = {
  marsh:      { base: '#cfd9c0', patch: [185, 198, 168], ridge: '#b3a98c', cap: '#e8e4d2', veg: 'shrub', vegc: '#5a7a52', water: '#8fbf9f', lakes: 4, snowVeg: false },
  desert:     { base: '#e3cf9e', patch: [212, 188, 138], ridge: '#c4a368', cap: '#f0e3bd', veg: 'shrub', vegc: '#6e7d4d', water: '#7fb6c9', lakes: 0, snowVeg: false },
  plains:     { base: '#b9d39a', patch: [165, 195, 130], ridge: '#9aa86f', cap: '#d6e8b8', veg: 'tree',  vegc: '#3f6b3a', water: '#7fb6c9', lakes: 1, snowVeg: false },
  foothills:  { base: '#c5cba6', patch: [178, 186, 145], ridge: '#9b8e72', cap: '#e9ecd8', veg: 'pine',  vegc: '#41603f', water: '#7fb6c9', lakes: 1, snowVeg: false },
  snow:       { base: '#dfe7ee', patch: [205, 219, 231], ridge: '#a8b6bf', cap: '#f4f8fb', veg: 'pine',  vegc: '#3c5a44', water: '#a9cfdd', lakes: 1, snowVeg: true },
  ice:        { base: '#e7eef5', patch: [212, 226, 238], ridge: '#9fb4c4', cap: '#ffffff', veg: 'none',  vegc: '#3c5a44', water: '#bcdde8', lakes: 2, snowVeg: true },
  highdesert: { base: '#d3c4a4', patch: [196, 181, 150], ridge: '#a08c6c', cap: '#efe8d8', veg: 'none',  vegc: '#6e7d4d', water: '#69b7d4', lakes: 2, snowVeg: false },
  alpine:     { base: '#d4dfd2', patch: [192, 209, 190], ridge: '#94a59b', cap: '#eef5ef', veg: 'pine',  vegc: '#33523c', water: '#8fc4d4', lakes: 1, snowVeg: true },
  forest:     { base: '#a9c690', patch: [142, 176, 116], ridge: '#7e9468', cap: '#cfe3bd', veg: 'pine',  vegc: '#2e4f33', water: '#7fb6c9', lakes: 1, snowVeg: false },
};

function makeTerrain(seed, biomeKey) {
  const B = BIOMES[biomeKey];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  g.fillStyle = B.base; g.fillRect(0, 0, W, H);
  // Torus wrap: every feature is drawn at y-H, y, y+H so content that
  // overflows one tile edge reappears at the other — no seam when scrolled.
  const wrap = (y, fn) => {
    for (const k of [-H, 0, H]) {
      g.save(); g.translate(0, y + k); fn(); g.restore();
    }
  };
  // texture patches
  const [pr, pg, pb] = B.patch;
  for (let i = 0; i < 90; i++) {
    const x = r() * W, y = r() * H, rx = 18 + r() * 60, ry = 8 + r() * 30, rot = r() * 3;
    const col = `rgba(${pr + r() * 28 | 0},${pg + r() * 24 | 0},${pb + r() * 20 | 0},0.5)`;
    wrap(y, () => {
      g.fillStyle = col;
      g.beginPath(); g.ellipse(x, 0, rx, ry, rot, 0, Math.PI * 2); g.fill();
    });
  }
  // ridges / dunes with highlight caps
  for (let i = 0; i < 9; i++) {
    const cx = r() * W, cy = r() * H, len = 70 + r() * 130, ang = r() * Math.PI;
    const prof = [], prof2 = [];
    for (let x = -len / 2; x <= len / 2; x += 14) { prof.push(-6 - r() * 22); prof2.push(-10 - r() * 16); }
    wrap(cy, () => {
      g.translate(cx, 0); g.rotate(ang);
      g.fillStyle = B.ridge;
      g.beginPath(); g.moveTo(-len / 2, 12);
      let k = 0;
      for (let x = -len / 2; x <= len / 2; x += 14) g.lineTo(x, prof[k++]);
      g.lineTo(len / 2, 12); g.closePath(); g.fill();
      g.fillStyle = B.cap;
      g.beginPath(); g.moveTo(-len / 2, -2);
      k = 0;
      for (let x = -len / 2; x <= len / 2; x += 14) g.lineTo(x, prof2[k++]);
      g.lineTo(len / 2, -2); g.closePath(); g.fill();
    });
  }
  // vegetation
  if (B.veg !== 'none') {
    for (let i = 0; i < 26; i++) {
      const cx = r() * W, cy = r() * H;
      for (let j = 0; j < 5; j++) {
        const x = cx + (r() - 0.5) * 50, y = cy + (r() - 0.5) * 40, s = 5 + r() * 6;
        wrap(y, () => {
          g.fillStyle = B.vegc;
          if (B.veg === 'pine') {
            g.beginPath(); g.moveTo(x, -s * 1.6); g.lineTo(x + s, s); g.lineTo(x - s, s); g.closePath(); g.fill();
            if (B.snowVeg) {
              g.fillStyle = 'rgba(244,248,251,0.7)';
              g.beginPath(); g.moveTo(x, -s * 1.6); g.lineTo(x + s * 0.5, -s * 0.3); g.lineTo(x - s * 0.5, -s * 0.3); g.closePath(); g.fill();
            }
          } else if (B.veg === 'tree') {
            g.beginPath(); g.arc(x, 0, s * 0.9, 0, Math.PI * 2); g.fill();
            g.fillStyle = 'rgba(255,255,255,0.18)';
            g.beginPath(); g.arc(x - s * 0.3, -s * 0.3, s * 0.4, 0, Math.PI * 2); g.fill();
          } else { // shrub
            g.beginPath(); g.arc(x, 0, s * 0.45, 0, Math.PI * 2); g.fill();
          }
        });
      }
    }
  }
  // winding border road — spans the full tile and ends on the x it started,
  // so the line continues unbroken across the tile join
  const pts = [];
  let bx = 80 + r() * (W - 160);
  const x0 = bx;
  for (let y = 0; y <= H; y += 80) {
    pts.push([bx, y]);
    bx = Math.max(50, Math.min(W - 50, bx + (r() - 0.5) * 160));
  }
  pts[pts.length - 1][0] = x0;
  g.strokeStyle = 'rgba(110,95,68,0.55)';
  g.lineWidth = 7; g.setLineDash([18, 12]);
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.stroke(); g.setLineDash([]);
  // lakes / water
  for (let i = 0; i < B.lakes; i++) {
    const lx = 60 + r() * (W - 120), ly = r() * H, rx = 30 + r() * 40, ry = 20 + r() * 25, rot = r();
    wrap(ly, () => {
      g.fillStyle = B.water;
      g.beginPath(); g.ellipse(lx, 0, rx, ry, rot, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath(); g.ellipse(lx - 8, -6, 14, 8, 0.4, 0, Math.PI * 2); g.fill();
    });
  }
  return c;
}

function makeClouds(seed) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  for (let i = 0; i < 10; i++) {
    const cx = r() * W, cy = r() * H;
    for (let j = 0; j < 6; j++) {
      const x = cx + (r() - 0.5) * 120, y = cy + (r() - 0.5) * 40;
      const rx = 30 + r() * 50, ry = 16 + r() * 22;
      for (const k of [-H, 0, H]) { // torus wrap, same as terrain
        g.beginPath(); g.ellipse(x, y + k, rx, ry, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }
  return c;
}

const tileCache = {};
function tileFor(biome) {
  if (!tileCache[biome]) {
    let h = 0;
    for (const ch of biome) h = (h * 31 + ch.charCodeAt(0)) | 0;
    tileCache[biome] = makeTerrain(101 + (h & 0xffff), biome);
  }
  return tileCache[biome];
}
const clouds = makeClouds(303);

// ---------- HUD helpers ----------
const hiKey = 'borderhawk_hiscore';
let hiscore = +(localStorage.getItem(hiKey) || 0);
let lastWave = 0, waveFlash = 0, lastMode = -1;
let secretFlash = 0, secretName = '';
// cinematic sector-title card (letterbox + name) when entering a new area
let lastSector = -1, cineT = 0;
const CINE_T = 3.4;
function cineSwell() {
  tone(146.83, 0.9, 'sine', 0.05);
  setTimeout(() => tone(220, 0.7, 'sine', 0.045), 160);
  setTimeout(() => tone(293.66, 1.0, 'sine', 0.05), 340);
}
let curBiome = null, prevBiome = null, biomeFade = 1;

// Composite the two tile copies at 1:1 into an offscreen buffer first, then
// blit the buffer once. Drawing the tiles straight onto the scaled context
// antialiases each tile's edge separately and leaves a hairline at the join;
// at 1:1 integer offsets the join is pixel-exact, and the single blit has no
// interior edge to filter.
const layerBuf = document.createElement('canvas');
layerBuf.width = W; layerBuf.height = H;
const lb = layerBuf.getContext('2d');
function drawScrollLayer(img, scrollPx, alpha = 1) {
  const off = Math.floor(((scrollPx % H) + H) % H);
  lb.clearRect(0, 0, W, H);
  lb.drawImage(img, 0, off - H);
  lb.drawImage(img, 0, off);
  ctx.globalAlpha = alpha;
  ctx.drawImage(layerBuf, 0, 0);
  ctx.globalAlpha = 1;
}

// rounded-rect path with a fallback for older canvases
function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
function panel(x, y, w, h, stroke = '#2d415f') {
  ctx.fillStyle = 'rgba(10,18,32,0.88)';
  rr(x, y, w, h, 16); ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
  rr(x, y, w, h, 16); ctx.stroke();
}

// Vajra Nights sky: multiply-tint the terrain from moonlit blue (phase 0)
// to warm morning light (phase 1), with an orange dawn band in between,
// plus the moon early on and the rising sun at the end.
function nightTint(ph, now) {
  const L = (a, b) => a + (b - a) * ph;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${L(62, 255) | 0},${L(78, 244) | 0},${L(138, 226) | 0})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  if (ph > 0.05 && ph < 0.95) {
    const a = 0.30 * Math.sin(Math.PI * ph);
    const gr = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    gr.addColorStop(0, `rgba(255,140,60,${a.toFixed(3)})`);
    gr.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H * 0.5);
  }
  if (ph < 0.35) {
    ctx.globalAlpha = 0.85 * (1 - ph / 0.35);
    ctx.drawImage(sprMoon, W - 96, 64 + Math.sin(now / 2600) * 3);
    ctx.globalAlpha = 1;
  } else if (ph > 0.55) {
    ctx.globalAlpha = Math.min(1, (ph - 0.55) / 0.3);
    ctx.drawImage(sprSun, W - 130, 40);
    ctx.globalAlpha = 1;
  }
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
  const pressed = !uiOpen() && (pointer.down || keys.Space || keys.Enter) ? 1 : 0;

  const nCmds = wasm.frame(dt, pointer.x, pointer.y, pressed);
  const f = mem();
  const hud = f.subarray(HUD_PTR, HUD_PTR + 24);
  const cmds = f.subarray(DRAW_PTR, DRAW_PTR + nCmds * 6);
  const [mode, score, lives, wave, scroll, bossHp, bossMax, weapon, shieldT, missileT] = hud;
  const sector = hud[16] | 0, clearT = hud[17];
  const SEC = secArr();
  const sec = SEC[Math.min(sector, SEC.length - 1)];
  const night = campaign === 1;

  // persist this campaign's checkpoint the moment a sector is secured
  if (mode === 1 && sector > savedCp[campaign]) {
    savedCp[campaign] = sector;
    localStorage.setItem(cpKeys[campaign], String(sector));
  }
  // campaign victory: bank the reward BEFORE submitting so the entry
  // carries it — day run earns a gold star, night op earns a diamond —
  // and the next run of that campaign starts fresh from its first sector
  if (mode === 3 && lastMode === 1) {
    if (night) {
      diamonds = Math.min(5, diamonds + 1);
      localStorage.setItem(diaKey, String(diamonds));
    } else {
      wins = Math.min(5, wins + 1);
      localStorage.setItem(winsKey, String(wins));
    }
    localStorage.setItem('borderhawk_completed', '1');
    savedCp[campaign] = 0;
    localStorage.setItem(cpKeys[campaign], '0');
    wasm.set_checkpoint(0);
  }
  if ((mode === 2 || mode === 3) && lastMode === 1) maybeSubmit(score, sector);
  if (mode === 1 && lastMode !== 1) submitState = '';
  lbbtn.style.display = mode !== 1 ? 'block' : 'none';

  // sound events
  const evn = hud[10];
  for (let i = 0; i < evn; i++) {
    const code = hud[11 + i];
    if (code === 8) { secretFlash = 3.0; secretName = bossArr()[sector].secret || ''; }
    const fn = SFX[code]; if (fn) fn();
  }

  // hi-score
  if (score > hiscore) { hiscore = score; localStorage.setItem(hiKey, String(hiscore)); }
  if (mode === 1 && wave >= 1 && wave !== lastWave) { lastWave = wave; waveFlash = 2.0; }
  if (mode !== 1) lastWave = 0;
  if (waveFlash > 0) waveFlash -= dt;
  if (secretFlash > 0) secretFlash -= dt;
  if (lockedT > 0) lockedT -= dt;
  // sector entry (run start or checkpoint secured) → roll the title card
  if (mode === 1) {
    if (sector !== lastSector) { lastSector = sector; cineT = CINE_T; cineSwell(); }
  } else { lastSector = -1; }
  if (cineT > 0) cineT -= dt;
  lastMode = mode;

  // ---- render ----
  const dpr = canvas._dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#06090f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

  // terrain with smooth biome crossfade (no teleporting when a sector falls)
  if (curBiome === null) curBiome = sec.biome;
  if (sec.biome !== curBiome) { prevBiome = curBiome; curBiome = sec.biome; biomeFade = 0; }
  if (biomeFade < 1 && prevBiome) {
    biomeFade = Math.min(1, biomeFade + dt / 2.2);
    const t = biomeFade * biomeFade * (3 - 2 * biomeFade); // smoothstep
    drawScrollLayer(tileFor(prevBiome), scroll);
    drawScrollLayer(tileFor(curBiome), scroll, t);
  } else {
    biomeFade = 1;
    drawScrollLayer(tileFor(curBiome), scroll);
  }
  drawScrollLayer(clouds, scroll * 1.7, 0.9);
  // Vajra Nights: moonlit terrain that brightens toward sunrise
  if (night && mode !== 0) nightTint(sec.phase ?? 0, now);

  // draw commands
  for (let i = 0; i < nCmds; i++) {
    const o = i * 6;
    const kind = cmds[o], x = cmds[o + 1], y = cmds[o + 2], rot = cmds[o + 3], sc = cmds[o + 4], aux = cmds[o + 5];
    ctx.save();
    ctx.translate(x, y);
    switch (kind) {
      case 0: // player — the RUDRA flies the night ops
        if (aux > 0.5) ctx.globalAlpha = 0.35;
        ctx.rotate(rot);
        ctx.drawImage(night ? sprPlayerNight : sprPlayer, -36, -36);
        break;
      case 1:
        ctx.rotate(rot);
        ctx.drawImage(night ? sprPlasma : sprBullet, -6, -12);
        break;
      case 2:
        ctx.rotate(rot);
        ctx.drawImage(sprMissile, -7, -15);
        break;
      case 3: // drone, rot = prop spin
        ctx.drawImage(night ? sprDroneN : sprDrone, -22, -22);
        ctx.strokeStyle = 'rgba(40,40,40,0.6)'; ctx.lineWidth = 2;
        for (const [px, py] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
          ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
          ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke();
          ctx.restore();
        }
        break;
      case 4:
        ctx.rotate(rot);
        ctx.drawImage(night ? sprJetN : sprJet, -26, -28);
        break;
      case 5: // heli, aux = time for rotor
        ctx.drawImage(night ? sprHeliBodyN : sprHeliBody, -32, -30);
        ctx.save(); ctx.rotate(aux * 18);
        ctx.strokeStyle = 'rgba(25,28,24,0.75)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(30, 0);
        ctx.moveTo(0, -30); ctx.lineTo(0, 30); ctx.stroke();
        ctx.restore();
        break;
      case 6: { // boss: rot = variant (+0.5 when its secret weapon is live), aux = time
        const v = Math.min(9, Math.floor(rot + 0.01));
        const secretLive = rot - v > 0.25;
        if (v === 9) ctx.scale(1.15, 1.15); // the flagship looms larger
        if (v === 5) { // phantom shimmers in and out
          ctx.globalAlpha = 0.6 + 0.3 * Math.sin(aux * 3);
          ctx.fillStyle = 'rgba(120,200,255,0.18)';
          ctx.beginPath(); ctx.arc(0, 0, 56, 0, Math.PI * 2); ctx.fill();
        }
        ctx.drawImage((night ? sprBossesNight : sprBosses)[v], -75, -60);
        switch (v) {
          case 0: for (const fx of [-46, 46]) rotor(fx, 2, 10, aux * 20, 3); break;
          case 1: // engine flicker
            ctx.globalAlpha = 0.5 + 0.4 * Math.sin(aux * 30);
            ctx.fillStyle = '#ff7a2e';
            for (const fx of [-20, 20]) { ctx.beginPath(); ctx.ellipse(fx, -34, 5, 8, 0, 0, Math.PI * 2); ctx.fill(); }
            ctx.globalAlpha = 1;
            break;
          case 2: { // afterburners (exhaust points away from the player)
            const fl = 10 + 6 * Math.sin(aux * 40);
            ctx.fillStyle = '#ffae3d';
            for (const fx of [-16, 16]) {
              ctx.beginPath(); ctx.moveTo(fx - 4, -40); ctx.lineTo(fx + 4, -40); ctx.lineTo(fx, -40 - fl); ctx.closePath(); ctx.fill();
            }
            break;
          }
          case 3: for (const rx of [-52, 52]) rotor(rx, -1, 34, aux * 16); break;
          case 4: for (const rx of [-58, 58]) rotor(rx, -5, 16, aux * 22, 3); break;
          case 6: for (const [rx, ry] of [[-44, -28], [44, -28], [-44, 28], [44, 28]]) rotor(rx, ry, 15, aux * 24, 3); break;
          case 7: // wingtip strobes
            if (Math.sin(aux * 8) > 0) {
              ctx.fillStyle = '#ff5f4f';
              for (const fx of [-62, 62]) { ctx.beginPath(); ctx.arc(fx, -22, 4, 0, Math.PI * 2); ctx.fill(); }
            }
            break;
          case 8: for (const rx of [-50, 50]) rotor(rx, -2, 30, aux * 18); break;
          case 9: { // rotors + pulsing dragon core
            for (const rx of [-60, 60]) rotor(rx, -1, 28, aux * 15);
            ctx.fillStyle = '#ff7a2e';
            ctx.beginPath(); ctx.arc(0, 4, 7 + 2.5 * Math.sin(aux * 6), 0, Math.PI * 2); ctx.fill();
            break;
          }
        }
        if (secretLive) { // secret weapon active: angry pulsing ring
          ctx.globalAlpha = 0.25 + 0.18 * Math.sin(now / 70);
          ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, 70, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 7: // enemy shot, aux = kind, rot = heading
        if (aux === 1) { // cluster shell pulses as the fuse burns
          const p = 1 + 0.15 * Math.sin(now / 70);
          ctx.scale(p, p);
          ctx.drawImage(sprShell, -13, -13);
        } else if (aux === 2) {
          ctx.drawImage(sprBomb, -7, -13);
        } else if (aux === 3) { // hunter homing missile tracks its heading
          ctx.rotate(rot);
          ctx.drawImage(sprHoming, -8, -16);
        } else {
          ctx.drawImage(sprShot, -7, -7);
        }
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
      case 11: // phantom drone, aux = time — shimmers like a heat ghost
        ctx.globalAlpha = 0.72 + 0.26 * Math.sin(aux * 5);
        ctx.drawImage(sprPhantom, -24, -22);
        ctx.globalAlpha = 1;
        if (Math.sin(aux * 9) > 0.3) { // red eye strobe
          ctx.fillStyle = 'rgba(255,64,64,0.8)';
          ctx.beginPath(); ctx.arc(0, 3, 5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 12: // night hunter, aux = time for rotors
        ctx.drawImage(sprHunter, -38, -32);
        rotor(0, -2, 34, aux * 17);
        rotor(0, -29, 9, aux * 26, 2);
        break;
    }
    ctx.restore();
  }

  // ---- HUD ----
  if (mode === 1 || mode === 2) {
    text(String(score).padStart(6, '0'), 12, 26, 24, '#ffffff', 'left');
    text('HI ' + String(hiscore).padStart(6, '0'), W - 12, 22, 14, '#dce6f0', 'right');
    text('WAVE ' + Math.max(1, wave) + '/5', W - 12, 44, 14, '#dce6f0', 'right');
    if (night) {
      // night ops defend borders 11–20, flown against the mission clock
      text(`NIGHT OP ${sector + 1}/10 · ${sec.name}`, W / 2, 24, 13, '#cfe6ff');
      text(`${sec.region} · 🕐 ${sec.time} HRS`, W / 2, 41, 11, '#9fc0e0');
    } else {
      text(`SECTOR ${sector + 1}/10 · ${sec.name}`, W / 2, 24, 13, '#ffffff');
      text(sec.region, W / 2, 41, 11, '#c8d4e0');
    }
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
      text(bossArr()[sector].name, W / 2, 64, 12, '#ffd9d9');
    }
    if (clearT > 0 && mode === 1) {
      // checkpoint secured intermission (the title card announces the new area)
      ctx.globalAlpha = Math.min(1, clearT);
      text('✔ CHECKPOINT SECURED', W / 2, H * 0.22, 26, '#7fe06a');
      text('PROGRESS SAVED', W / 2, H * 0.22 + 28, 14, '#dce6f0');
      ctx.globalAlpha = 1;
    } else if (waveFlash > 0 && mode === 1 && cineT <= 0) {
      ctx.globalAlpha = Math.min(1, waveFlash);
      text(wave >= 5 ? '⚠ ' + bossArr()[sector].name + ' ⚠' : 'WAVE ' + wave + '/5', W / 2, H * 0.38, 32, wave >= 5 ? '#ff5f4f' : '#ffffff');
      ctx.globalAlpha = 1;
    }
    if (secretFlash > 0 && mode === 1) {
      ctx.globalAlpha = Math.min(1, secretFlash) * (Math.floor(now / 130) % 2 ? 1 : 0.55);
      text('⚠ SECRET WEAPON ⚠', W / 2, H * 0.28, 28, '#ff4fd8');
      text(secretName, W / 2, H * 0.28 + 32, 22, '#ffffff');
      ctx.globalAlpha = 1;
    }
    if (cineT > 0 && mode === 1) {
      // cinematic area title: letterbox bars, zooming name, sweeping tricolor
      const t = CINE_T - cineT;
      const ss = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
      const a = ss(t / 0.5) * ss(cineT / 0.6);
      const bh = 62 * a;
      ctx.fillStyle = 'rgba(4,7,12,0.92)';
      ctx.fillRect(0, 0, W, bh);
      ctx.fillRect(0, H - bh, W, bh);
      ctx.fillStyle = `rgba(6,10,16,${(0.3 * a).toFixed(3)})`;
      ctx.fillRect(0, bh, W, H - 2 * bh);
      ctx.globalAlpha = a;
      text(
        night ? `NIGHT OP ${sector + 1} / 10 · BORDER ${11 + sector} OF 20` : `SECTOR ${sector + 1} / 10`,
        W / 2, H * 0.40 - 46, 15, night ? '#9fe8ff' : '#ffd23e',
      );
      const z = 1.14 - 0.14 * ss(t / 0.9);
      ctx.save();
      ctx.translate(W / 2, H * 0.40);
      ctx.scale(z, z);
      text(sec.name, 0, 0, 42, '#ffffff');
      ctx.restore();
      const uw = 230 * ss(t / 0.8);
      if (uw > 1) tricolorBar(W / 2 - uw / 2, H * 0.40 + 28, uw, 4);
      text(
        night ? `${sec.region.toUpperCase()} · ${sec.time} HRS` : sec.region.toUpperCase(),
        W / 2, H * 0.40 + 56, 16, '#c8d4e0',
      );
      ctx.globalAlpha = 1;
    }
  }

  const blink = Math.floor(now / 600) % 2;
  if (mode === 0) {
    // ---- mission select ----
    ctx.fillStyle = 'rgba(6,10,16,0.6)';
    ctx.fillRect(0, 0, W, H);
    tricolorBar(W / 2 - 110, 84, 220, 5);
    text('BORDERHAWK', W / 2, 126, 50, '#ffffff');
    text('HIMALAYAN SKIES', W / 2, 160, 18, '#ff9933');
    // pilot rank: stars from the day campaign, diamonds from the night ops
    text('★'.repeat(wins) + '☆'.repeat(5 - wins) + (diamonds > 0 ? '  ' + '💎'.repeat(diamonds) : ''), W / 2, 198, 20, '#ffd23e');
    text(wins >= 5 ? 'WING COMMANDER' : wins > 0 ? `VETERAN PILOT — ${wins}/5 ★` : 'ROOKIE PILOT', W / 2, 222, 11, '#9fb0c2');
    if (blink) text('▼ SELECT MISSION ▼', W / 2, 242, 11, '#ffd23e');

    {
      // ☀ card 1 — the day Border Campaign
      const c = CARD_DAY;
      panel(c.x, c.y, c.w, c.h, '#3a5070');
      ctx.save();
      ctx.translate(c.x + c.w - 48, c.y + 50);
      ctx.scale(0.85, 0.85);
      ctx.drawImage(sprPlayer, -36, -36);
      ctx.restore();
      text('☀ BORDER CAMPAIGN', c.x + 18, c.y + 24, 17, '#ffffff', 'left');
      text('Sir Creek → Kibithu · 10 sectors · 10 bosses', c.x + 18, c.y + 45, 11, '#9fb0c2', 'left');
      if (savedCp[0] > 0) {
        const cs = SECTORS[savedCp[0]];
        text(`▶ CONTINUE — SECTOR ${savedCp[0] + 1} · ${cs.name}`, c.x + 18, c.y + 68, 12, '#7fe06a', 'left');
        text('↺ RESTART', c.x + c.w - 18, c.y + c.h - 16, 11, '#8fa3bb', 'right');
      } else {
        text('▶ TAP TO SCRAMBLE', c.x + 18, c.y + 68, 13, blink ? '#ffd23e' : '#e8b22e', 'left');
      }
      text('WIN: ★ GOLD STAR', c.x + 18, c.y + c.h - 16, 10, '#ffd23e', 'left');
    }

    {
      // 🌙 card 2 — VAJRA NIGHTS (5-star pilots only)
      const c = CARD_NIGHT;
      const open = nightUnlocked();
      ctx.save();
      rr(c.x, c.y, c.w, c.h, 16); ctx.clip();
      const grd = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
      grd.addColorStop(0, '#070d24');
      grd.addColorStop(1, '#102046');
      ctx.fillStyle = grd;
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = '#cfe6ff';
      for (let i = 0; i < 42; i++) { // twinkling starfield
        ctx.globalAlpha = (0.25 + 0.7 * Math.abs(Math.sin(now / 650 + i * 1.7))) * (open ? 0.9 : 0.5);
        ctx.fillRect(c.x + ((i * 97) % c.w), c.y + ((i * 53) % c.h), 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      if (open) { ctx.shadowColor = 'rgba(84,200,255,0.8)'; ctx.shadowBlur = 14; }
      ctx.strokeStyle = open ? '#54c8ff' : '#2a3a5c'; ctx.lineWidth = 1.5;
      rr(c.x, c.y, c.w, c.h, 16); ctx.stroke();
      ctx.shadowBlur = 0;

      text('🌙 VAJRA NIGHTS', c.x + 18, c.y + 24, 17, '#bfe9ff', 'left');
      text('Borders 11–20 · night ops · elite bosses', c.x + 18, c.y + 45, 11, '#8fb0d8', 'left');
      if (!open) {
        ctx.fillStyle = 'rgba(6,10,18,0.45)';
        rr(c.x, c.y, c.w, c.h, 16); ctx.fill();
      }
      const bob = Math.sin(now / 600) * 4;
      ctx.save();
      ctx.translate(c.x + c.w - 48, c.y + 50 + bob);
      ctx.shadowColor = 'rgba(90,220,255,0.95)';
      ctx.shadowBlur = open ? 20 : 14;
      ctx.scale(0.85, 0.85);
      ctx.drawImage(sprPlayerNight, -36, -36);
      ctx.restore();
      if (open) {
        if (savedCp[1] > 0) {
          const cs = NIGHT_SECTORS[savedCp[1]];
          text(`▶ CONTINUE — NIGHT OP ${savedCp[1] + 1} · ${cs.name}`, c.x + 18, c.y + 68, 12, '#7fe06a', 'left');
          text('↺ RESTART', c.x + c.w - 18, c.y + c.h - 16, 11, '#8fa3bb', 'right');
        } else {
          text('▶ TAP TO LAUNCH NIGHT OPS', c.x + 18, c.y + 68, 13, blink ? '#ffd23e' : '#e8b22e', 'left');
        }
        text('WIN: 💎 DIAMOND', c.x + 18, c.y + c.h - 16, 10, '#9fe8ff', 'left');
      } else {
        text('🔒 LOCKED', c.x + 18, c.y + 68, 13, '#ff9c5a', 'left');
        text('Win Border Campaign 5× to unlock', c.x + 18, c.y + c.h - 16, 10, '#c8d4e0', 'left');
      }
      if (lockedT > 0 && Math.floor(now / 180) % 2) {
        text('⚠ 5-STAR PILOTS ONLY ⚠', W / 2, c.y - 10, 14, '#ff5f4f');
      }
    }

    if (hiscore > 0) text('HI-SCORE ' + hiscore, W / 2, 508, 14, '#dce6f0');
    text('Drag to fly · cannon auto-fires · boss = checkpoint', W / 2, 534, 12, '#9fb0c2');
    {
      const badges = [
        { x: 152, label: 'W', sub: 'WING GUNS', color: '#ff9933' },
        { x: 240, label: 'M', sub: 'MISSILES',  color: '#e84d4d' },
        { x: 328, label: 'S', sub: 'SHIELD',    color: '#3da5ff' },
      ];
      const by = 572;
      for (const b of badges) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, by, 18, 0, Math.PI * 2);
        ctx.fillStyle = b.color + '28';
        ctx.fill();
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        text(b.label, b.x, by + 1, 15, b.color);
        text(b.sub, b.x, by + 30, 9, '#8fa3bb', 'center', '600');
      }
    }
    text('a game by rokiroy.in', W / 2, H - 18, 12, '#8fa3bb');
  } else if (mode === 2) {
    // ---- mission failed ----
    ctx.fillStyle = 'rgba(6,10,16,0.6)';
    ctx.fillRect(0, 0, W, H);
    panel(50, 200, W - 100, 310, night ? '#54c8ff' : '#2d415f');
    text(night ? 'NIGHT OP FAILED' : 'MISSION FAILED', W / 2, 250, 34, '#ff5f4f');
    text('SCORE ' + score, W / 2, 296, 24, '#ffffff');
    if (score >= hiscore && score > 0) text('★ NEW HI-SCORE ★', W / 2, 324, 15, '#ffd23e');
    const cs = SEC[savedCp[campaign]];
    text('CHECKPOINT SAVED', W / 2, 358, 11, '#8fa3bb');
    text(`${night ? 'NIGHT OP' : 'SECTOR'} ${savedCp[campaign] + 1} · ${cs.name}`, W / 2, 378, 15, '#7fe06a');
    if (submitState === 'ok') text('✓ SCORE ON GLOBAL LEADERBOARD', W / 2, 410, 12, '#ffd23e');
    else if (submitState === 'sending') text('submitting score…', W / 2, 410, 12, '#9fb0c2');
    else if (submitState === 'fail') text('score submit failed', W / 2, 410, 12, '#ff5f4f');
    if (blink) text('TAP TO RE-SCRAMBLE', W / 2, 460, 19, '#ffd23e');
  } else if (mode === 3 && night) {
    // ---- Vajra Nights complete: first light over Walong ----
    ctx.fillStyle = 'rgba(6,10,16,0.6)';
    ctx.fillRect(0, 0, W, H);
    panel(40, 168, W - 80, 350, '#54c8ff');
    tricolorBar(W / 2 - 110, 190, 220, 6);
    text('FIRST LIGHT SECURED', W / 2, 228, 34, '#9fe8ff');
    text('ALL 10 NIGHT OPS · BORDERS 11–20 SAFE', W / 2, 262, 14, '#ffffff');
    text('🌅 Sunrise over Walong. Jai Hind! 🇮🇳', W / 2, 288, 14, '#ffd23e');
    text('SCORE ' + score, W / 2, 326, 24, '#ffffff');
    text('💎 DIAMOND EARNED', W / 2, 362, 17, '#9fe8ff');
    text('💎'.repeat(diamonds) + '◇'.repeat(5 - diamonds), W / 2, 416, 20, '#9fe8ff');
    if (submitState === 'ok') text('✓ SCORE ON GLOBAL LEADERBOARD', W / 2, 448, 12, '#ffd23e');
    if (blink) text('TAP FOR MENU', W / 2, 486, 18, '#ffd23e');
  } else if (mode === 3) {
    // ---- day campaign complete ----
    ctx.fillStyle = 'rgba(6,10,16,0.6)';
    ctx.fillRect(0, 0, W, H);
    panel(40, 150, W - 80, 420, '#2d415f');
    tricolorBar(W / 2 - 110, 172, 220, 6);
    text('BORDER SECURED', W / 2, 210, 36, '#7fe06a');
    text('SIR CREEK → KIBITHU · ALL 10 SECTORS', W / 2, 244, 14, '#ffffff');
    text('The entire frontier is safe. Jai Hind! 🇮🇳', W / 2, 268, 14, '#ffd23e');
    text('SCORE ' + score, W / 2, 304, 24, '#ffffff');
    text('★'.repeat(wins) + '☆'.repeat(5 - wins), W / 2, 338, 22, '#ffd23e');
    text('GOLD STAR EARNED — shown by your name on the board', W / 2, 362, 11, '#dce6f0');
    if (wins >= 5) {
      // the promotion moment: Vajra Nights opens up
      ctx.shadowColor = 'rgba(84,200,255,0.8)'; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#54c8ff'; ctx.lineWidth = 1.5;
      rr(64, 384, W - 128, 92, 12); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.translate(102, 430);
      ctx.drawImage(sprPlayerNight, -36, -36);
      ctx.restore();
      text('🔓 VAJRA NIGHTS UNLOCKED', 272, 414, 16, '#9fe8ff');
      text('Your AMCA “RUDRA” awaits —', 272, 438, 12, '#bfe9ff');
      text('10 night ops · 💎 per win · free lives every ~15s', 272, 456, 12, '#bfe9ff');
    } else {
      text(`${5 - wins} more ★ to unlock VAJRA NIGHTS + the AMCA jet`, W / 2, 412, 12, '#9fc0e0');
    }
    if (submitState === 'ok') text('✓ SCORE ON GLOBAL LEADERBOARD', W / 2, 496, 12, '#ffd23e');
    if (blink) text('TAP FOR MENU', W / 2, 532, 18, '#ffd23e');
  }

  ctx.restore();
}
requestAnimationFrame(loop);
