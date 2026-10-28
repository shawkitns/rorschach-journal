// Storage for journal entries.
// On Vercel this uses Vercel Blob. For local testing (LOCAL_STORE_DIR set),
// it writes plain files to disk instead so you can try everything offline.
//
// Layout:
//   entries/<sortKey>.json   one entry (text, name, timestamp, audio URL)
//   audio/<id>.mp3           the spoken entry
//   hidden/<id>              marker file = entry hidden by the admin
//
// sortKey is "inverted time" so that a plain alphabetical listing returns
// the newest entries first.

import fs from 'node:fs/promises';
import path from 'node:path';

const LOCAL = process.env.LOCAL_STORE_DIR;

const MAX_TS = 9_999_999_999_999;
export function makeId() {
  const inverted = String(MAX_TS - Date.now()).padStart(13, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${inverted}-${rand}`;
}

// ---------- low-level put/list/delete ----------

async function blob() {
  return import('@vercel/blob');
}

async function putFile(pathname, body, contentType) {
  if (LOCAL) {
    const full = path.join(LOCAL, pathname);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    return { url: `/_local/${pathname}` };
  }
  const { put } = await blob();
  return put(pathname, body, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

async function listFiles(prefix, limit = 1000) {
  if (LOCAL) {
    const dir = path.join(LOCAL, prefix);
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    names.sort();
    return Promise.all(
      names.slice(0, limit).map(async (n) => {
        const stat = await fs.stat(path.join(dir, n));
        return {
          pathname: `${prefix}${n}`,
          url: `/_local/${prefix}${n}`,
          uploadedAt: stat.mtime,
        };
      }),
    );
  }
  const { list } = await blob();
  const out = [];
  let cursor;
  do {
    const res = await list({ prefix, limit: Math.min(1000, limit - out.length), cursor });
    out.push(...res.blobs);
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor && out.length < limit);
  return out.sort((a, b) => (a.pathname < b.pathname ? -1 : 1));
}

async function deleteFile(pathname, url) {
  if (LOCAL) {
    await fs.rm(path.join(LOCAL, pathname), { force: true });
    return;
  }
  const { del } = await blob();
  await del(url);
}

async function readJson(file) {
  if (LOCAL) {
    const raw = await fs.readFile(path.join(LOCAL, file.pathname), 'utf8');
    return JSON.parse(raw);
  }
  const res = await fetch(file.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read ${file.pathname}`);
  return res.json();
}

// ---------- entries API ----------

export async function saveAudio(id, buffer, contentType = 'audio/mpeg') {
  const ext = contentType.includes('wav') ? 'wav' : 'mp3';
  const res = await putFile(`audio/${id}.${ext}`, buffer, contentType);
  return res.url;
}

export async function saveEntry(entry) {
  await putFile(`entries/${entry.id}.json`, JSON.stringify(entry), 'application/json');
  return entry;
}

async function hiddenIds() {
  const files = await listFiles('hidden/');
  return new Set(files.map((f) => f.pathname.slice('hidden/'.length)));
}

export async function setHidden(id, hidden) {
  if (!/^[0-9a-z-]+$/.test(id)) throw new Error('Bad id');
  if (hidden) {
    await putFile(`hidden/${id}`, '1', 'text/plain');
  } else {
    const files = await listFiles(`hidden/${id}`);
    await Promise.all(files.map((f) => deleteFile(f.pathname, f.url)));
  }
}

// Newest first. includeHidden is for the admin page only.
export async function listEntries({ limit = 40, includeHidden = false } = {}) {
  const [files, hidden] = await Promise.all([
    listFiles('entries/', includeHidden ? limit : limit + 50),
    hiddenIds(),
  ]);
  const wanted = files
    .filter((f) => f.pathname.endsWith('.json'))
    .filter((f) => includeHidden || !hidden.has(f.pathname.slice(8, -5)))
    .slice(0, limit);
  const entries = await Promise.all(
    wanted.map((f) => readJson(f).catch(() => null)),
  );
  return entries
    .filter(Boolean)
    .map((e) => ({ ...e, hidden: hidden.has(e.id) }));
}

// How many entries were created since local midnight (rough daily budget guard).
export async function countEntriesSince(date) {
  const files = await listFiles('entries/', 2000);
  return files.filter((f) => new Date(f.uploadedAt) >= date).length;
}
