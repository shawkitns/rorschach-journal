// Local test server: `npm run dev` then open http://localhost:3000
// Stores entries in ./.local-store instead of Vercel Blob.
// Set MOCK_TTS=1 to skip ElevenLabs (plays a hum instead) and leave
// ANTHROPIC_API_KEY empty to use the built-in templates.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
// Vercel injects env vars in production; locally, read them from .env.
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
process.env.LOCAL_STORE_DIR ||= path.join(root, '.local-store');

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function addHelpers(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  return res;
}

const server = http.createServer(async (req, res) => {
  addHelpers(res);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
      const mod = await import(path.join(root, 'api', `${name}.js`));
      let raw = '';
      for await (const chunk of req) raw += chunk;
      req.body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : raw;
      return await mod.default(req, res);
    }
    let file;
    if (url.pathname.startsWith('/_local/')) {
      file = path.join(process.env.LOCAL_STORE_DIR, url.pathname.slice(8));
    } else {
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      if (!path.extname(p)) p += '.html';
      file = path.join(root, 'public', p);
    }
    const data = await fs.readFile(file);
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') { res.statusCode = 404; return res.end('Not found'); }
    console.error(err);
    res.statusCode = 500;
    res.end('Server error');
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`Rorschach journal running at http://localhost:${port}`));
