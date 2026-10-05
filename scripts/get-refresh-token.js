// One-time helper: you log in to Google in your browser and it prints a refresh token.
// Runs only on your machine; the token goes into your own .env file.
import 'dotenv/config';
import http from 'node:http';
import { google } from 'googleapis';

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT);
const url = client.generateAuthUrl({
  access_type: 'offline', // ask for a refresh token
  prompt: 'consent',      // force Google to return it even if you consented before
  scope: ['https://www.googleapis.com/auth/gmail.modify'], // read, label and send; no permanent delete
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
  try {
    const { tokens } = await client.getToken(u.searchParams.get('code'));
    res.end('Done. You can close this tab and go back to the terminal.');
    console.log(`\nAdd this line to your .env:\n\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    res.end('Failed, check the terminal.');
    console.error(err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => console.log(`Open this URL in your browser and log in:\n\n${url}\n`));
