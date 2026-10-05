// Pure functions: no network, no config. Easy to unit test.
// The regexes are guesses at the notification format. Adjust them to the real emails.

// Pix end-to-end ID: "E" + 8-digit ISPB + yyyyMMddHHmm + 11 alphanumerics = 32 chars
const E2E_RE = /\bE\d{20}[A-Za-z0-9]{11}\b/;
const DATE_PART = String.raw`(\d{2})\/(\d{2})\/(\d{4})(?:[^\d\n]{0,10}(\d{2}):(\d{2}))?`;
const LABELED_DATE_RE = new RegExp(
  String.raw`data\s+(?:da\s+)?(?:transa[cç][aã]o|opera[cç][aã]o)\s*[:\-]?\s*` + DATE_PART, 'i');
const ANY_DATE_RE = new RegExp(DATE_PART);

export function parseBRL(value) {
  if (!value) return null;
  const n = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// São Paulo is UTC-3 with no daylight saving time since 2019
export function brtToUtc(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
}

export function parseMedEmail(text) {
  const dm = LABELED_DATE_RE.exec(text) || ANY_DATE_RE.exec(text);
  return {
    e2eId: E2E_RE.exec(text)?.[0] ?? null,
    amount: parseBRL(/R\$\s*([\d.]+,\d{2})/.exec(text)?.[1]),
    transactionDate: dm ? brtToUtc(+dm[3], +dm[2], +dm[1], +(dm[4] ?? 0), +(dm[5] ?? 0)) : null,
    reason: /(?:motivo|reason)\s*[:\-]\s*(.+)/i.exec(text)?.[1]?.trim() ?? null,
    protocol: /protocolo\s*(?:n[º°o.]*)?\s*[:#\-]?\s*([A-Za-z0-9][\w\-]{3,})/i.exec(text)?.[1] ?? null,
  };
}

export function htmlToText(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// ServiceNow's Table API expects date/times as "YYYY-MM-DD HH:mm:ss" in UTC
export function toSnDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}
