import crypto from 'node:crypto';

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

// Best-effort per-person limit. Vercel may run several copies of a function,
// so this is a speed bump, not a wall; the daily cap is the hard limit.
const hits = new Map();
// Default 6/minute: phones on the same cell network or party Wi-Fi can share an IP.
export function rateLimited(ip, max = Number(process.env.RATE_PER_MINUTE || 6), windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > max;
}

export function isAdmin(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 8) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function submissionsOpen() {
  return String(process.env.SUBMISSIONS_OPEN ?? 'true').toLowerCase() !== 'false';
}
