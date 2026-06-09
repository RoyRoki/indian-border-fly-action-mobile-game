// Leaderboard API backed by Vercel Blob.
// Each score is one tiny blob whose PATHNAME encodes the entry:
//   scores/<0000000score>.<sector>.<b64url name>.<b64url city>.w<wins>.<ts>
// (older entries lack the w<wins> segment and read as wins=0)
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
  const sec = Math.min(Math.max(Number(body?.sector) | 0, 0), 10);
  // campaign completions → gold stars on the board, capped at 5
  const wins = Math.min(Math.max(Number(body?.wins) | 0, 0), 5);
  // unique trailing segment ourselves — addRandomSuffix would splice its
  // suffix before the last dot and corrupt the encoded city segment
  const uniq = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const path = `scores/${String(sc).padStart(7, '0')}.${sec}.${enc(n)}.${enc(c)}.w${wins}.${uniq}`;
  try {
    await put(path, '1', { access: 'public', addRandomSuffix: false });
  } catch (err) {
    console.error('leaderboard POST: blob put failed', err);
    return Response.json({ error: 'storage unavailable' }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function GET() {
  let blobs;
  try {
    ({ blobs } = await list({ prefix: 'scores/', limit: 1000 }));
  } catch (err) {
    console.error('leaderboard GET: blob list failed', err);
    return Response.json({ error: 'storage unavailable' }, { status: 500 });
  }
  const rows = [];
  const winsBy = new Map(); // a pilot's stars = their best wins across all entries
  for (const b of blobs) {
    const parts = b.pathname.slice('scores/'.length).split('.');
    if (parts.length < 5) continue;
    const score = Number(parts[0]);
    if (!Number.isFinite(score) || score <= 0) continue;
    const wins = parts.length >= 6 && /^w\d$/.test(parts[4]) ? Math.min(Number(parts[4].slice(1)), 5) : 0;
    const key = `${dec(parts[2]).toLowerCase()}|${dec(parts[3]).toLowerCase()}`;
    winsBy.set(key, Math.max(winsBy.get(key) || 0, wins));
    rows.push({ score, sector: Number(parts[1]) || 0, name: dec(parts[2]), city: dec(parts[3]), key });
  }
  rows.sort((a, b) => b.score - a.score);
  // one row per pilot (best score), top 50
  const seen = new Set();
  const top = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    top.push({ score: r.score, sector: r.sector, name: r.name, city: r.city, wins: winsBy.get(r.key) || 0 });
    if (top.length >= 50) break;
  }
  return Response.json(
    { top },
    { headers: { 'Cache-Control': 's-maxage=15, stale-while-revalidate=60' } },
  );
}
