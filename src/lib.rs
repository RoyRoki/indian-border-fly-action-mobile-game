// BORDERHAWK: Himalayan Skies — game engine compiled to wasm32-unknown-unknown.
// No wasm-bindgen: plain C-ABI exports + shared linear memory. The JS side reads
// a draw-command buffer (stride 6 f32: kind,x,y,rot,scale,aux) and a HUD array.

use core::f32::consts::PI;

pub const W: f32 = 480.0;
pub const H: f32 = 800.0;

const NB: usize = 64; // player bullets
const NE: usize = 32; // enemies
const NS: usize = 128; // enemy shots
const NP: usize = 8; // powerups
const NT: usize = 160; // particles
const MAXD: usize = 420; // max draw commands

// Campaigns: India's border west→east, 10 checkpoint sectors each.
//   0 = Border Campaign (day)
//   1 = Vajra Nights (night ops; harder, new enemy types, weapon lvl 4,
//       homing missiles, +200k victory bonus — JS awards the diamond)
// Each sector = waves 1..=5; wave 5 is the sector boss. Killing it secures
// the checkpoint (JS persists it) and advances to the next sector.
const NSECTORS: u32 = 10;
const WAVES_PER_SECTOR: u32 = 5;

// draw kinds
const D_PLAYER: f32 = 0.0;
const D_BULLET: f32 = 1.0;
const D_MISSILE: f32 = 2.0;
const D_DRONE: f32 = 3.0;
const D_JET: f32 = 4.0;
const D_HELI: f32 = 5.0;
const D_BOSS: f32 = 6.0;
const D_SHOT: f32 = 7.0;
const D_POW: f32 = 8.0;
const D_PART: f32 = 9.0;
const D_SHIELD: f32 = 10.0;
const D_PHANTOM: f32 = 11.0; // night stealth drone
const D_HUNTER: f32 = 12.0; // night hunter gunship

// sound events
const EV_SHOOT: f32 = 1.0;
const EV_BOOM: f32 = 2.0;
const EV_BIGBOOM: f32 = 3.0;
const EV_POW: f32 = 4.0;
const EV_HIT: f32 = 5.0;
const EV_BOSS: f32 = 6.0;
const EV_MISSILE: f32 = 7.0;
const EV_SECRET: f32 = 8.0; // boss unleashes its secret weapon

#[derive(Clone, Copy)]
struct Bullet {
    alive: bool,
    missile: bool,
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
}

#[derive(Clone, Copy)]
struct Enemy {
    alive: bool,
    kind: u8, // 0 drone, 1 jet, 2 heli, 3 boss
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    hp: f32,
    maxhp: f32,
    t: f32,
    cd: f32,
    phase: f32,
    bx: f32, // weave base x
    ty: f32, // hover target y
    pat: u32,
}

#[derive(Clone, Copy)]
struct Shot {
    alive: bool,
    kind: u8, // 0 plasma ball, 1 cluster shell (bursts when t expires), 2 bomb
    t: f32,   // cluster fuse
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
}

#[derive(Clone, Copy)]
struct Pw {
    alive: bool,
    kind: u8, // 0 weapon, 1 missiles, 2 shield
    x: f32,
    y: f32,
}

#[derive(Clone, Copy)]
struct Pt {
    alive: bool,
    kind: u8, // 0 fire, 1 smoke, 2 spark, 3 tricolor trail (aux=color), 4 snow
    aux: f32,
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    life: f32,
    max: f32,
}

struct Game {
    mode: u32, // 0 menu, 1 playing, 2 game over, 3 campaign victory
    campaign: u32, // 0 day Border Campaign, 1 Vajra Nights
    rng: u32,
    score: u32,
    lives: i32,
    wave: u32, // wave within the sector, 1..=5
    sector: u32,
    start_sector: u32, // checkpoint new games resume from
    clear_t: f32,      // "checkpoint secured" intermission timer
    scroll: f32,
    over_t: f32,
    prev_pressed: bool,
    // player
    px: f32,
    py: f32,
    prot: f32,
    pinv: f32,
    weapon: u32,
    mtimer: f32,
    shield: f32,
    ccd: f32,
    mcd: f32,
    trail_cd: f32,
    snow_cd: f32,
    // wave spawning
    spawn_left: u32,
    spawn_cd: f32,
    bullets: [Bullet; NB],
    enemies: [Enemy; NE],
    shots: [Shot; NS],
    pows: [Pw; NP],
    parts: [Pt; NT],
}

const ZB: Bullet = Bullet { alive: false, missile: false, x: 0.0, y: 0.0, vx: 0.0, vy: 0.0 };
const ZE: Enemy = Enemy {
    alive: false,
    kind: 0,
    x: 0.0,
    y: 0.0,
    vx: 0.0,
    vy: 0.0,
    hp: 0.0,
    maxhp: 0.0,
    t: 0.0,
    cd: 0.0,
    phase: 0.0,
    bx: 0.0,
    ty: 0.0,
    pat: 0,
};
const ZS: Shot = Shot { alive: false, kind: 0, t: 0.0, x: 0.0, y: 0.0, vx: 0.0, vy: 0.0 };
const ZP: Pw = Pw { alive: false, kind: 0, x: 0.0, y: 0.0 };
const ZT: Pt = Pt {
    alive: false,
    kind: 0,
    aux: 0.0,
    x: 0.0,
    y: 0.0,
    vx: 0.0,
    vy: 0.0,
    life: 0.0,
    max: 0.0,
};

static mut GAME: Game = Game {
    mode: 0,
    campaign: 0,
    rng: 0x1234_5678,
    score: 0,
    lives: 3,
    wave: 1,
    sector: 0,
    start_sector: 0,
    clear_t: 0.0,
    scroll: 0.0,
    over_t: 0.0,
    prev_pressed: false,
    px: W / 2.0,
    py: H - 140.0,
    prot: 0.0,
    pinv: 0.0,
    weapon: 1,
    mtimer: 0.0,
    shield: 0.0,
    ccd: 0.0,
    mcd: 0.0,
    trail_cd: 0.0,
    snow_cd: 0.0,
    spawn_left: 0,
    spawn_cd: 0.0,
    bullets: [ZB; NB],
    enemies: [ZE; NE],
    shots: [ZS; NS],
    pows: [ZP; NP],
    parts: [ZT; NT],
};

