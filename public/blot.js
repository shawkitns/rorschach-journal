// A living, mirror-symmetric inkblot drawn on a small canvas.
// The canvas is rendered at low resolution, then CSS blur + contrast turns
// the pixels into smooth, wet-looking ink edges.
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

export function createBlot(canvas, opts = {}) {
  const W = 96, H = 120;            // low-res field; CSS scales it up
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const noise = makeNoise(opts.seed ?? Math.floor(Math.random() * 1e9));
  const ink = opts.ink || [0, 0, 0];
  const paper = opts.paper || [237, 238, 232];
  const speed = opts.speed ?? 0.12;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let energy = 0, target = 0, t = Math.random() * 100, raf = 0, last = performance.now();

  function frame(now) {
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
        const a = f > 0 ? Math.min(1, f * 6) : 0;
        const r = paper[0] + (ink[0] - paper[0]) * a;
        const g = paper[1] + (ink[1] - paper[1]) * a;
        const b = paper[2] + (ink[2] - paper[2]) * a;
        for (const px of [x, W - 1 - x]) {        // mirror across the fold
          const i = (y * W + px) * 4;
          img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
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
