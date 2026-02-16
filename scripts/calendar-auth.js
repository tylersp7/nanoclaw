import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';
import open from 'open';
import http from 'http';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const REDIRECT_PORT = 3000;

async function authenticate() {
  const credPath = path.join(os.homedir(), '.nanoclaw-calendar', 'credentials.json');
  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

  const { client_secret, client_id } = credentials.installed || credentials.web;
  const redirectUri = `http://localhost:${REDIRECT_PORT}`;

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Opening browser for authentication...');
  await open(authUrl);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.url?.includes('code=')) {
        const code = new URL(req.url, redirectUri).searchParams.get('code');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication successful!</h1><p>You can close this window.</p>');

        server.close();

        try {
          const { tokens } = await oauth2Client.getToken(code);
          const tokenPath = path.join(os.homedir(), '.nanoclaw-calendar', 'token.json');
          fs.writeFileSync(tokenPath, JSON.stringify(tokens));
          fs.chmodSync(tokenPath, 0o600);

          console.log('\nAuthentication successful!');
          console.log('Token saved to:', tokenPath);
          resolve(undefined);
        } catch (error) {
          reject(error);
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Waiting for authentication on http://localhost:${REDIRECT_PORT}...`);
    });
  });
}

authenticate().catch(console.error);
