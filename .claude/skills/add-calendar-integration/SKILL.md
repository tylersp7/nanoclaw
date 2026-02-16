---
name: add-calendar-integration
description: Google Calendar integration for client scheduling, deadline tracking, and deep work time blocking. Andy can check availability, schedule meetings, send calendar invites, and remind you of important deadlines with project context.
---

# Add Calendar Integration

Integrate Google Calendar for professional client scheduling and deadline management. Andy can check your availability, schedule meetings, block work time, and send smart reminders.

## What It Does

**Client Scheduling:**
- Check your availability
- Propose meeting times
- Send calendar invites
- Handle rescheduling

**Deadline Management:**
- Track project deadlines
- Milestone reminders
- Buffer time before deadlines
- Context-aware notifications

**Time Blocking:**
- Block deep work time
- Prevent meeting overload
- Optimize your schedule
- Work/life balance

---

## Installation

### 1. Enable Google Calendar API

**USER ACTION REQUIRED**

Tell the user:

> We need to enable the Google Calendar API:
>
> 1. Go to https://console.cloud.google.com/
> 2. Select your project (or create new)
> 3. Click **APIs & Services** → **Library**
> 4. Search for "Google Calendar API"
> 5. Click **Enable**

### 2. Create OAuth Credentials

> 6. Go to **APIs & Services** → **Credentials**
> 7. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
> 8. If prompted, configure consent screen:
>    - User Type: External
>    - App name: "NanoClaw Calendar"
>    - Your email
>    - Save
> 9. Application type: **Desktop app**
> 10. Name: "NanoClaw"
> 11. Click **Create**
> 12. Download the JSON file

### 3. Save Credentials

```bash
mkdir -p ~/.nanoclaw-calendar
chmod 700 ~/.nanoclaw-calendar
```

Move the downloaded file:

```bash
mv ~/Downloads/client_secret_*.json ~/.nanoclaw-calendar/credentials.json
chmod 600 ~/.nanoclaw-calendar/credentials.json
```

### 4. Install Google APIs

```bash
cd /Users/tyler/dev/nanoclaw
npm install googleapis@105 open
```

### 5. Initial Authentication

Create auth script:

```bash
cat > /Users/tyler/dev/nanoclaw/scripts/calendar-auth.js << 'EOF'
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
const open = require('open');
const http = require('http');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const REDIRECT_PORT = 3000;

async function authenticate() {
  const credPath = path.join(os.homedir(), '.nanoclaw-calendar', 'credentials.json');
  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

  const { client_secret, client_id } = credentials.installed || credentials.web;
  const redirectUri = \`http://localhost:\${REDIRECT_PORT}\`;

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Opening browser for authentication...');
  await open(authUrl);

  // Start local server to receive the callback
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

          console.log('\\n✅ Authentication successful!');
          console.log('Token saved to:', tokenPath);
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(\`Waiting for authentication on http://localhost:\${REDIRECT_PORT}...\`);
    });
  });
}

authenticate().catch(console.error);
EOF

chmod +x /Users/tyler/dev/nanoclaw/scripts/calendar-auth.js
```

Run authentication:

```bash
cd /Users/tyler/dev/nanoclaw
node scripts/calendar-auth.js
```

---

## Implementation

### 6. Create Calendar Helper

