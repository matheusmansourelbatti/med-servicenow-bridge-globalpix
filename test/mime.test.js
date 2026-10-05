import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReplyMime, replySubject, encodeHeader } from '../src/mime.js';

test('builds a threaded reply with attachments', () => {
  const raw = buildReplyMime({
    from: 'me@gmail.com',
    to: 'med@partner.com',
    subject: 'Re: Notificação MED',
    inReplyTo: '<abc@partner.com>',
    references: '<root@partner.com>',
    text: 'Justificativa: entrega confirmada.',
    attachments: [{ filename: 'comprovante entrega.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-fake') }],
  }).toString();

  assert.match(raw, /In-Reply-To: <abc@partner\.com>/);
  assert.match(raw, /References: <root@partner\.com> <abc@partner\.com>/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /filename\*=UTF-8''comprovante%20entrega\.pdf/);
  assert.ok(raw.includes(Buffer.from('Justificativa: entrega confirmada.').toString('base64')));
  assert.match(raw, /--med_[a-f0-9]+--\r\n$/);
});

test('reply subject is not double-prefixed', () => {
  assert.equal(replySubject('MED 123'), 'Re: MED 123');
  assert.equal(replySubject('RE: MED 123'), 'RE: MED 123');
});

test('ascii headers stay readable', () => {
  assert.equal(encodeHeader('Re: MED'), 'Re: MED');
});
