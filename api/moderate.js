// POST /api/moderate  { id, hidden: true|false }  (admin password required)
import { setHidden } from '../lib/store.js';
import { isAdmin } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAdmin(req)) return res.status(401).json({ error: 'Wrong password' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  try {
    await setHidden(String(body.id || ''), Boolean(body.hidden));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
