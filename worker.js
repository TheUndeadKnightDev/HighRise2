// ============================================================
// HIGHRISE 2: COSMIC COLLAPSE — Global Leaderboard Worker
// ============================================================
// KV binding accepted under any of these variable names:
//   lb  |  LB  |  VOID_EMPIRE_LB
// (just bind your KV namespace to ONE of those names in the
//  Cloudflare dashboard → Worker → Settings → Variables → KV)
//
// Endpoints:
//   GET  /scores/top?n=20   → { scores:[...], total }
//   POST /scores            → body { name, score, height, level }
//                              returns { success, rank, total }
//   GET  /ping              → health check
//   OPTIONS *               → CORS preflight
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const KEY = 'hr2_scores';   // KV key holding the sorted scores array
const MAX_KEEP = 200;
const NAME_MAX = 12;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

// Find the KV binding regardless of what the user named it.
function getKV(env) {
  return env.lb || env.LB || env.VOID_EMPIRE_LB || env.kv || null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const KV = getKV(env);

    try {
      // ── health
      if (path === '/ping' || path === '/' || path === '/health') {
        return json({
          status: 'ok',
          game: 'highrise-2',
          binding: KV ? 'connected' : 'MISSING_KV_BINDING',
          ts: Date.now(),
        });
      }

      if (!KV) {
        return json({ error: 'KV binding not found. Bind your namespace as "lb", "LB", or "VOID_EMPIRE_LB".' }, 500);
      }

      // ── GET top scores
      if (request.method === 'GET' && path === '/scores/top') {
        const n = Math.min(parseInt(url.searchParams.get('n') || '20', 10) || 20, 100);
        const raw = await KV.get(KEY);
        const scores = raw ? JSON.parse(raw) : [];
        return json({ scores: scores.slice(0, n), total: scores.length });
      }

      // ── POST submit score
      if (request.method === 'POST' && path === '/scores') {
        const body = await request.json();
        const { name, score, level, height } = body || {};
        if (!name || typeof score !== 'number') {
          return json({ error: 'Invalid data' }, 400);
        }

        const cleanName = String(name).replace(/[<>&"']/g, '').trim().toUpperCase().slice(0, NAME_MAX) || 'PILOT';
        const cleanScore = Math.max(0, Math.floor(score));
        const cleanHeight = Math.max(0, Math.floor(Number(height) || 0));
        const cleanLevel = Math.max(1, Math.floor(Number(level) || 1));

        const raw = await KV.get(KEY);
        let scores = raw ? JSON.parse(raw) : [];

        // If this pilot already has a higher score, just return their rank
        const existing = scores.find(e => e.name === cleanName);
        if (existing && existing.score >= cleanScore) {
          const rank = scores.findIndex(e => e.name === cleanName) + 1;
          return json({ success: true, rank, total: scores.length, kept: true });
        }

        // Otherwise replace their entry, re-sort, trim
        scores = scores.filter(e => e.name !== cleanName);
        scores.push({
          name: cleanName,
          score: cleanScore,
          height: cleanHeight,
          level: cleanLevel,
          date: Date.now(),
        });
        scores.sort((a, b) => b.score - a.score);
        scores = scores.slice(0, MAX_KEEP);

        await KV.put(KEY, JSON.stringify(scores));
        const rank = scores.findIndex(e => e.name === cleanName) + 1;
        return json({ success: true, rank, total: scores.length });
      }

      return json({ error: 'Not found', path }, 404);
    } catch (err) {
      return json({ error: 'Server error', detail: err.message }, 500);
    }
  },
};
