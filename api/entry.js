// POST /api/entry  { name, seen }  → creates a journal entry with audio.
import { makeId, saveAudio, saveEntry, countEntriesSince } from '../lib/store.js';
import { cleanName, cleanSeen, journalTimestamp, startOfToday, writeEntryLine, speak } from '../lib/journal.js';
import { clientIp, rateLimited, submissionsOpen } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!submissionsOpen()) {
    return res.status(503).json({ error: 'closed', message: 'The journal is closed. Thank you for looking into the ink. Read the archive instead.' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};

  // Bots fill in every field, including this invisible one.
  if (body.website) return res.status(200).json({ ok: true });

  if (rateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'slow_down', message: 'Patience. The journal writes slowly. Try again in a minute.' });
  }

  const cap = Number(process.env.MAX_ENTRIES_PER_DAY || 400);
  try {
    if ((await countEntriesSince(startOfToday())) >= cap) {
      return res.status(503).json({ error: 'full', message: 'The journal is full tonight. Read the archive instead.' });
    }
  } catch (err) {
    console.error('Count failed', err);
  }

  const seen = cleanSeen(body.seen);
  if (!seen) return res.status(400).json({ error: 'missing', message: 'Tell the journal what you see.' });
  const name = cleanName(body.name) || 'A stranger';

  const id = makeId();
  const createdAt = new Date().toISOString();
  const stamp = journalTimestamp(new Date(createdAt));
  const { line, source } = await writeEntryLine(name === 'A stranger' ? 'A stranger' : name, seen);
  const text = `${stamp} ${line}`;

  let audioUrl = null;
  try {
    const { buffer, contentType } = await speak(text);
    audioUrl = await saveAudio(id, buffer, contentType);
  } catch (err) {
    console.error('Voice failed, saving text only:', err.message);
  }

  const entry = { id, createdAt, stamp, name, seen: source === 'neutral' || source === 'dodged' ? null : seen, line, text, audioUrl, source };
  try {
    await saveEntry(entry);
  } catch (err) {
    console.error('Save failed', err);
    return res.status(500).json({ error: 'save_failed', message: 'The ink smudged. Try again.' });
  }

  return res.status(201).json({ entry });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
