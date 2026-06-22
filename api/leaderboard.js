// Leaderboard API — GET merges Supabase (authenticated) + Vercel Blob (legacy).
// POST still writes to Blob for backward compatibility with old clients.
import { list, put } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  const wins = Math.min(Math.max(Number(body?.wins) | 0, 0), 5);
  const dia = Math.min(Math.max(Number(body?.dia) | 0, 0), 5);
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
  const qUid  = (url.searchParams.get('uid')  || '').trim();

  // ---- Supabase: authenticated scores (best per player) ----
  const supRows = [];
  try {
    const { data } = await supabase
      .from('scores')
      .select('score, sector, player_id, players(name, city, wins, dia)')
      .order('score', { ascending: false })
      .limit(1000);

    // Deduplicate by player_id (UUID) so name changes don't create duplicates.
    // Scores are ordered highest-first so first occurrence = best score per player.
    const seenUid = new Set();
    for (const row of data || []) {
      const p = row.players;
      if (!p || seenUid.has(row.player_id)) continue;
      seenUid.add(row.player_id);
      const key = `${p.name.toLowerCase()}|${p.city.toLowerCase()}`;
      supRows.push({
        score: row.score, sector: row.sector,
        name: p.name, city: p.city, wins: p.wins, dia: p.dia, key,
        uid: row.player_id,
      });
    }
  } catch (err) {
    console.error('leaderboard GET: supabase error', err);
  }

  // ---- Blob: legacy anonymous scores ----
  const blobDeduped = [];
  try {
    const { blobs } = await list({ prefix: 'scores/', limit: 1000 });
    const winsBy = new Map(), diaBy = new Map(), blobAll = [];
    for (const b of blobs) {
      const parts = b.pathname.slice('scores/'.length).split('.');
      if (parts.length < 5) continue;
      const score = Number(parts[0]);
      if (!Number.isFinite(score) || score <= 0) continue;
      const wins = parts.length >= 6 && /^w\d$/.test(parts[4]) ? Math.min(Number(parts[4].slice(1)), 5) : 0;
      const dia  = parts.length >= 7 && /^d\d$/.test(parts[5]) ? Math.min(Number(parts[5].slice(1)), 5) : 0;
      const key  = `${dec(parts[2]).toLowerCase()}|${dec(parts[3]).toLowerCase()}`;
      winsBy.set(key, Math.max(winsBy.get(key) || 0, wins));
      diaBy.set(key, Math.max(diaBy.get(key) || 0, dia));
      blobAll.push({ score, sector: Number(parts[1]) || 0, name: dec(parts[2]), city: dec(parts[3]), key });
    }
    blobAll.sort((a, b) => b.score - a.score);
    const seenBlob = new Set();
    for (const r of blobAll) {
      if (seenBlob.has(r.key)) continue;
      seenBlob.add(r.key);
      blobDeduped.push({ ...r, wins: winsBy.get(r.key) || 0, dia: diaBy.get(r.key) || 0 });
    }
  } catch (err) {
    console.error('leaderboard GET: blob error', err);
  }

  // ---- Merge: each Supabase player stays separate (keyed by UUID, not name).
  // Blob entries boost scores for Supabase players with matching name+city
  // (migration: same person played anonymously before signing in).
  // Blob entries with no matching Supabase player are kept as separate rows.
  // Two Supabase players with the same name+city are never collapsed. ----
  const merged = supRows.map(r => ({ ...r }));

  // Index for blob→supabase score boosting: name|city → first matching sup row index.
  // If multiple Supabase players share the same name+city we still boost the top scorer.
  const supBoostMap = new Map();
  for (let i = 0; i < merged.length; i++) {
    if (!supBoostMap.has(merged[i].key)) supBoostMap.set(merged[i].key, i);
  }
  // Track which name+city keys are covered by Supabase (any number of players)
  const supKeySet = new Set(merged.map(r => r.key));

  for (const b of blobDeduped) {
    if (supKeySet.has(b.key)) {
      // Boost the best-scoring Supabase player with this name+city from their old blob score
      const i = supBoostMap.get(b.key);
      if (b.score > merged[i].score) { merged[i].score = b.score; merged[i].sector = b.sector; }
      merged[i].wins = Math.max(merged[i].wins, b.wins);
      merged[i].dia  = Math.max(merged[i].dia,  b.dia);
    } else {
      merged.push(b);
    }
  }

  // Extra consolidation for the authenticated viewer: if their Supabase entry and a
  // blob entry share the same name (case-insensitive) but differ only in city, merge
  // them — this handles the common case where someone played anonymously (city="—" or
  // slightly different spelling) then later signed up with a proper city.
  if (qUid && qName) {
    let myIdx = merged.findIndex(e => e.uid === qUid);
    if (myIdx !== -1) {
      const myName = merged[myIdx].name.toLowerCase();
      for (let i = merged.length - 1; i >= 0; i--) {
        if (i === myIdx) continue;
        const e = merged[i];
        if (!e.uid && e.name.toLowerCase() === myName) {
          // Absorb this blob entry into the user's authenticated row
          if (e.score > merged[myIdx].score) {
            merged[myIdx].score  = e.score;
            merged[myIdx].sector = e.sector;
          }
          merged[myIdx].wins = Math.max(merged[myIdx].wins, e.wins || 0);
          merged[myIdx].dia  = Math.max(merged[myIdx].dia,  e.dia  || 0);
          merged.splice(i, 1);
          if (i < myIdx) myIdx--;
        }
      }
    }
  }

  merged.sort((a, b) => b.score - a.score);

  // Count all registered players (not just those with scores)
  let totalPilots = merged.length;
  try {
    const { count } = await supabase
      .from('players')
      .select('id', { count: 'exact', head: true });
    if (count && count > totalPilots) totalPilots = count;
  } catch { /* fall back to score count */ }
  const full = url.searchParams.get('full') === '1';
  const top = merged.slice(0, full ? merged.length : 10).map(({ key: _k, uid: _u, ...rest }) => rest);

  let myRank = null;
  let myEntry = null;
  if (qUid || qName) {
    // Prefer UUID lookup (unique); fall back to name+city for blob-only players
    const idx = qUid
      ? merged.findIndex(e => e.uid === qUid)
      : merged.findIndex(e => e.key === `${qName}|${qCity}`);
    if (idx !== -1) {
      myRank = idx + 1;
      const { key: _k, uid: _u, ...rest } = merged[idx];
      myEntry = rest;
    }
  }

  return Response.json(
    { top, myRank, myEntry, totalPilots },
    { headers: { 'Cache-Control': 's-maxage=15, stale-while-revalidate=60' } },
  );
}
