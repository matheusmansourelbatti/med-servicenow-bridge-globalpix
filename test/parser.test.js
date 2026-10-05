import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMedEmail, parseBRL, htmlToText, toSnDateTime, addDays } from '../src/parser.js';

const sample = `Prezado cliente,
Foi registrada uma notificação MED contra uma transação recebida.
Protocolo: MED-2026-000123
ID da transação (E2E): E12345678202609151030AbCdEfGhIjK
Valor: R$ 1.234,56
Data da transação: 15/09/2026 às 10:30
Motivo: Fraude - golpe
Prazo para resposta: 18/09/2026`;

test('parses the main MED fields', () => {
  const r = parseMedEmail(sample);
  assert.equal(r.e2eId, 'E12345678202609151030AbCdEfGhIjK');
  assert.equal(r.amount, 1234.56);
  assert.equal(toSnDateTime(r.transactionDate), '2026-09-15 13:30:00'); // 10:30 BRT = 13:30 UTC
  assert.equal(r.reason, 'Fraude - golpe');
  assert.equal(r.protocol, 'MED-2026-000123');
});

test('missing fields come back as null', () => {
  const r = parseMedEmail('nothing useful here');
  assert.deepEqual(r, { e2eId: null, amount: null, transactionDate: null, reason: null, protocol: null });
});

test('parseBRL handles thousands separators', () => {
  assert.equal(parseBRL('12.345.678,90'), 12345678.9);
  assert.equal(parseBRL('0,50'), 0.5);
});

test('htmlToText strips tags and keeps line breaks', () => {
  assert.equal(htmlToText('<style>x{}</style><p>Valor: R$&nbsp;10,00</p><br>Motivo: teste'), 'Valor: R$ 10,00\nMotivo: teste');
});

test('addDays', () => {
  assert.equal(toSnDateTime(addDays(new Date('2026-10-05T12:00:00Z'), 3)), '2026-10-08 12:00:00');
});