```typescript
// src/calendar-helper.ts
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';

let calendarClient: any = null;

function loadCredentials() {
  const credPath = path.join(os.homedir(), '.nanoclaw-calendar', 'credentials.json');
  const tokenPath = path.join(os.homedir(), '.nanoclaw-calendar', 'token.json');

  if (!fs.existsSync(credPath) || !fs.existsSync(tokenPath)) {
    throw new Error('Calendar not authenticated. Run: node scripts/calendar-auth.js');
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

  const { client_secret, client_id } = credentials.installed || credentials.web;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(tokens);

  return oauth2Client;
}

function getCalendar() {
  if (calendarClient) return calendarClient;

  const auth = loadCredentials();
  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees?: string[];
  location?: string;
}

/**
 * Get events for a date range
 */
export async function getEvents(
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  const calendar = getCalendar();

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (response.data.items || []).map((event: any) => ({
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: event.start.dateTime || event.start.date,
    end: event.end.dateTime || event.end.date,
    attendees: event.attendees?.map((a: any) => a.email),
    location: event.location,
  }));
}

/**
 * Find available time slots
 */
export async function findAvailableSlots(
  date: Date,
  durationMinutes: number = 60,
  businessHoursOnly: boolean = true
): Promise<Array<{ start: Date; end: Date }>> {
  const startOfDay = new Date(date);
  startOfDay.setHours(businessHoursOnly ? 9 : 0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(businessHoursOnly ? 17 : 23, 59, 59, 999);

  const events = await getEvents(startOfDay, endOfDay);

  const slots: Array<{ start: Date; end: Date }> = [];
  let currentTime = startOfDay;

  for (const event of events) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    // Check if there's a slot before this event
    if (eventStart.getTime() - currentTime.getTime() >= durationMinutes * 60 * 1000) {
      slots.push({
        start: new Date(currentTime),
        end: new Date(Math.min(eventStart.getTime(), currentTime.getTime() + durationMinutes * 60 * 1000)),
      });
    }

    currentTime = eventEnd;
  }

  // Check for slot after last event
  if (endOfDay.getTime() - currentTime.getTime() >= durationMinutes * 60 * 1000) {
    slots.push({
      start: new Date(currentTime),
      end: new Date(currentTime.getTime() + durationMinutes * 60 * 1000),
    });
  }

  return slots;
}

/**
 * Create an event
 */
export async function createEvent(
  summary: string,
  start: Date,
  end: Date,
  options?: {
    description?: string;
    attendees?: string[];
    location?: string;
  }
): Promise<string> {
  const calendar = getCalendar();

  const event = {
    summary,
    description: options?.description,
    start: {
      dateTime: start.toISOString(),
    },
    end: {
      dateTime: end.toISOString(),
    },
    attendees: options?.attendees?.map(email => ({ email })),
    location: options?.location,
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
    sendUpdates: 'all', // Send invites
  });

  return response.data.htmlLink || '';
}

/**
 * Block time for deep work
 */
export async function blockDeepWorkTime(
  date: Date,
  hours: number,
  label: string = 'Deep Work'
): Promise<void> {
  const start = new Date(date);
  const end = new Date(date);
  end.setHours(end.getHours() + hours);

  await createEvent(label, start, end, {
    description: 'Blocked time for focused work - no meetings',
  });
}

/**
 * Get week summary
 */
export async function getWeekSummary(): Promise<string> {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  const events = await getEvents(startOfWeek, endOfWeek);

  // Group by day
  const byDay: { [key: string]: CalendarEvent[] } = {};

  for (const event of events) {
    const day = new Date(event.start).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(event);
  }

  let summary = '*THIS WEEK*\\n\\n';
  for (const [day, dayEvents] of Object.entries(byDay)) {
    summary += \`*\${day}* (\${dayEvents.length} events)\\n\`;
    dayEvents.slice(0, 3).forEach(event => {
      const time = new Date(event.start).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      summary += \`  \${time} - \${event.summary}\\n\`;
    });
    if (dayEvents.length > 3) {
      summary += \`  ... and \${dayEvents.length - 3} more\\n\`;
    }
    summary += '\\n';
  }

  return summary;
}

/**
 * Format availability for WhatsApp
 */
export function formatAvailability(slots: Array<{ start: Date; end: Date }>): string {
  if (slots.length === 0) return 'No availability found.';

  return slots
    .slice(0, 5)
    .map((slot, i) => {
      const day = slot.start.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const time = slot.start.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      return \`\${i + 1}. \${day} at \${time}\`;
    })
    .join('\\n');
}
```

Save to `src/calendar-helper.ts`.

---

## Usage Examples

### Check Availability

```
@Andy what's my availability tomorrow afternoon for a client call?
```

### Schedule Meeting

```
@Andy schedule a 1-hour call with client@example.com tomorrow at 2pm. Title: "n8n Project Kickoff"
```

### Week Overview

```
@Andy what does my week look like?
```

### Block Deep Work

```
@Andy block 4 hours tomorrow morning for deep work on the automation project
```

---

## Success Criteria

✅ Google Calendar API enabled
✅ OAuth credentials configured
✅ Can read events
✅ Can create events
✅ Can find available slots
✅ Can send calendar invites

---

Tell the user:

> Calendar integration ready! 🎉
>
> Andy can now:
> - Check your availability instantly
> - Schedule client meetings
> - Send calendar invites
> - Block deep work time
> - Weekly planning summaries
>
> Look more professional and never double-book again!
