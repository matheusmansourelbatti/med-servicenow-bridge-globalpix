import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkBasicAuth(header, user, password) {
  const match = /^Basic\s+(.+)$/i.exec(header || '');
  if (!match) return false;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  // Evaluate both comparisons so timing doesn't reveal which part was wrong
  const userOk = safeEqual(decoded.slice(0, sep), user);
  const passOk = safeEqual(decoded.slice(sep + 1), password);
  return userOk && passOk;
}
