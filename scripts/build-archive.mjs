// Builds the frozen archive (public/archive-data.json + public/archive-audio/)
// from the Blob backup made by scripts/export-from-site.mjs.
//
//   node scripts/build-archive.mjs [--from ISO] [--trail-from ISO] [--trail-to ISO]
//
// Entries before --from are left out (tests). Trail points outside the trail
// window are left out (getting ready at home). Hidden entries stay hidden.
// Run scripts/recover-from-elevenlabs.mjs afterwards to add entries Blob never got.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP = path.join(root, 'backup');
const DATA = path.join(root, 'public', 'archive-data.json');
const AUDIO_DIR = path.join(root, 'public', 'archive-audio');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return Date.parse(i >= 0 ? args[i + 1] : fallback);
};
const from = opt('--from', '2026-10-31T00:00:00-04:00');
const trailFrom = opt('--trail-from', '2026-10-31T16:30:00-04:00');
const trailTo = opt('--trail-to', '2026-11-01T06:00:00-05:00');

const backup = JSON.parse(await fs.readFile(path.join(BACKUP, 'entries.json'), 'utf8'));
const trail = JSON.parse(await fs.readFile(path.join(BACKUP, 'trail.json'), 'utf8'));

await fs.mkdir(AUDIO_DIR, { recursive: true });
const entries = [];
for (const e of backup) {
  if (e.hidden || Date.parse(e.createdAt) < from) continue;
  let audioUrl = null;
  try {
    await fs.copyFile(path.join(BACKUP, 'audio', `${e.id}.mp3`), path.join(AUDIO_DIR, `${e.id}.mp3`));
    audioUrl = `/archive-audio/${e.id}.mp3`;
  } catch {}
  entries.push({ id: e.id, createdAt: e.createdAt, stamp: e.stamp, line: e.line, text: e.text, audioUrl });
}

const points = (trail.points || []).filter(([t]) => t >= trailFrom && t <= trailTo);

await fs.writeFile(DATA, JSON.stringify({
  frozenAt: new Date().toISOString(),
  mapKey: 'Solid red: where I walked, recorded by GPS. Dashed: the parade route up Sixth Avenue, walked after 7 PM, when the GPS record was lost. Pins: entries, placed where I was when they were written.',
  routeLabel: 'Parade route · GPS lost after 7 PM',
  entries,
  trail: { sharing: false, points },
}, null, 1));

console.log(`Wrote ${path.relative(root, DATA)}: ${entries.length} entries (left out ${backup.length - entries.length}), ${points.length} of ${trail.points?.length || 0} trail points.`);
