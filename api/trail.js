// GET  /api/trail                        → { sharing, updatedAt, points }  (public)
// POST /api/trail  { sharing, points }   → replaces the trail             (admin password required)
// POST /api/trail  { clear: true }       → deletes the trail              (admin password required)
import { clearTrail, getTrail, saveTrail } from '../lib/store.js';
import { isAdmin } from '../lib/http.js';

const MAX_POINTS = 5000;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      return res.status(200).json(await getTrail());
    } catch (err) {
      console.error('Trail read failed', err);
      return res.status(200).json({ sharing: false, updatedAt: null, points: [] });
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAdmin(req)) return res.status(401).json({ error: 'Wrong password' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};
  if (body.clear === true) {
    await clearTrail();
    return res.status(200).json({ ok: true });
  }

  const points = (Array.isArray(body.points) ? body.points : [])
    .filter(validPoint)
    .map(([t, lat, lng, seg]) => [Math.round(t), round5(lat), round5(lng), Math.round(seg)])
    .sort((a, b) => a[0] - b[0])
    .slice(-MAX_POINTS);

  try {
    await saveTrail({ sharing: Boolean(body.sharing), updatedAt: new Date().toISOString(), points });
    return res.status(200).json({ ok: true, points: points.length });
  } catch (err) {
    console.error('Trail save failed', err);
    return res.status(500).json({ error: 'save_failed' });
  }
}

// Allows an hour of clock difference: a phone set a few minutes fast must not lose its trail.
function validPoint(p) {
  if (!Array.isArray(p) || p.length !== 4 || !p.every(Number.isFinite)) return false;
  const [t, lat, lng] = p;
  return t > 1.7e12 && t < Date.now() + 3_600_000 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
