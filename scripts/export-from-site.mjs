// Copies everything the live site saved in Blob to this computer, read-only:
// every entry (hidden ones too, marked), its audio, and the trail.
//
//   node --env-file=.env scripts/export-from-site.mjs [https://your-site.vercel.app]
//
// Writes backup/entries.json, backup/trail.json and backup/audio/*.mp3.
// Uses only GET requests with ADMIN_TOKEN; nothing on the site changes.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = (process.argv[2] || 'https://rorschach-journal.vercel.app').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error('ADMIN_TOKEN is missing from .env');

const out = path.join(root, 'backup');
await fs.mkdir(path.join(out, 'audio'), { recursive: true });

const get = async (p, auth = false) => {
  const res = await fetch(site + p, { headers: auth ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${p}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

const { entries } = await get('/api/entries?all=1&limit=100', true);
const trail = await get('/api/trail');

let audio = 0;
for (const e of entries) {
  if (!e.audioUrl) continue;
  const file = path.join(out, 'audio', `${e.id}.mp3`);
  try { await fs.access(file); continue; } catch {}
  const url = e.audioUrl.startsWith('http') ? e.audioUrl : site + e.audioUrl;
  const res = await fetch(url);
  if (!res.ok) { console.warn(`Audio for ${e.id} failed: ${res.status}`); continue; }
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  audio++;
}

await fs.writeFile(path.join(out, 'entries.json'), JSON.stringify(entries, null, 1));
await fs.writeFile(path.join(out, 'trail.json'), JSON.stringify(trail, null, 1));

const ny = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
console.log(`Saved ${entries.length} entries (${entries.filter((e) => e.hidden).length} hidden), ${audio} new audio files, ${trail.points?.length || 0} trail points to backup/.`);
for (const e of entries.slice().reverse()) {
  console.log(`${ny(e.createdAt)}${e.hidden ? '  [HIDDEN]' : ''}${e.audioUrl ? '' : '  [no audio]'}  ${e.line.slice(0, 80)}`);
}