// HUD: 0 mode, 1 score, 2 lives, 3 wave (within sector), 4 scroll, 5 boss hp,
//      6 boss max, 7 weapon lvl, 8 shield t, 9 missile t, 10 event count,
//      11..16 events, 16 sector, 17 checkpoint-secured timer, 18 campaign
static mut HUD: [f32; 24] = [0.0; 24];
static mut DRAW: [f32; MAXD * 6] = [0.0; MAXD * 6];

fn game() -> &'static mut Game {
    unsafe { &mut *(&raw mut GAME) }
}
fn hud() -> &'static mut [f32; 24] {
    unsafe { &mut *(&raw mut HUD) }
}
fn drawbuf() -> &'static mut [f32; MAXD * 6] {
    unsafe { &mut *(&raw mut DRAW) }
}

fn rnd(rng: &mut u32) -> f32 {
    let mut x = *rng;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *rng = x;
    (x >> 8) as f32 / 16_777_216.0
}

fn push_ev(h: &mut [f32; 24], code: f32) {
    let n = h[10] as usize;
    if n < 5 {
        h[11 + n] = code;
        h[10] = (n + 1) as f32;
    }
}

fn boom(parts: &mut [Pt; NT], rng: &mut u32, x: f32, y: f32, n: u32, big: bool) {
    let mut made = 0;
    for p in parts.iter_mut() {
        if made >= n {
            break;
        }
        if p.alive {
            continue;
        }
        let a = rnd(rng) * PI * 2.0;
        let sp = (40.0 + rnd(rng) * (if big { 220.0 } else { 130.0 })) as f32;
        let fire = rnd(rng) < 0.65;
        *p = Pt {
            alive: true,
            kind: if fire { 0 } else { 1 },
            aux: rnd(rng),
            x,
            y,
            vx: a.cos() * sp,
            vy: a.sin() * sp,
            life: 0.35 + rnd(rng) * (if big { 0.8 } else { 0.45 }),
            max: 1.0,
            ..ZT
        };
        p.max = p.life;
        made += 1;
    }
}

fn spark(parts: &mut [Pt; NT], rng: &mut u32, x: f32, y: f32, n: u32) {
    let mut made = 0;
    for p in parts.iter_mut() {
        if made >= n {
            break;
        }
        if p.alive {
            continue;
        }
        let a = rnd(rng) * PI * 2.0;
        let sp = 60.0 + rnd(rng) * 120.0;
        *p = Pt {
            alive: true,
            kind: 2,
            aux: 0.0,
            x,
            y,
            vx: a.cos() * sp,
            vy: a.sin() * sp,
            life: 0.18 + rnd(rng) * 0.15,
            max: 0.33,
        };
        made += 1;
    }
}

fn spawn_shot(shots: &mut [Shot; NS], x: f32, y: f32, vx: f32, vy: f32) {
    spawn_shot_k(shots, 0, 0.0, x, y, vx, vy);
}

fn spawn_shot_k(shots: &mut [Shot; NS], kind: u8, t: f32, x: f32, y: f32, vx: f32, vy: f32) {
    for s in shots.iter_mut() {
        if !s.alive {
            *s = Shot { alive: true, kind, t, x, y, vx, vy };
            return;
        }
    }
}

// fan of `n` shots aimed at the player, `step` radians apart
fn aimed_spread(shots: &mut [Shot; NS], x: f32, y: f32, px: f32, py: f32, n: i32, step: f32, speed: f32) {
    let dx = px - x;
    let dy = (py - y).max(40.0);
    let len = (dx * dx + dy * dy).sqrt().max(1.0);
    let (ux, uy) = (dx / len, dy / len);
    let half = (n - 1) / 2;
    for k in -half..=half {
        let a = k as f32 * step;
        let (s, c) = (a.sin(), a.cos());
        spawn_shot(shots, x, y + 24.0, (ux * c - uy * s) * speed, (ux * s + uy * c) * speed);
    }
}

fn radial(shots: &mut [Shot; NS], x: f32, y: f32, n: u32, phase: f32, speed: f32) {
    for k in 0..n {
        let a = k as f32 / n as f32 * PI * 2.0 + phase;
        spawn_shot(shots, x, y, a.cos() * speed, a.sin() * speed);
    }
}

fn spawn_pow(pows: &mut [Pw; NP], rng: &mut u32, x: f32, y: f32) {
    for p in pows.iter_mut() {
        if !p.alive {
            let r = rnd(rng);
            let kind = if r < 0.45 {
                0
            } else if r < 0.78 {
                1
            } else {
                2
            };
            *p = Pw { alive: true, kind, x, y };
            return;
        }
    }
}

fn spawn_bullet(bullets: &mut [Bullet; NB], missile: bool, x: f32, y: f32, vx: f32, vy: f32) {
    for b in bullets.iter_mut() {
        if !b.alive {
            *b = Bullet { alive: true, missile, x, y, vx, vy };
            return;
        }
    }
}

fn enemy_radius(kind: u8) -> f32 {
    match kind {
        0 => 17.0,
        1 => 19.0,
        2 => 25.0,
        4 => 16.0,
        5 => 27.0,
        _ => 54.0,
    }
}

// global difficulty: grows across the whole campaign, west to east.
// Vajra Nights starts past the end of the day campaign and keeps climbing.
fn diff(g: &Game) -> u32 {
    g.campaign * 55 + g.sector * WAVES_PER_SECTOR + g.wave
}

fn start_wave(g: &mut Game, h: &mut [f32; 24]) {
    if g.wave >= WAVES_PER_SECTOR {
        // sector boss guards the checkpoint — each sector fields its own machine
        g.spawn_left = 0;
        // per-boss hull multiplier (fortress/dragon are tanks, the ace is nimble)
        const HPM: [f32; 10] = [1.0, 1.35, 0.85, 1.0, 1.05, 0.9, 1.0, 1.0, 1.05, 1.15];
        let s = g.sector.min(NSECTORS - 1) as usize;
        // night bosses are the hardest machines in the game
        let night_hp = if g.campaign == 1 { 1.6 } else { 1.0 };
        for e in g.enemies.iter_mut() {
            if !e.alive {
                let hp = (50.0 + (g.sector * WAVES_PER_SECTOR + WAVES_PER_SECTOR) as f32 * 4.5) * HPM[s] * night_hp;
                *e = Enemy {
                    alive: true,
                    kind: 3,
                    x: W / 2.0,
                    y: -90.0,
                    vx: 0.0,
                    vy: 60.0,
                    hp,
                    maxhp: hp,
                    t: 0.0,
                    cd: 1.6,
                    phase: 0.0,
                    bx: W / 2.0,
                    ty: match s {
                        1 => 130.0, // fortress sits back
                        4 => 120.0, // artillery lobs from high up
                        2 => 140.0,
                        _ => 150.0,
                    },
                    pat: 0,
                };
                break;
            }
        }
        push_ev(h, EV_BOSS);
    } else if g.campaign == 1 {
        g.spawn_left = (4 + g.wave * 2 + g.sector * 2).min(16);
        g.spawn_cd = 0.7;
    } else {
        g.spawn_left = (3 + g.wave * 2 + g.sector).min(12);
        g.spawn_cd = 0.8;
    }
}

