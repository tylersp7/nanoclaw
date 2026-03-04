import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';

let calendarClient: any = null;

function loadCredentials() {
  const credPath = path.join(
    os.homedir(),
    '.nanoclaw-calendar',
    'credentials.json',
  );
  const tokenPath = path.join(os.homedir(), '.nanoclaw-calendar', 'token.json');

  if (!fs.existsSync(credPath) || !fs.existsSync(tokenPath)) {
    throw new Error(
      'Calendar not authenticated. Run: node scripts/calendar-auth.js',
    );
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

  const { client_secret, client_id } = credentials.installed || credentials.web;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(tokens);

  // Auto-refresh token
  oauth2Client.on('tokens', (newTokens: any) => {
    const existing = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
    const merged = { ...existing, ...newTokens };
    fs.writeFileSync(tokenPath, JSON.stringify(merged));
  });

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
  endDate: Date,
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
  businessHoursOnly: boolean = true,
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

    if (
      eventStart.getTime() - currentTime.getTime() >=
      durationMinutes * 60 * 1000
    ) {
      slots.push({
        start: new Date(currentTime),
        end: new Date(
          Math.min(
            eventStart.getTime(),
            currentTime.getTime() + durationMinutes * 60 * 1000,
          ),
        ),
      });
    }

    currentTime = eventEnd;
  }

  if (
    endOfDay.getTime() - currentTime.getTime() >=
    durationMinutes * 60 * 1000
  ) {
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
  },
): Promise<string> {
  const calendar = getCalendar();

  const event: any = {
    summary,
    description: options?.description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    location: options?.location,
  };

  if (options?.attendees?.length) {
    event.attendees = options.attendees.map((email) => ({ email }));
  }

  const response = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
    sendUpdates: options?.attendees?.length ? 'all' : 'none',
  });

  return response.data.htmlLink || '';
}

/**
 * Block time for deep work
 */
export async function blockDeepWorkTime(
  date: Date,
  hours: number,
  label: string = 'Deep Work',
): Promise<string> {
  const start = new Date(date);
  const end = new Date(date);
  end.setHours(end.getHours() + hours);

  return createEvent(label, start, end, {
    description: 'Blocked time for focused work - no meetings',
  });
}

/**
 * Get today's events
 */
export async function getTodayEvents(): Promise<CalendarEvent[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return getEvents(start, end);
}

/**
 * Get week summary
 */
export async function getWeekSummary(): Promise<string> {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + 1);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  const events = await getEvents(startOfWeek, endOfWeek);

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

  let summary = '*THIS WEEK*\n\n';
  for (const [day, dayEvents] of Object.entries(byDay)) {
    summary += `*${day}* (${dayEvents.length} events)\n`;
    dayEvents.slice(0, 5).forEach((event) => {
      const time = new Date(event.start).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      summary += `  ${time} - ${event.summary}\n`;
    });
    if (dayEvents.length > 5) {
      summary += `  ... and ${dayEvents.length - 5} more\n`;
    }
    summary += '\n';
  }

  return summary;
}

/**
 * Format events for WhatsApp
 */
export function formatEventsForWhatsApp(events: CalendarEvent[]): string {
  if (events.length === 0) return 'No events found.';

  return events
    .map((event, i) => {
      const start = new Date(event.start);
      const end = new Date(event.end);
      const day = start.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const startTime = start.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      const endTime = end.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      const attendees = event.attendees?.length
        ? `\n   With: ${event.attendees.join(', ')}`
        : '';
      const location = event.location ? `\n   Location: ${event.location}` : '';

      return `${i + 1}. *${event.summary}*\n   ${day} ${startTime} - ${endTime}${attendees}${location}`;
    })
    .join('\n\n');
}

/**
 * Format availability for WhatsApp
 */
export function formatAvailability(
  slots: Array<{ start: Date; end: Date }>,
): string {
  if (slots.length === 0) return 'No availability found.';

  return slots
    .slice(0, 5)
    .map((slot, i) => {
      const day = slot.start.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const startTime = slot.start.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      const endTime = slot.end.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `${i + 1}. ${day} ${startTime} - ${endTime}`;
    })
    .join('\n');
}
