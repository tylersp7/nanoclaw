import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function setupLinkedInSession() {
  console.log('Opening browser for LinkedIn login...');

  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.linkedin.com/feed/');

  console.log('\n=================================');
  console.log('Please log in to LinkedIn now...');
  console.log('After logging in, press Enter here');
  console.log('=================================\n');

  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });

  const sessionDir = path.join(os.homedir(), '.nanoclaw-linkedin');
  const sessionFile = path.join(sessionDir, 'session.json');

  const cookies = await context.cookies();
  const session = {
    cookies,
    userAgent: await page.evaluate(() => navigator.userAgent),
    savedAt: new Date().toISOString(),
  };

  fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  fs.chmodSync(sessionFile, 0o600);

  console.log('\nSession saved to:', sessionFile);
  console.log('You can now close the browser.\n');

  await browser.close();
}

setupLinkedInSession().catch(console.error);