fn spawn_enemy(g: &mut Game) {
    let d = diff(g);
    let wave = d as f32;
    let night = g.campaign == 1;
    let r = rnd(&mut g.rng);
    let kind: u8 = if night {
        // night skies: phantom drones and hunter gunships join the fight
        if d >= 58 && r < 0.15 {
            5
        } else if r < 0.36 {
            4
        } else if r < 0.60 {
            1
        } else if r < 0.74 {
            2
        } else {
            0
        }
    } else if d >= 4 && r < 0.18 {
        2
    } else if d >= 2 && r < 0.50 {
        1
    } else {
        0
    };
    let x = 40.0 + rnd(&mut g.rng) * (W - 80.0);
    for e in g.enemies.iter_mut() {
        if e.alive {
            continue;
        }
        *e = match kind {
            4 => Enemy {
                // phantom drone: fast serpentine stealth wing, aimed plasma fans
                alive: true,
                kind: 4,
                x,
                y: -30.0,
                vx: 0.0,
                vy: 150.0 + ((d - 55) as f32 * 3.0).min(80.0),
                hp: 3.0,
                maxhp: 3.0,
                t: 0.0,
                cd: 1.0 + rnd(&mut g.rng) * 0.8,
                phase: rnd(&mut g.rng) * PI * 2.0,
                bx: x,
                ty: 0.0,
                pat: 0,
            },
            5 => Enemy {
                // night hunter: heavy gunship, homing missiles + wide spreads
                alive: true,
                kind: 5,
                x,
                y: -50.0,
                vx: 0.0,
                vy: 85.0,
                hp: 16.0 + ((d - 55) as f32 * 0.4).min(10.0),
                maxhp: 16.0 + ((d - 55) as f32 * 0.4).min(10.0),
                t: 0.0,
                cd: 1.8,
                phase: rnd(&mut g.rng) * PI * 2.0,
                bx: x,
                ty: 90.0 + rnd(&mut g.rng) * 140.0,
                pat: 0,
            },
            0 => Enemy {
                alive: true,
                kind: 0,
                x,
                y: -30.0,
                vx: 0.0,
                vy: (70.0 + wave * 5.0).min(150.0),
                hp: 1.0,
                maxhp: 1.0,
                t: 0.0,
                cd: 2.0 + rnd(&mut g.rng) * 1.5,
                phase: rnd(&mut g.rng) * PI * 2.0,
                bx: x,
                ty: 0.0,
                pat: 0,
            },
            1 => Enemy {
                alive: true,
                kind: 1,
                x,
                y: -40.0,
                vx: 0.0,
                vy: (170.0 + wave * 6.0).min(260.0),
                hp: 2.0,
                maxhp: 2.0,
                t: 0.0,
                cd: 0.9 + rnd(&mut g.rng) * 0.8,
                phase: 0.0,
                bx: x,
                ty: 0.0,
                pat: 0,
            },
            _ => Enemy {
                alive: true,
                kind: 2,
                x,
                y: -40.0,
                vx: 0.0,
                vy: 90.0,
                hp: 6.0 + (wave * 0.5).min(10.0),
                maxhp: 6.0 + (wave * 0.5).min(10.0),
                t: 0.0,
                cd: 1.6,
                phase: rnd(&mut g.rng) * PI * 2.0,
                bx: x,
                ty: 100.0 + rnd(&mut g.rng) * 150.0,
                pat: 0,
            },
        };
        if night && kind < 3 {
            // the regulars fly meaner at night
            e.hp *= 2.0;
            e.maxhp = e.hp;
            e.vy *= 1.1;
        }
        break;
    }
}

fn reset_game(g: &mut Game, h: &mut [f32; 24]) {
    g.score = 0;
    g.lives = 3;
    g.sector = g.start_sector.min(NSECTORS - 1);
    g.wave = 1;
    g.clear_t = 0.0;
    g.over_t = 0.0;
    g.px = W / 2.0;
    g.py = H - 140.0;
    g.pinv = 2.0;
    g.weapon = 1;
    g.mtimer = 0.0;
    g.shield = 0.0;
    g.ccd = 0.0;
    g.mcd = 0.0;
    g.bullets = [ZB; NB];
    g.enemies = [ZE; NE];
    g.shots = [ZS; NS];
    g.pows = [ZP; NP];
    g.parts = [ZT; NT];
    g.mode = 1;
    start_wave(g, h);
}

