const UNIT = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
const MIN = 30 * 1000; // 30 seconds
const MAX = 30 * 86400000; // 30 days

/** "90m", "1h30m", "2d", "1 d 12 h" -> milliseconds (or null if invalid / out of range) */
function parseDuration(text) {
  const t = String(text ?? '').toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+(\.\d+)?[smhdw])+$/.test(t)) return null;
  let ms = 0;
  for (const [, n, u] of t.matchAll(/(\d+(?:\.\d+)?)([smhdw])/g)) ms += parseFloat(n) * UNIT[u];
  ms = Math.round(ms);
  return ms >= MIN && ms <= MAX ? ms : null;
}

/** 3725000 -> "1h 2m" (two most significant units) */
function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const parts = [
    ['d', Math.floor(total / 86400)],
    ['h', Math.floor((total % 86400) / 3600)],
    ['m', Math.floor((total % 3600) / 60)],
    ['s', total % 60],
  ].filter(([, v]) => v > 0);
  return parts.slice(0, 2).map(([u, v]) => `${v}${u}`).join(' ');
}

module.exports = { parseDuration, formatDuration, MIN, MAX };
