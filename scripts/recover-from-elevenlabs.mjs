// Rebuilds the parade-night journal from ElevenLabs' generation history.
// Every entry was voiced before it was saved, so the history holds each one's
// text, audio and time, including the ones Blob refused after it hit its limit.
//
//   node --env-file=.env scripts/recover-from-elevenlabs.mjs [--from ISO] [--to ISO] [--dry-run]
//
// Needs ELEVENLABS_HISTORY_KEY (a key with speech history read access) and
// ELEVENLABS_VOICE_ID in .env. Writes public/archive-data.json and the audio to
// public/archive-audio/. Adds to an existing archive-data.json (from
// scripts/build-archive.mjs) and skips entries whose text is already there.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(root, 'public', 'archive-data.json');
const AUDIO_DIR = path.join(root, 'public', 'archive-audio');
const API = 'https://api.elevenlabs.io/v1';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
// Halloween in New York, through 6 AM the next morning.
const from = Date.parse(opt('--from', '2026-10-31T00:00:00-04:00'));
const to = Date.parse(opt('--to', '2026-11-01T06:00:00-05:00'));
const dryRun = args.includes('--dry-run');

const key = process.env.ELEVENLABS_HISTORY_KEY;
const voice = process.env.ELEVENLABS_VOICE_ID;
if (!key) throw new Error('Add ELEVENLABS_HISTORY_KEY (speech history read access) to .env');
if (!voice) throw new Error('ELEVENLABS_VOICE_ID is missing from .env');

// "Rorschach's journal. October 31st. 19:42. Maya sees a bat…"
const STAMP = /^(Rorschach's journal\. [A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)\. \d{1,2}:\d{2}(?: [AP]M)?\.)\s+([\s\S]+)$/;
const MAX_TS = 9_999_999_999_999;

async function api(url) {
  const res = await fetch(url, { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function history() {
  const items = [];
  let after = null;
  for (;;) {
    const url = new URL(`${API}/history`);
    url.searchParams.set('page_size', '1000');
    url.searchParams.set('voice_id', voice);
    if (after) url.searchParams.set('start_after_history_item_id', after);
    const page = await (await api(url)).json();
    items.push(...(page.history || []));
    // Newest first: stop paging once we're past the start of the window.
    const oldest = page.history?.[page.history.length - 1];
    if (!page.has_more || (oldest && oldest.date_unix * 1000 < from)) break;
    after = page.last_history_item_id;
  }
  return items;
}

const items = (await history())
  .filter((h) => h.voice_id === voice)
  .filter((h) => h.date_unix * 1000 >= from && h.date_unix * 1000 <= to)
  .sort((a, b) => a.date_unix - b.date_unix);

let existing = { entries: [] };
try { existing = JSON.parse(await fs.readFile(DATA, 'utf8')); } catch {}

const entries = [];
const skipped = [];
const seenText = new Set((existing.entries || []).map((e) => e.text));
for (const h of items) {
  const m = STAMP.exec((h.text || '').trim());
  if (!m) { skipped.push(h); continue; }
  if (seenText.has(h.text)) continue;   // a replayed generation, not a new entry
  seenText.add(h.text);
  const ms = h.date_unix * 1000;
  const id = `${String(MAX_TS - ms).padStart(13, '0')}-${h.history_item_id.slice(0, 8).toLowerCase().replace(/[^0-9a-z]/g, '')}`;
  entries.push({
    id,
    createdAt: new Date(ms).toISOString(),
    stamp: m[1],
    line: m[2].replace(/\s+/g, ' '),
    text: `${m[1]} ${m[2].replace(/\s+/g, ' ')}`,
    audioUrl: `/archive-audio/${id}.mp3`,
    historyItemId: h.history_item_id,
  });
}

// People who saw "The ink smudged" often tried again: flag same first word within 5 minutes.
const firstWord = (e) => e.line.split(/\s+/)[0].toLowerCase();
const maybeRetries = entries.filter((e, i) =>
  entries.some((o, j) => j !== i && firstWord(o) === firstWord(e) && Math.abs(Date.parse(o.createdAt) - Date.parse(e.createdAt)) < 5 * 60_000),
);

const ny = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
console.log(`${seenText.size - entries.length} entries were already in the archive (saved in Blob before the limit).`);
console.log(`Found ${entries.length} journal entries Blob never got, between ${new Date(from).toISOString()} and ${new Date(to).toISOString()}.`);
if (skipped.length) console.log(`Skipped ${skipped.length} other generations with this voice (not journal entries).`);
entries.forEach((e, i) => console.log(`${String(i + 1).padStart(3)}. ${ny(e.createdAt)}  ${e.line.slice(0, 90)}${maybeRetries.includes(e) ? '   <- possible retry' : ''}`));

if (dryRun) {
  console.log('\nDry run: nothing written.');
  process.exit(0);
}

await fs.mkdir(AUDIO_DIR, { recursive: true });
let downloaded = 0;
for (const e of entries) {
  const file = path.join(AUDIO_DIR, `${e.id}.mp3`);
  try {
    await fs.access(file);
  } catch {
    const audio = Buffer.from(await (await api(`${API}/history/${e.historyItemId}/audio`)).arrayBuffer());
    await fs.writeFile(file, audio);
    downloaded++;
  }
}

const merged = (existing.entries || [])
  .concat(entries.map(({ historyItemId, ...e }) => ({ ...e, recovered: true })))
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
await fs.writeFile(DATA, JSON.stringify({
  ...existing,
  frozenAt: new Date().toISOString(),
  entries: merged,
  trail: existing.trail || { sharing: false, points: [] },
}, null, 1));
console.log(`\nAdded ${entries.length} entries to ${path.relative(root, DATA)} (${merged.length} in total) and downloaded ${downloaded} new audio files to ${path.relative(root, AUDIO_DIR)}/.`);
