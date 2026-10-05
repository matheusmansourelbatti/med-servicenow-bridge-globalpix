// Gmail API client, authenticated as you via your own OAuth refresh token.
import { google } from 'googleapis';
import { config } from './config.js';
import { htmlToText } from './parser.js';

const auth = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret);
auth.setCredentials({ refresh_token: config.google.refreshToken });
const gmail = google.gmail({ version: 'v1', auth });

let myAddress;
export async function getMyAddress() {
  if (!myAddress) myAddress = (await gmail.users.getProfile({ userId: 'me' })).data.emailAddress;
  return myAddress;
}

let labelId;
export async function ensureLabel(name) {
  if (labelId) return labelId;
  const { data } = await gmail.users.labels.list({ userId: 'me' });
  const found = data.labels?.find((l) => l.name === name);
  if (found) return (labelId = found.id);
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  return (labelId = created.data.id);
}

// Ask Gmail to publish to Pub/Sub whenever the inbox changes.
// A watch expires after 7 days, so it is renewed daily.
export async function startWatch(topicName) {
  const { data } = await gmail.users.watch({
    userId: 'me',
    requestBody: { topicName, labelIds: ['INBOX'] },
  });
  return { historyId: data.historyId, expiresAt: new Date(Number(data.expiration)) };
}

export async function listMessageIds(query) {
  const ids = [];
  let pageToken;
  do {
    const { data } = await gmail.users.messages.list({ userId: 'me', q: query, pageToken, maxResults: 100 });
    for (const m of data.messages ?? []) ids.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

export async function getMessage(id) {
  const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const headers = {};
  for (const h of data.payload.headers ?? []) headers[h.name.toLowerCase()] ??= h.value;
  return {
    id: data.id,
    threadId: data.threadId,
    receivedAt: new Date(Number(data.internalDate)),
    headers,
    body: extractText(data.payload),
  };
}

// The full original email (.eml), kept on the case as an exact copy
export async function getRawMessage(id) {
  const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'raw' });
  return Buffer.from(data.raw, 'base64url');
}

export async function addLabel(messageId, label) {
  await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds: [label] } });
}

// threadId keeps the reply in the same Gmail conversation
export async function sendRaw(mimeBuffer, threadId) {
  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: mimeBuffer.toString('base64url'), threadId },
  });
  return data;
}

function findPart(part, mimeType) {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodePart(part) {
  const contentType = (part.headers ?? []).find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
  const charset = /charset="?([^";]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8';
  const encoding = /iso-8859-1|latin1|windows-1252/.test(charset) ? 'latin1' : 'utf8';
  return Buffer.from(part.body.data, 'base64url').toString(encoding);
}

function extractText(payload) {
  const plain = findPart(payload, 'text/plain');
  if (plain) return decodePart(plain);
  const html = findPart(payload, 'text/html');
  return html ? htmlToText(decodePart(html)) : '';
}
