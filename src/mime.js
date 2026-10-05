// Builds a raw RFC 2822 email (with attachments) that Gmail's API can send.
// Pure function: no network. The threading headers make it a real reply.
import { randomUUID } from 'node:crypto';

const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);

export function encodeHeader(value) {
  return isAscii(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function replySubject(subject = '') {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

const wrap76 = (b64) => b64.replace(/.{76}/g, '$&\r\n');

export function buildReplyMime({ from, to, subject, inReplyTo, references, text, attachments = [] }) {
  const boundary = `med_${randomUUID().replace(/-/g, '')}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${[references, inReplyTo].filter(Boolean).join(' ')}`);
  }
  lines.push(
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text, 'utf8').toString('base64')),
  );
  for (const file of attachments) {
    const asciiName = file.filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '') || 'attachment';
    lines.push(
      `--${boundary}`,
      `Content-Type: ${file.contentType || 'application/octet-stream'}; name="${asciiName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      '',
      wrap76(file.content.toString('base64')),
    );
  }
  lines.push(`--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8');
}
