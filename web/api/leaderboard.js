// Leaderboard API backed by Vercel Blob.
// Each score is one tiny blob whose PATHNAME encodes the entry:
//   scores/<0000000score>.<sector>.<b64url name>.<b64url city>.w<wins>.d<dia>.<ts>
// (older entries lack the w<wins> and/or d<dia> segments and read as 0;
//  sectors 11–20 are Vajra Nights ops, dia = night-campaign victories)
// So GET needs a single list() call — no per-entry fetches, and writes never
// race each other because every entry is its own blob.
import { list, put } from '@vercel/blob';

const enc = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const dec = (s) => {
  try {
    return Buffer.from(s, 'base64url').toString('utf8');
  } catch {
    return '?';
  }
};

const clean = (s, fallback) =>
  String(s ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 14) || fallback;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const sc = Math.floor(Number(body?.score));
  if (!Number.isFinite(sc) || sc <= 0 || sc > 2_000_000) {
    return Response.json({ error: 'invalid score' }, { status: 400 });
  }
  const n = clean(body?.name, 'PILOT');
  const c = clean(body?.city, '—');
  const sec = Math.min(Math.max(Number(body?.sector) | 0, 0), 20);
  // campaign completions → gold stars on the board, capped at 5
  const wins = Math.min(Math.max(Number(body?.wins) | 0, 0), 5);
  // Vajra Nights victories → diamonds, capped at 5
  const dia = Math.min(Math.max(Number(body?.dia) | 0, 0), 5);
  // unique trailing segment ourselves — addRandomSuffix would splice its
  // suffix before the last dot and corrupt the encoded city segment
  const uniq = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const path = `scores/${String(sc).padStart(7, '0')}.${sec}.${enc(n)}.${enc(c)}.w${wins}.d${dia}.${uniq}`;
  try {
    await put(path, '1', { access: 'public', addRandomSuffix: false });
  } catch (err) {
    console.error('leaderboard POST: blob put failed', err);
    return Response.json({ error: 'storage unavailable' }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function GET(request) {
  const url = new URL(request.url);
  const qName = (url.searchParams.get('name') || '').toLowerCase().trim();
  const qCity = (url.searchParams.get('city') || '').toLowerCase().trim();

  let blobs;
  try {
    ({ blobs } = await list({ prefix: 'scores/', limit: 1000 }));
  } catch (err) {
    console.error('leaderboard GET: blob list failed', err);
    return Response.json({ error: 'storage unavailable' }, { status: 500 });
  }
  const rows = [];
  const winsBy = new Map();
  const diaBy = new Map();
  for (const b of blobs) {
    const parts = b.pathname.slice('scores/'.length).split('.');
    if (parts.length < 5) continue;
    const score = Number(parts[0]);
    if (!Number.isFinite(score) || score <= 0) continue;
    const wins = parts.length >= 6 && /^w\d$/.test(parts[4]) ? Math.min(Number(parts[4].slice(1)), 5) : 0;
    const dia = parts.length >= 7 && /^d\d$/.test(parts[5]) ? Math.min(Number(parts[5].slice(1)), 5) : 0;
    const key = `${dec(parts[2]).toLowerCase()}|${dec(parts[3]).toLowerCase()}`;
    winsBy.set(key, Math.max(winsBy.get(key) || 0, wins));
    diaBy.set(key, Math.max(diaBy.get(key) || 0, dia));
    rows.push({ score, sector: Number(parts[1]) || 0, name: dec(parts[2]), city: dec(parts[3]), key });
  }
  rows.sort((a, b) => b.score - a.score);

  // deduplicate — one entry per pilot (best score), full list
  const seen = new Set();
  const all = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    all.push({ score: r.score, sector: r.sector, name: r.name, city: r.city, wins: winsBy.get(r.key) || 0, dia: diaBy.get(r.key) || 0, key: r.key });
  }

  const totalPilots = all.length;
  const top = all.slice(0, 10).map(({ key: _k, ...rest }) => rest);

  let myRank = null;
  let myEntry = null;
  if (qName) {
    const idx = all.findIndex(e => e.key === `${qName}|${qCity}`);
    if (idx !== -1) {
      myRank = idx + 1;
      if (idx >= 10) {
        const { key: _k, ...rest } = all[idx];
        myEntry = rest;
      }
    }
  }

  return Response.json(
    { top, myRank, myEntry, totalPilots },
    { headers: { 'Cache-Control': 's-maxage=15, stale-while-revalidate=60' } },
  );
}