fn kill_player_hit(g: &mut Game, h: &mut [f32; 24]) {
    if g.shield > 0.0 || g.pinv > 0.0 {
        return;
    }
    g.lives -= 1;
    g.weapon = g.weapon.saturating_sub(1).max(1);
    g.pinv = 2.5;
    boom(&mut g.parts, &mut g.rng, g.px, g.py, 26, true);
    push_ev(h, EV_HIT);
    if g.lives <= 0 {
        g.mode = 2;
        g.over_t = 0.0;
        push_ev(h, EV_BIGBOOM);
        boom(&mut g.parts, &mut g.rng, g.px, g.py, 60, true);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn init(seed: u32) {
    let g = game();
    g.rng = seed | 1;
    g.mode = 0;
    g.scroll = 0.0;
}

// Resume point for new games. JS calls this with the persisted checkpoint.
#[unsafe(no_mangle)]
pub extern "C" fn set_checkpoint(sector: u32) {
    game().start_sector = sector.min(NSECTORS - 1);
}

// Which campaign the next game runs: 0 day, 1 Vajra Nights.
#[unsafe(no_mangle)]
pub extern "C" fn set_campaign(c: u32) {
    game().campaign = c.min(1);
}

// The menu lives in JS (it owns the campaign lock), so JS starts games
// explicitly instead of the engine reacting to a raw menu tap.
#[unsafe(no_mangle)]
pub extern "C" fn start_game() {
    let g = game();
    if g.mode != 1 {
        reset_game(g, hud());
    }
}

// Debug/testing: start playing right at a sector's boss (JS: ?boss=N).
#[unsafe(no_mangle)]
pub extern "C" fn jump_to_boss(sector: u32) {
    let g = game();
    let h = hud();
    g.start_sector = sector.min(NSECTORS - 1);
    reset_game(g, h);
    g.wave = WAVES_PER_SECTOR;
    g.enemies = [ZE; NE];
    g.spawn_left = 0;
    start_wave(g, h);
}

#[unsafe(no_mangle)]
pub extern "C" fn draw_ptr() -> *const f32 {
    (&raw const DRAW) as *const f32
}

#[unsafe(no_mangle)]
pub extern "C" fn hud_ptr() -> *const f32 {
    (&raw const HUD) as *const f32
}

#[unsafe(no_mangle)]
pub extern "C" fn frame(dt_in: f32, tx: f32, ty: f32, pressed_in: u32) -> u32 {
    let g = game();
    let h = hud();
    let d = drawbuf();
    let dt = dt_in.clamp(0.0, 0.05);
    let pressed = pressed_in != 0;
    let tap = pressed && !g.prev_pressed;
    g.prev_pressed = pressed;
    h[10] = 0.0; // clear events

    // scrolling terrain always moves
    let scroll_speed = match g.mode {
        1 => 160.0,
        _ => 40.0,
    };
    g.scroll += scroll_speed * dt;

    // ambient snow flecks
    g.snow_cd -= dt;
    if g.snow_cd <= 0.0 {
        g.snow_cd = 0.10;
        let x = rnd(&mut g.rng) * W;
        for p in g.parts.iter_mut() {
            if !p.alive {
                *p = Pt {
                    alive: true,
                    kind: 4,
                    aux: rnd(&mut g.rng),
                    x,
                    y: -10.0,
                    vx: -20.0 + rnd(&mut g.rng) * 40.0,
                    vy: scroll_speed + 60.0 + rnd(&mut g.rng) * 80.0,
                    life: 6.0,
                    max: 6.0,
                };
                break;
            }
        }
    }

    match g.mode {
        // 0 (menu): taps are handled by JS — it picks the campaign and
        // calls start_game(), so a bare tap here does nothing.
        2 => {
            g.over_t += dt;
            if g.over_t > 0.8 && tap {
                reset_game(g, h);
            }
        }
        3 => {
            // campaign complete — border secured start to end
            g.over_t += dt;
            if g.over_t > 1.2 && tap {
                g.mode = 0;
            }
        }
        _ => {}
    }

    if g.mode == 1 {
        // ---- player ----
        let txc = tx.clamp(26.0, W - 26.0);
        let tyc = ty.clamp(60.0, H - 40.0);
        let ease = (dt * 11.0).min(1.0);
        let oldx = g.px;
        g.px += (txc - g.px) * ease;
        g.py += (tyc - g.py) * ease;
        g.prot = ((g.px - oldx) * 0.09).clamp(-0.45, 0.45);
        if g.pinv > 0.0 {
            g.pinv -= dt;
        }
        if g.shield > 0.0 {
            g.shield -= dt;
        }
        if g.mtimer > 0.0 {
            g.mtimer -= dt;
        }

        // tricolor exhaust trail
        g.trail_cd -= dt;
        if g.trail_cd <= 0.0 {
            g.trail_cd = 0.035;
            for p in g.parts.iter_mut() {
                if !p.alive {
                    let c = (g.scroll * 10.0) as u32 % 3;
                    *p = Pt {
                        alive: true,
                        kind: 3,
                        aux: c as f32,
                        x: g.px + (rnd(&mut g.rng) - 0.5) * 6.0,
                        y: g.py + 24.0,
                        vx: 0.0,
                        vy: 120.0,
                        life: 0.5,
                        max: 0.5,
                    };
                    break;
                }
            }
        }

        // cannon (auto-fire)
        g.ccd -= dt;
        if g.ccd <= 0.0 {
            g.ccd = 0.16;
            match g.weapon {
                1 => spawn_bullet(&mut g.bullets, false, g.px, g.py - 26.0, 0.0, -560.0),
                2 => {
                    spawn_bullet(&mut g.bullets, false, g.px - 12.0, g.py - 20.0, 0.0, -560.0);
                    spawn_bullet(&mut g.bullets, false, g.px + 12.0, g.py - 20.0, 0.0, -560.0);
                }
                3 => {
                    spawn_bullet(&mut g.bullets, false, g.px, g.py - 26.0, 0.0, -580.0);
                    spawn_bullet(&mut g.bullets, false, g.px - 14.0, g.py - 18.0, -105.0, -555.0);
                    spawn_bullet(&mut g.bullets, false, g.px + 14.0, g.py - 18.0, 105.0, -555.0);
                }
                _ => {
                    // level 4 — Vajra Nights only: the RUDRA's full plasma array
                    spawn_bullet(&mut g.bullets, false, g.px, g.py - 28.0, 0.0, -620.0);
                    spawn_bullet(&mut g.bullets, false, g.px - 11.0, g.py - 22.0, 0.0, -590.0);
                    spawn_bullet(&mut g.bullets, false, g.px + 11.0, g.py - 22.0, 0.0, -590.0);
                    spawn_bullet(&mut g.bullets, false, g.px - 19.0, g.py - 14.0, -140.0, -550.0);
                    spawn_bullet(&mut g.bullets, false, g.px + 19.0, g.py - 14.0, 140.0, -550.0);
                }
            }
            push_ev(h, EV_SHOOT);
        }

        // Astra missiles
        if g.mtimer > 0.0 {
            g.mcd -= dt;
            if g.mcd <= 0.0 {
                g.mcd = if g.campaign == 1 { 0.45 } else { 0.55 };
                spawn_bullet(&mut g.bullets, true, g.px - 18.0, g.py, -60.0, -260.0);
                spawn_bullet(&mut g.bullets, true, g.px + 18.0, g.py, 60.0, -260.0);
                if g.campaign == 1 {
                    spawn_bullet(&mut g.bullets, true, g.px, g.py - 12.0, 0.0, -300.0);
                }
                push_ev(h, EV_MISSILE);
            }
        }

        // ---- wave spawning / checkpoint intermission ----
        if g.clear_t > 0.0 {
            g.clear_t -= dt;
            if g.clear_t <= 0.0 {
                g.wave = 1;
                start_wave(g, h);
            }
        } else if g.spawn_left > 0 {
            g.spawn_cd -= dt;
            if g.spawn_cd <= 0.0 {
                g.spawn_cd = (1.25 - diff(g) as f32 * 0.04).max(0.55);
                g.spawn_left -= 1;
                spawn_enemy(g);
            }
        } else if !g.enemies.iter().any(|e| e.alive) && g.wave < WAVES_PER_SECTOR {
            g.wave += 1;
            start_wave(g, h);
        }

        // ---- enemies ----
        let (ppx, ppy) = (g.px, g.py);
        let d = diff(g);
        for ei in 0..NE {
            if !g.enemies[ei].alive {
                continue;
            }
            let mut e = g.enemies[ei];
            e.t += dt;
            e.cd -= dt;
            match e.kind {
                0 => {
                    // drone: weave down
                    e.x = e.bx + (e.t * 2.2 + e.phase).sin() * 70.0;
                    e.y += e.vy * dt;
                    if d >= 3 && e.cd <= 0.0 && e.y > 0.0 && e.y < ppy - 120.0 {
                        e.cd = 2.6;
                        spawn_shot(&mut g.shots, e.x, e.y + 14.0, 0.0, 240.0);
                    }
                }
                1 => {
                    // strike jet: dives, leads toward player, aimed shots
                    let want = ((ppx - e.x) * 1.4).clamp(-130.0, 130.0);
                    e.vx += (want - e.vx) * (dt * 2.0).min(1.0);
                    e.x += e.vx * dt;
                    e.y += e.vy * dt;
                    if e.cd <= 0.0 && e.y > 30.0 && e.y < ppy - 90.0 {
                        e.cd = 1.5;
                        let dx = ppx - e.x;
                        let dy = ppy - e.y;
                        let len = (dx * dx + dy * dy).sqrt().max(1.0);
                        spawn_shot(&mut g.shots, e.x, e.y + 16.0, dx / len * 240.0, dy / len * 240.0);
                    }
                }
                2 => {
                    // gunship heli: descend then strafe + 3-spread
                    if e.y < e.ty {
                        e.y += e.vy * dt;
                    } else {
                        e.vx = (e.t * 0.9 + e.phase).sin() * 95.0;
                        e.x = (e.x + e.vx * dt).clamp(32.0, W - 32.0);
                    }
                    if e.cd <= 0.0 && e.y > 20.0 {
                        e.cd = (1.9 - d as f32 * 0.03).max(1.35);
                        let dx = ppx - e.x;
                        let dy = (ppy - e.y).max(40.0);
                        let len = (dx * dx + dy * dy).sqrt().max(1.0);
                        let (ux, uy) = (dx / len, dy / len);
                        for k in -1..=1i32 {
                            let a = k as f32 * 0.22;
                            let (s, c) = (a.sin(), a.cos());
                            spawn_shot(
                                &mut g.shots,
                                e.x,
                                e.y + 18.0,
                                (ux * c - uy * s) * 200.0,
                                (ux * s + uy * c) * 200.0,
                            );
                        }
                    }
                }
                4 => {
                    // phantom drone: fast serpentine, fires aimed plasma fans
                    e.x = (e.bx + (e.t * 3.2 + e.phase).sin() * 95.0).clamp(24.0, W - 24.0);
                    e.y += e.vy * dt;
                    if e.cd <= 0.0 && e.y > 20.0 && e.y < ppy - 80.0 {
                        e.cd = 1.5;
                        aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 3, 0.3, 290.0);
                    }
                }
                5 => {
                    // night hunter: hover, then alternate homing missiles / 5-spreads
                    if e.y < e.ty {
                        e.y += e.vy * dt;
                    } else {
                        e.x = (e.bx + (e.t * 0.8 + e.phase).sin() * 120.0).clamp(34.0, W - 34.0);
                    }
                    if e.cd <= 0.0 && e.y > 20.0 {
                        e.cd = 2.1;
                        e.pat += 1;
                        if e.pat % 2 == 1 {
                            spawn_shot_k(&mut g.shots, 3, 4.5, e.x, e.y + 22.0, 0.0, 140.0);
                        } else {
                            aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 5, 0.2, 210.0);
                        }
                    }
                }
                _ => {
                    // sector boss — variant = sector (a boss only flies in its own sector).
                    // e.vy doubles as a "still descending" flag; e.phase flips to 1 once
                    // the secret weapon is unleashed; e.bx is per-variant scratch
                    // (dash target / glide target / spiral angle).
                    let v = g.sector.min(NSECTORS - 1);
                    if e.vy > 0.0 {
                        e.y += e.vy * dt;
                        if e.y >= e.ty {
                            e.y = e.ty;
                            e.vy = 0.0;
                            e.t = 0.0; // movement patterns start from a neutral pose
                        }
                    } else {
                        match v {
                            1 => e.x = W / 2.0 + (e.t * 0.3).sin() * 95.0,
                            2 => {
                                // ace: hard dashes between random points
                                if (e.x - e.bx).abs() < 12.0 {
                                    e.bx = 60.0 + rnd(&mut g.rng) * (W - 120.0);
                                }
                                e.x += if e.bx > e.x { 300.0 } else { -300.0 } * dt;
                                e.y = e.ty + (e.t * 2.4).sin() * 18.0;
                            }
                            4 => e.x = W / 2.0 + (e.t * 0.4).sin() * 120.0,
                            5 => {
                                // phantom: glide to a point, then pick another
                                let dx = e.bx - e.x;
                                let dy = e.ty - e.y;
                                let len = (dx * dx + dy * dy).sqrt();
                                if len < 10.0 {
                                    e.bx = 60.0 + rnd(&mut g.rng) * (W - 120.0);
                                    e.ty = 110.0 + rnd(&mut g.rng) * 150.0;
                                } else {
                                    e.x += dx / len * 170.0 * dt;
                                    e.y += dy / len * 170.0 * dt;
                                }
                            }
                            6 => {
                                // sentinel: figure-8
                                e.x = W / 2.0 + (e.t * 0.7).sin() * 150.0;
                                e.y = e.ty + (e.t * 1.4).sin() * 40.0;
                            }
                            7 => e.x = W / 2.0 + (e.t * 0.45).sin() * 190.0,
                            9 => e.x = W / 2.0 + (e.t * 0.5).sin() * 130.0,
                            _ => e.x = W / 2.0 + (e.t * 0.55).sin() * 150.0,
                        }
                    }
                    // secret weapon unleashed below 35% hull
                    if matches!(v, 1 | 4 | 6 | 8 | 9) && e.phase < 0.5 && e.hp < e.maxhp * 0.35 {
                        e.phase = 1.0;
                        e.cd = 0.8;
                        push_ev(h, EV_SECRET);
                    }
                    let secret = e.phase > 0.5;
                    if e.vy <= 0.0 && e.cd <= 0.0 {
                        e.pat += 1;
                        match v {
                            0 => {
                                // marsh stalker: aimed bursts, slow mine ring
                                if e.pat % 3 == 0 {
                                    e.cd = 2.2;
                                    radial(&mut g.shots, e.x, e.y, 10, e.t, 130.0);
                                } else {
                                    e.cd = 1.5;
                                    aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 3, 0.2, 230.0);
                                }
                            }
                            1 => {
                                // desert fortress: bomb columns; secret = sandstorm barrage
                                if secret {
                                    e.cd = 0.9;
                                    for _ in 0..5 {
                                        let bx = 30.0 + rnd(&mut g.rng) * (W - 60.0);
                                        spawn_shot_k(&mut g.shots, 2, 0.0, bx, e.y + 30.0, 0.0, 330.0);
                                    }
                                } else {
                                    e.cd = 1.7;
                                    for k in -1..=1i32 {
                                        spawn_shot_k(&mut g.shots, 2, 0.0, ppx + k as f32 * 46.0, e.y + 30.0, 0.0, 300.0);
                                    }
                                }
                            }
                            2 => {
                                // wagah ace: rapid twin guns while dashing, quick fans
                                if e.pat % 4 == 0 {
                                    e.cd = 1.1;
                                    aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 3, 0.26, 300.0);
                                } else {
                                    e.cd = 0.85;
                                    aimed_spread(&mut g.shots, e.x - 12.0, e.y, ppx, ppy, 1, 0.0, 310.0);
                                    aimed_spread(&mut g.shots, e.x + 12.0, e.y, ppx, ppy, 1, 0.0, 310.0);
                                }
                            }
                            4 => {
                                // ridge artillery: cluster shells; secret = avalanche fan
                                let dx = ppx - e.x;
                                let dy = (ppy - e.y).max(60.0);
                                let len = (dx * dx + dy * dy).sqrt().max(1.0);
                                let (ux, uy) = (dx / len, dy / len);
                                if secret {
                                    e.cd = 1.6;
                                    for k in -1..=1i32 {
                                        let a = k as f32 * 0.3;
                                        let (s, c) = (a.sin(), a.cos());
                                        let fuse = 0.8 + rnd(&mut g.rng) * 0.5;
                                        spawn_shot_k(&mut g.shots, 1, fuse, e.x, e.y + 24.0, (ux * c - uy * s) * 165.0, (ux * s + uy * c) * 165.0);
                                    }
                                } else if e.pat % 2 == 1 {
                                    e.cd = 2.4;
                                    let fuse = 0.9 + rnd(&mut g.rng) * 0.4;
                                    spawn_shot_k(&mut g.shots, 1, fuse, e.x, e.y + 24.0, ux * 160.0, uy * 160.0);
                                } else {
                                    e.cd = 1.4;
                                    aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 1, 0.0, 240.0);
                                }
                            }
                            5 => {
                                // white phantom: fans flung downward while ghosting
                                e.cd = 1.5;
                                for k in -2..=2i32 {
                                    let a = PI / 2.0 + k as f32 * 0.32;
                                    spawn_shot(&mut g.shots, e.x, e.y + 16.0, a.cos() * 195.0, a.sin() * 195.0);
                                }
                            }
                            6 => {
                                // lake sentinel: rotating spiral; secret = twin whirlwind
                                if secret {
                                    e.cd = 0.09;
                                    e.bx += 0.5;
                                    spawn_shot(&mut g.shots, e.x, e.y, e.bx.cos() * 200.0, e.bx.sin() * 200.0);
                                    spawn_shot(&mut g.shots, e.x, e.y, -e.bx.cos() * 200.0, -e.bx.sin() * 200.0);
                                } else {
                                    e.cd = 0.13;
                                    e.bx += 0.45;
                                    spawn_shot(&mut g.shots, e.x, e.y, e.bx.cos() * 165.0, e.bx.sin() * 165.0);
                                }
                            }
                            7 => {
                                // razor wing: bullet walls with one gap to thread
                                if e.pat % 2 == 1 {
                                    e.cd = 2.6;
                                    let gap = 60.0 + rnd(&mut g.rng) * (W - 120.0);
                                    let mut x = 24.0;
                                    while x < W {
                                        if (x - gap).abs() > 55.0 {
                                            spawn_shot(&mut g.shots, x, e.y + 34.0, 0.0, 210.0);
                                        }
                                        x += 36.0;
                                    }
                                } else {
                                    e.cd = 1.4;
                                    aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 3, 0.22, 250.0);
                                }
                            }
                            8 => {
                                // storm bringer: snap shots + rings; secret = lightning rain
                                if secret {
                                    e.cd = 0.28;
                                    for _ in 0..2 {
                                        let x = rnd(&mut g.rng) * W;
                                        spawn_shot(&mut g.shots, x, -10.0, (rnd(&mut g.rng) - 0.5) * 80.0, 300.0);
                                    }
                                } else if e.pat % 4 == 3 {
                                    e.cd = 1.4;
                                    radial(&mut g.shots, e.x, e.y, 12, e.t, 145.0);
                                } else {
                                    e.cd = 0.62;
                                    aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 1, 0.0, 280.0);
                                }
                            }
                            9 => {
                                // dragon command: escalates through hull phases;
                                // secret = dragon fury (everything at once)
                                let hpf = e.hp / e.maxhp;
                                if secret {
                                    e.cd = 1.15;
                                    match e.pat % 3 {
                                        0 => radial(&mut g.shots, e.x, e.y, 16, e.t, 160.0),
                                        1 => {
                                            let dx = ppx - e.x;
                                            let dy = (ppy - e.y).max(60.0);
                                            let len = (dx * dx + dy * dy).sqrt().max(1.0);
                                            spawn_shot_k(&mut g.shots, 1, 0.9, e.x, e.y + 24.0, dx / len * 170.0, dy / len * 170.0);
                                        }
                                        _ => aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 5, 0.18, 270.0),
                                    }
                                } else if hpf > 0.66 {
                                    e.cd = 1.4;
                                    aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 5, 0.16, 250.0);
                                } else if e.pat % 2 == 0 {
                                    e.cd = 1.9;
                                    radial(&mut g.shots, e.x, e.y, 14, e.t, 145.0);
                                } else {
                                    e.cd = 1.35;
                                    aimed_spread(&mut g.shots, e.x, e.y, ppx, ppy, 3, 0.22, 260.0);
                                }
                            }
                            _ => {
                                // akhnoor warlord (3): the classic gunship
                                if e.pat % 2 == 1 {
                                    e.cd = 1.4;
                                    aimed_spread(&mut g.shots, e.x, e.y + 6.0, ppx, ppy, 5, 0.16, 250.0);
                                } else {
                                    e.cd = 2.1;
                                    radial(&mut g.shots, e.x, e.y, 14, e.t, 140.0);
                                }
                            }
                        }
                        if g.campaign == 1 {
                            // night bosses cycle their patterns notably faster
                            e.cd *= 0.78;
                        }
                    }
                }
            }
            if e.y > H + 50.0 {
                e.alive = false;
            }
            g.enemies[ei] = e;
        }

        // ---- player bullets ----
        for bi in 0..NB {
            if !g.bullets[bi].alive {
                continue;
            }
            if g.bullets[bi].missile {
                // home toward nearest enemy
                let (bx, by) = (g.bullets[bi].x, g.bullets[bi].y);
                let mut best = -1isize;
                let mut bd = f32::MAX;
                for (ei, e) in g.enemies.iter().enumerate() {
                    if e.alive && e.y < by {
                        let dd = (e.x - bx) * (e.x - bx) + (e.y - by) * (e.y - by);
                        if dd < bd {
                            bd = dd;
                            best = ei as isize;
                        }
                    }
                }
                if best >= 0 {
                    let e = g.enemies[best as usize];
                    let dx = e.x - bx;
                    let dy = e.y - by;
                    let len = (dx * dx + dy * dy).sqrt().max(1.0);
                    let k = (dt * 5.0).min(1.0);
                    g.bullets[bi].vx += (dx / len * 430.0 - g.bullets[bi].vx) * k;
                    g.bullets[bi].vy += (dy / len * 430.0 - g.bullets[bi].vy) * k;
                }
            }
            g.bullets[bi].x += g.bullets[bi].vx * dt;
            g.bullets[bi].y += g.bullets[bi].vy * dt;
            let b = g.bullets[bi];
            if b.y < -30.0 || b.y > H + 30.0 || b.x < -30.0 || b.x > W + 30.0 {
                g.bullets[bi].alive = false;
            }
        }

        // ---- enemy shots ----
        for si in 0..NS {
            if !g.shots[si].alive {
                continue;
            }
            if g.shots[si].kind == 3 {
                // hunter missile: tracks the player until its motor burns out
                g.shots[si].t -= dt;
                if g.shots[si].t <= 0.0 {
                    let (sx, sy) = (g.shots[si].x, g.shots[si].y);
                    g.shots[si].alive = false;
                    spark(&mut g.parts, &mut g.rng, sx, sy, 4);
                    continue;
                }
                let dx = g.px - g.shots[si].x;
                let dy = g.py - g.shots[si].y;
                let len = (dx * dx + dy * dy).sqrt().max(1.0);
                let k = (dt * 2.4).min(1.0);
                g.shots[si].vx += (dx / len * 215.0 - g.shots[si].vx) * k;
                g.shots[si].vy += (dy / len * 215.0 - g.shots[si].vy) * k;
            }
            g.shots[si].x += g.shots[si].vx * dt;
            g.shots[si].y += g.shots[si].vy * dt;
            if g.shots[si].kind == 1 {
                // cluster shell: burst into a fragment ring when the fuse runs out
                g.shots[si].t -= dt;
                if g.shots[si].t <= 0.0 {
                    let (sx, sy) = (g.shots[si].x, g.shots[si].y);
                    g.shots[si].alive = false;
                    radial(&mut g.shots, sx, sy, 8, rnd(&mut g.rng) * PI, 170.0);
                    boom(&mut g.parts, &mut g.rng, sx, sy, 8, false);
                    push_ev(h, EV_BOOM);
                }
            }
            let s = g.shots[si];
            if s.y < -20.0 || s.y > H + 20.0 || s.x < -20.0 || s.x > W + 20.0 {
                g.shots[si].alive = false;
            }
        }

        // ---- powerups ----
        for p in g.pows.iter_mut() {
            if !p.alive {
                continue;
            }
            p.y += 95.0 * dt;
            if p.y > H + 30.0 {
                p.alive = false;
            }
        }

        // ---- collisions: player bullets vs enemies ----
        for bi in 0..NB {
            if !g.bullets[bi].alive {
                continue;
            }
            let (bx, by) = (g.bullets[bi].x, g.bullets[bi].y);
            let dmg = if g.bullets[bi].missile { 3.0 } else { 1.0 };
            for ei in 0..NE {
                if !g.enemies[ei].alive {
                    continue;
                }
                let e = g.enemies[ei];
                let r = enemy_radius(e.kind) + 5.0;
                let dx = e.x - bx;
                let dy = e.y - by;
                if dx * dx + dy * dy < r * r {
                    g.bullets[bi].alive = false;
                    g.enemies[ei].hp -= dmg;
                    spark(&mut g.parts, &mut g.rng, bx, by, 3);
                    if g.enemies[ei].hp <= 0.0 {
                        g.enemies[ei].alive = false;
                        let (sc, big) = match e.kind {
                            0 => (100, false),
                            1 => (250, false),
                            2 => (400, true),
                            4 => (350, false),
                            5 => (700, true),
                            _ => (if g.campaign == 1 { 8000 } else { 5000 }, true),
                        };
                        g.score += sc;
                        boom(&mut g.parts, &mut g.rng, e.x, e.y, if big { 34 } else { 14 }, big);
                        push_ev(h, if big { EV_BIGBOOM } else { EV_BOOM });
                        if e.kind == 3 {
                            spawn_pow(&mut g.pows, &mut g.rng, e.x - 30.0, e.y);
                            spawn_pow(&mut g.pows, &mut g.rng, e.x + 30.0, e.y);
                            // checkpoint secured: clear hostile fire, save resume
                            // point, advance west→east (or finish the campaign)
                            for s in g.shots.iter_mut() {
                                s.alive = false;
                            }
                            if g.sector + 1 >= NSECTORS {
                                if g.campaign == 1 {
                                    // Vajra Nights victory: 2,00,000-point bonus
                                    // (JS banks the diamond alongside it)
                                    g.score += 200_000;
                                }
                                g.mode = 3;
                                g.over_t = 0.0;
                            } else {
                                g.sector += 1;
                                g.start_sector = g.sector;
                                g.clear_t = 3.0;
                                g.wave = 0;
                                g.spawn_left = 0;
                            }
                        } else if rnd(&mut g.rng) < 0.14 {
                            spawn_pow(&mut g.pows, &mut g.rng, e.x, e.y);
                        }
                    }
                    break;
                }
            }
        }

        // ---- collisions: shots / enemies vs player ----
        let (ppx, ppy) = (g.px, g.py);
        for si in 0..NS {
            if !g.shots[si].alive {
                continue;
            }
            let dx = g.shots[si].x - ppx;
            let dy = g.shots[si].y - ppy;
            let r = if g.shield > 0.0 { 34.0 } else { 13.0 };
            if dx * dx + dy * dy < r * r {
                g.shots[si].alive = false;
                if g.shield > 0.0 {
                    spark(&mut g.parts, &mut g.rng, g.shots[si].x, g.shots[si].y, 4);
                } else {
                    kill_player_hit(g, h);
                }
            }
        }
        for ei in 0..NE {
            if !g.enemies[ei].alive {
                continue;
            }
            let e = g.enemies[ei];
            let r = enemy_radius(e.kind) + 12.0;
            let dx = e.x - ppx;
            let dy = e.y - ppy;
            if dx * dx + dy * dy < r * r {
                if e.kind != 3 {
                    g.enemies[ei].alive = false;
                    boom(&mut g.parts, &mut g.rng, e.x, e.y, 16, false);
                    push_ev(h, EV_BOOM);
                }
                if g.shield > 0.0 {
                    spark(&mut g.parts, &mut g.rng, e.x, e.y, 6);
                } else {
                    kill_player_hit(g, h);
                }
            }
        }

        // ---- collect powerups ----
        for pi in 0..NP {
            if !g.pows[pi].alive {
                continue;
            }
            let p = g.pows[pi];
            let dx = p.x - ppx;
            let dy = p.y - ppy;
            if dx * dx + dy * dy < 30.0 * 30.0 {
                g.pows[pi].alive = false;
                match p.kind {
                    // weapon upgrades are permanent; getting hit degrades one level
                    // (the night jet carries a fourth, full-array stage)
                    0 => g.weapon = (g.weapon + 1).min(if g.campaign == 1 { 4 } else { 3 }),
                    1 => {
                        g.mtimer = 12.0;
                        g.mcd = 0.0;
                    }
                    _ => g.shield = 8.0,
                }
                g.score += 50;
                push_ev(h, EV_POW);
            }
        }
    }

    // ---- particles (run in all modes) ----
    for p in game().parts.iter_mut() {
        if !p.alive {
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1.0 - (dt * 2.0).min(0.5);
        p.life -= dt;
        if p.life <= 0.0 || p.y > H + 20.0 {
            p.alive = false;
        }
    }

    // ================= draw commands =================
    let g = game();
    let mut n: usize = 0;
    let mut emit = |n: &mut usize, kind: f32, x: f32, y: f32, rot: f32, scale: f32, aux: f32| {
        if *n < MAXD {
            let i = *n * 6;
            d[i] = kind;
            d[i + 1] = x;
            d[i + 2] = y;
            d[i + 3] = rot;
            d[i + 4] = scale;
            d[i + 5] = aux;
            *n += 1;
        }
    };

    for p in g.pows.iter() {
        if p.alive {
            emit(&mut n, D_POW, p.x, p.y, 0.0, 1.0, p.kind as f32);
        }
    }
    for p in g.parts.iter() {
        if p.alive {
            let a = (p.life / p.max).clamp(0.0, 1.0);
            emit(&mut n, D_PART, p.x, p.y, 0.0, a, p.kind as f32 + p.aux * 0.25);
        }
    }
    for b in g.bullets.iter() {
        if b.alive {
            let rot = b.vx.atan2(-b.vy);
            emit(&mut n, if b.missile { D_MISSILE } else { D_BULLET }, b.x, b.y, rot, 1.0, 0.0);
        }
    }
    let mut boss_hp = 0.0;
    let mut boss_max = 0.0;
    for e in g.enemies.iter() {
        if !e.alive {
            continue;
        }
        match e.kind {
            0 => emit(&mut n, D_DRONE, e.x, e.y, e.t * 6.0, 1.0, 0.0),
            1 => emit(&mut n, D_JET, e.x, e.y, (e.vx * 0.004).clamp(-0.5, 0.5), 1.0, 0.0),
            2 => emit(&mut n, D_HELI, e.x, e.y, 0.0, 1.0, e.t),
            4 => emit(&mut n, D_PHANTOM, e.x, e.y, 0.0, 1.0, e.t),
            5 => emit(&mut n, D_HUNTER, e.x, e.y, 0.0, 1.0, e.t),
            _ => {
                // rot carries the variant (+0.5 once the secret weapon is live)
                let v = g.sector.min(NSECTORS - 1) as f32 + if e.phase > 0.5 { 0.5 } else { 0.0 };
                emit(&mut n, D_BOSS, e.x, e.y, v, 1.0, e.t);
                boss_hp = e.hp;
                boss_max = e.maxhp;
            }
        }
    }
    for s in g.shots.iter() {
        if s.alive {
            // rot points along the velocity so missile-type shots can rotate
            emit(&mut n, D_SHOT, s.x, s.y, s.vx.atan2(-s.vy), 1.0, s.kind as f32);
        }
    }
    if g.mode == 1 || g.mode == 3 {
        let blink = g.pinv > 0.0 && ((g.pinv * 14.0) as u32) % 2 == 0;
        emit(&mut n, D_PLAYER, g.px, g.py, g.prot, 1.0, if blink { 1.0 } else { 0.0 });
        if g.shield > 0.0 {
            emit(&mut n, D_SHIELD, g.px, g.py, g.scroll * 2.0, 1.0, g.shield);
        }
    }

    h[0] = g.mode as f32;
    h[1] = g.score as f32;
    h[2] = g.lives.max(0) as f32;
    h[3] = g.wave as f32;
    h[4] = g.scroll;
    h[5] = boss_hp;
    h[6] = boss_max;
    h[7] = g.weapon as f32;
    h[8] = g.shield.max(0.0);
    h[9] = g.mtimer.max(0.0);
    h[16] = g.sector as f32;
    h[17] = g.clear_t.max(0.0);
    h[18] = g.campaign as f32;

    n as u32
}
