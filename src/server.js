// HTTP endpoints:
//   GET  /healthz                 liveness
//   POST /gmail/push              Pub/Sub push from Gmail watch      (Google OIDC)
//   POST /tasks/renew-watch       daily watch renewal, Cloud Scheduler (Google OIDC)
//   POST /tasks/sweep             periodic safety sweep, Cloud Scheduler (Google OIDC)
//   POST /servicenow/send-reply   called by the ServiceNow flow       (Basic auth)
import http from 'node:http';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { requireGoogleOidc, requireBasicAuth } from './auth.js';
import { requestIngest } from './ingest.js';
import { sendReplyForCase } from './reply.js';
import { startWatch } from './gmail.js';

const MAX_BODY = 1024 * 1024;
const googleCaller = { audience: config.publicUrl, allowedEmails: config.google.allowedInvokers };

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

function send(res, status, payload) {
  if (payload === undefined) { res.writeHead(status).end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
}

export async function renewWatch() {
  if (!config.google.pubsubTopic) throw new Error('GMAIL_PUBSUB_TOPIC is not configured');
  const result = await startWatch(config.google.pubsubTopic);
  console.log(`[watch] active until ${result.expiresAt.toISOString()} (historyId ${result.historyId})`);
  return result;
}

const routes = {
  'GET /healthz': async () => [200, { ok: true }],

  'POST /gmail/push': async (req) => {
    await requireGoogleOidc(req, googleCaller);
    const body = await readJson(req);
    const data = body.message?.data
      ? JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8'))
      : {};
    console.log(`[push] mailbox change for ${data.emailAddress ?? '?'} (historyId ${data.historyId ?? '?'})`);
    // Responding only after ingest finishes means a failure returns 500 and Pub/Sub redelivers
    await requestIngest();
    return [204];
  },

  'POST /tasks/renew-watch': async (req) => {
    await requireGoogleOidc(req, googleCaller);
    const r = await renewWatch();
    return [200, { expires_at: r.expiresAt.toISOString() }];
  },

  'POST /tasks/sweep': async (req) => {
    await requireGoogleOidc(req, googleCaller);
    await requestIngest();
    return [204];
  },

  'POST /servicenow/send-reply': async (req) => {
    requireBasicAuth(req, config.bridge.user, config.bridge.password);
    const { sys_id: sysId } = await readJson(req);
    return [200, await sendReplyForCase(sysId)];
  },
};

export function createServer() {
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const handler = routes[`${req.method} ${path}`];
    if (!handler) return send(res, 404, { error: 'Not found' });
    try {
      const [status, payload] = await handler(req);
      send(res, status, payload);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(`[http] ${req.method} ${path}:`, err);
      send(res, status, { error: err.message });
    }
  });
}
