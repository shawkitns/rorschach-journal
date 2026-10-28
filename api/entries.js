// GET /api/entries?limit=40   → newest entries first (hidden ones left out).
// With the admin password (Authorization: Bearer ...) and ?all=1, hidden ones are included.
import { listEntries } from '../lib/store.js';
import { isAdmin } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const url = new URL(req.url, 'http://x');
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 40));
  const wantAll = url.searchParams.get('all') === '1';
  if (wantAll && !isAdmin(req)) return res.status(401).json({ error: 'Wrong password' });

  try {
    const entries = await listEntries({ limit, includeHidden: wantAll });
    const publicFields = entries.map(({ id, createdAt, stamp, name, line, text, audioUrl, hidden, seen, source }) =>
      wantAll ? { id, createdAt, stamp, name, seen, line, text, audioUrl, hidden, source } : { id, createdAt, stamp, name, line, text, audioUrl },
    );
    return res.status(200).json({ entries: publicFields });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not read the journal' });
  }
}
