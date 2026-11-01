// Builds public/map-streets.json: the real streets, parks and water around the
// parade route (Sixth Avenue, Canal St to 15th St) from OpenStreetMap, so the
// archive map can draw them itself in ink. Run once; the result is committed.
//
//   node scripts/build-map.mjs              fetch from Overpass and build
//   node scripts/build-map.mjs raw.json     build from a saved Overpass response

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BBOX = [40.715, -74.014, 40.7445, -73.988];   // south, west, north, east
const PAD = 0.002;
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const KIND = {
  motorway: 'major', trunk: 'major', primary: 'major',
  secondary: 'mid', tertiary: 'mid',
  residential: 'minor', unclassified: 'minor', living_street: 'minor',
  pedestrian: 'path',
};

// Labels snap to the nearest point of the named street to an anchor, so they sit
// exactly on it. Anchors are rough: east of Sixth Ave for cross streets, so the
// route itself stays clear.
const LABELS = [
  ['6th Ave', '6th Avenue', [40.7262, -74.0031]],
  ['6th Ave', '6th Avenue', [40.7352, -73.9983]],
  ['Canal St', 'Canal Street', [40.7206, -74.0018]],
  ['Spring St', 'Spring Street', [40.7253, -74.0007]],
  ['W Houston St', 'West Houston Street', [40.7283, -73.9998]],
  ['Bleecker St', 'Bleecker Street', [40.7290, -73.9990]],
  ['W 8th St', 'West 8th Street', [40.7334, -73.9975]],
  ['W 14th St', 'West 14th Street', [40.7371, -73.9940]],
  ['W 15th St', 'West 15th Street', [40.7395, -74.0005]],
  ['Broadway', 'Broadway', [40.7262, -73.9978]],
  ['7th Ave S', '7th Avenue South', [40.7308, -74.0040]],
  ['Hudson St', 'Hudson Street', [40.7268, -74.0078]],
  ['Washington Sq Park', 'Washington Square Park', null],
];

const QUERY = `[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"](${BBOX});
  way["leisure"="park"](${BBOX});
  way["natural"="water"](${BBOX});
);
out geom tags;`;

async function fetchOsm() {
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'rorschach-journal map build' },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) return res.json();
      console.warn(`${url}: ${res.status}`);
    } catch (err) {
      console.warn(`${url}: ${err.message}`);
    }
  }
  throw new Error('Every Overpass mirror failed. Try again in a few minutes.');
}

const inside = ([lat, lng]) =>
  lat >= BBOX[0] - PAD && lat <= BBOX[2] + PAD && lng >= BBOX[1] - PAD && lng <= BBOX[3] + PAD;

// Splits a street into the runs that fall inside the padded box, keeping one point past each edge.
function clip(coords) {
  const runs = [];
  let run = [];
  coords.forEach((p, i) => {
    const keep = inside(p) || (coords[i - 1] && inside(coords[i - 1])) || (coords[i + 1] && inside(coords[i + 1]));
    if (keep) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  });
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

// Douglas-Peucker in metres: drops points that don't change the shape by more than `tol`.
function simplify(coords, tol = 0.8) {
  if (coords.length < 3) return coords;
  const k = Math.cos((coords[0][0] * Math.PI) / 180);
  const xy = coords.map(([lat, lng]) => [lng * 111320 * k, lat * 110540]);
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - xy[i][1]) - (ax - xy[i][0]) * (by - ay)) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return coords.filter((_, i) => keep[i]);
}

const raw = process.argv[2] ? JSON.parse(await fs.readFile(process.argv[2], 'utf8')) : await fetchOsm();
const origin = [BBOX[0], BBOX[1]];
const pack = (coords) => coords.flatMap(([lat, lng]) => [Math.round((lat - origin[0]) * 1e5), Math.round((lng - origin[1]) * 1e5)]);

const features = [];
const named = new Map();
for (const el of raw.elements || []) {
  if (el.type !== 'way' || !el.geometry) continue;
  const coords = el.geometry.map((g) => [g.lat, g.lon]);
  const t = el.tags || {};
  const kind = KIND[t.highway] || (t.leisure === 'park' ? 'park' : t.natural === 'water' ? 'water' : null);
  if (!kind) continue;
  if (t.name) named.set(t.name, (named.get(t.name) || []).concat(coords));
  if (kind === 'park' || kind === 'water') {
    // A closed ring starts and ends on the same point, which Douglas-Peucker can't
    // measure against, so simplify it in two halves.
    const mid = Math.floor(coords.length / 2);
    const ring = simplify(coords.slice(0, mid + 1)).concat(simplify(coords.slice(mid)).slice(1));
    if (coords.some(inside)) features.push({ k: kind, c: pack(ring) });
  } else {
    for (const run of clip(coords)) features.push({ k: kind, c: pack(simplify(run)) });
  }
}

const labels = [];
for (const [text, name, anchor] of LABELS) {
  const pts = named.get(name);
  if (!pts) { console.warn(`No street named "${name}" in the data; skipping its label.`); continue; }
  let at;
  if (!anchor) {
    at = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  } else {
    at = pts.reduce((best, p) => (Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) < Math.hypot(best[0] - anchor[0], best[1] - anchor[1]) ? p : best));
  }
  labels.push({ text, at: at.map((n) => Math.round(n * 1e5) / 1e5) });
}

// The parade route: Sixth Avenue's own centre line, chained segment to segment
// northwards, cut where it crosses Canal St and W 15th St.
function paradeRoute() {
  const ways = (raw.elements || []).filter((el) =>
    el.tags?.name === '6th Avenue' && ['trunk', 'primary', 'secondary'].includes(el.tags.highway) && el.geometry);
  const key = (g) => `${g.lat},${g.lon}`;
  const byStart = new Map(ways.map((w) => [key(w.geometry[0]), w]));
  const ends = new Set(ways.map((w) => key(w.geometry[w.geometry.length - 1])));
  let way = ways.find((w) => !ends.has(key(w.geometry[0])));
  const line = [];
  while (way) {
    line.push(...way.geometry.slice(line.length ? 1 : 0).map((g) => [g.lat, g.lon]));
    way = byStart.get(key(way.geometry[way.geometry.length - 1]));
  }
  const nearestTo = (street) => {
    const pts = named.get(street) || [];
    let best = 0, bestD = Infinity;
    line.forEach(([lat, lng], i) => {
      for (const [a, b] of pts) {
        const d = Math.hypot(lat - a, lng - b);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return best;
  };
  const [a, b] = [nearestTo('Canal Street'), nearestTo('West 15th Street')].sort((x, y) => x - y);
  return line.slice(a, b + 1);
}
const route = paradeRoute();

// Paint order: water and parks under the streets, small streets under big ones.
const ORDER = ['water', 'park', 'path', 'minor', 'mid', 'major'];
features.sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k));

const out = {
  attribution: '© OpenStreetMap contributors (ODbL)',
  bbox: BBOX,
  origin,
  scale: 1e5,
  features,
  labels,
  route: pack(route),
};
const file = path.join(root, 'public', 'map-streets.json');
await fs.writeFile(file, JSON.stringify(out));
console.log(`Wrote ${path.relative(root, file)}: ${features.length} shapes, ${labels.length} labels, parade route of ${route.length} points from ${route[0]} to ${route[route.length - 1]}, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
