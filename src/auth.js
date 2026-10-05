// Request authentication for the two kinds of callers:
//  - Google (Pub/Sub push, Cloud Scheduler): OIDC ID token signed by Google
//  - ServiceNow (Flow Designer REST step): HTTP Basic auth
import { OAuth2Client } from 'google-auth-library';
import { HttpError } from './errors.js';
import { checkBasicAuth } from './basic-auth.js';

const oidc = new OAuth2Client();

export function requireBasicAuth(req, user, password) {
  if (!checkBasicAuth(req.headers.authorization, user, password)) {
    throw new HttpError(401, 'Invalid credentials');
  }
}

export async function requireGoogleOidc(req, { audience, allowedEmails }) {
  if (!audience) throw new HttpError(500, 'PUBLIC_URL is not configured');
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'Missing bearer token');

  let payload;
  try {
    const ticket = await oidc.verifyIdToken({ idToken: match[1], audience });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Invalid Google ID token');
  }
  if (!payload?.email_verified || !allowedEmails.includes(payload.email)) {
    throw new HttpError(403, `Caller ${payload?.email ?? 'unknown'} is not allowed`);
  }
  return payload;
}
