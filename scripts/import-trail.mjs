// Puts the trail saved on the on-air phone into the frozen archive.
//
//   node scripts/import-trail.mjs rorschach-trail.json [--from ISO] [--to ISO]
//
// The file comes from "Save the trail from this phone" on /onair. Only points
// inside the window are kept (default: parade night), so nothing recorded
// before or after the walk, like home, ends up on the map.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(root, 'public', 'archive-data.json');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const file = args[0];
if (!file || file.startsWith('--')) throw new Error('Usage: node scripts/import-trail.mjs rorschach-trail.json [--from ISO] [--to ISO]');
const from = Date.parse(opt('--from', '2026-10-31T12:00:00-04:00'));
const to = Date.parse(opt('--to', '2026-11-01T06:00:00-05:00'));

const exported = JSON.parse(await fs.readFile(file, 'utf8'));
const all = (exported.points || []).filter((p) => Array.isArray(p) && p.length === 4 && p.every(Number.isFinite));
const points = all.filter(([t]) => t >= from && t <= to).sort((a, b) => a[0] - b[0]);

let data = { entries: [] };
try { data = JSON.parse(await fs.readFile(DATA, 'utf8')); } catch {}
data.trail = { sharing: false, points };
await fs.writeFile(DATA, JSON.stringify(data, null, 1));

const ny = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
console.log(`Kept ${points.length} of ${all.length} points${points.length ? `, ${ny(points[0][0])} to ${ny(points[points.length - 1][0])} New York time` : ''}.`);
const gaps = points.slice(1).map((p, i) => [points[i][0], p[0]]).filter(([a, b]) => b - a > 5 * 60_000);
for (const [a, b] of gaps) console.log(`Gap with no points: ${ny(a)} to ${ny(b)} (screen probably locked).`);
console.log(`Wrote the trail into ${path.relative(root, DATA)}.`);
