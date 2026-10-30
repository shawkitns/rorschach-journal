// A living, mirror-symmetric inkblot drawn on a small canvas.
// The ink field is computed at low resolution, then scaled up 3x with smooth
// interpolation and a sharp threshold, which gives wet-looking ink edges.
// (This used to be a CSS blur + contrast filter, but phone browsers cache
// filtered canvases and showed a frozen blot.)
//
// createBlot(canvas, { seed, speed, energy }) returns { setEnergy(n), stop() }.
// energy (0..1) makes the ink spread: the on-air page feeds it audio levels.

function makeNoise(seed) {
  // Small 3D value-noise with smooth interpolation. Plenty for ink.
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = Float32Array.from({ length: 256 }, () => rand() * 2 - 1);
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const v = (x, y, z) => vals[perm[(perm[(perm[x & 255] + y) & 255] + z) & 255]];
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    return lerp(
      lerp(lerp(v(xi, yi, zi), v(xi + 1, yi, zi), xf), lerp(v(xi, yi + 1, zi), v(xi + 1, yi + 1, zi), xf), yf),
      lerp(lerp(v(xi, yi, zi + 1), v(xi + 1, yi, zi + 1), xf), lerp(v(xi, yi + 1, zi + 1), v(xi + 1, yi + 1, zi + 1), xf), yf),
      zf,
    );
  };
}

// In-place [1 4 6 4 1] blur, rows then columns, clamped at the borders.
function blur5(a, tmp, w, h) {
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -2; j <= 2; j++) s += a[y * w + Math.min(w - 1, Math.max(0, x + j))] * k[j + 2];
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -2; j <= 2; j++) s += tmp[Math.min(h - 1, Math.max(0, y + j)) * w + x] * k[j + 2];
      a[y * w + x] = s;
    }
  }
}

export function createBlot(canvas, opts = {}) {
  const W = 96, H = 120;            // low-res ink field
  const S = 3;                      // drawn at 3x: 288 x 360
  const OW = W * S, OH = H * S;
  canvas.width = OW;
  canvas.height = OH;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(OW, OH);
  const field = new Float32Array(W * H), tmp = new Float32Array(W * H);
  const noise = makeNoise(opts.seed ?? Math.floor(Math.random() * 1e9));
  const ink = opts.ink || [0, 0, 0];
  const paper = opts.paper || [245, 240, 226];   // matches the plate (--paper)
  const speed = opts.speed ?? 0.12;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Which two field cells each output column/row sits between, and how far.
  const axis = (n, max) => Array.from({ length: n }, (_, o) => {
    const p = Math.min(max - 1, Math.max(0, (o + 0.5) / S - 0.5));
    const i = Math.min(max - 2, Math.floor(p));
    return [i, p - i];
  });
  const cols = axis(OW, W), rows = axis(OH, H);

  let energy = 0, target = 0, t = Math.random() * 100, raf = 0, last = performance.now();

  function frame(now) {
    // The ink drifts slowly, so 30 fps looks the same as 60 at half the work (and battery).
    if (!reduced && now - last < 30) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    energy += (target - energy) * Math.min(1, dt * 8);
    t += dt * speed * (1 + energy * 3);
    const half = W / 2;
    for (let y = 0; y < H; y++) {
      const ny = (y - H * 0.5) / (H * 0.5);
      for (let x = 0; x < half; x++) {
        const nx = (half - x) / half;             // 0 at the fold, 1 at the edge
        // Ink pools near the fold and the vertical middle.
        const fall = 1 - Math.hypot(nx * 0.95, ny * 0.85) * (1.05 - energy * 0.25);
        const n =
          noise(nx * 2.2, ny * 2.6, t) * 0.65 +
          noise(nx * 5.1 + 10, ny * 5.4, t * 1.7) * 0.28 +
          noise(nx * 11, ny * 11 + 5, t * 2.3) * 0.12;
        // Keep a clean margin of card around the ink so it never touches the edge.
        const edge = Math.max(nx - 0.82, Math.abs(ny) - 0.86, 0) * 6;
        const f = fall * 0.85 + n * 0.95 - 0.26 - edge;
        // Ink coverage 0..1, mirrored across the fold.
        field[y * W + x] = field[y * W + W - 1 - x] = Math.min(1, Math.max(0, f * 6));
      }
    }
    // Soften the coverage a little (what the old CSS blur did), so the
    // threshold below gives round, wet edges instead of blocky ones.
    blur5(field, tmp, W, H);
    // Scale up smoothly, then threshold at half coverage with a 1-2px soft edge.
    const d = img.data;
    let i = 0;
    for (let oy = 0; oy < OH; oy++) {
      const [y0, ty] = rows[oy];
      const r0 = y0 * W, r1 = r0 + W;
      for (let ox = 0; ox < OW; ox++) {
        const [x0, tx] = cols[ox];
        const top = field[r0 + x0] + (field[r0 + x0 + 1] - field[r0 + x0]) * tx;
        const bot = field[r1 + x0] + (field[r1 + x0 + 1] - field[r1 + x0]) * tx;
        const f = top + (bot - top) * ty;
        const a = Math.min(1, Math.max(0, (f - 0.5) * 9 + 0.5));
        d[i] = paper[0] + (ink[0] - paper[0]) * a;
        d[i + 1] = paper[1] + (ink[1] - paper[1]) * a;
        d[i + 2] = paper[2] + (ink[2] - paper[2]) * a;
        d[i + 3] = 255;
        i += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (!reduced) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setEnergy(n) {
      target = Math.max(0, Math.min(1, n));
      if (reduced) { energy = target; requestAnimationFrame(frame); }
    },
    stop() { cancelAnimationFrame(raf); },
  };
}
