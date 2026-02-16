#!/bin/bash
# Calendar availability checker for NanoClaw agents
#
# Reads Google Calendar data via the googleapis npm package and outputs
# availability information as JSON. Used by the lead pipeline, client
# follow-up system, and proposal generator to make capacity-aware decisions.
#
# Credentials location (mounted into container):
#   /home/node/.nanoclaw-calendar/credentials.json
#   /home/node/.nanoclaw-calendar/token.json
#
# Dependencies: googleapis (available via /workspace/project/node_modules)
#
# Environment variables (optional):
#   BUSINESS_HOURS_START  - Start of business day (default: 9)
#   BUSINESS_HOURS_END    - End of business day (default: 17)
#   BUSINESS_DAYS         - Comma-separated weekday numbers, 0=Sun (default: 1,2,3,4,5)

CRED_DIR="/home/node/.nanoclaw-calendar"
CRED_FILE="$CRED_DIR/credentials.json"
TOKEN_FILE="$CRED_DIR/token.json"

# googleapis is available from the host project mount
NODE_PATH="/workspace/project/node_modules"

BH_START="${BUSINESS_HOURS_START:-9}"
BH_END="${BUSINESS_HOURS_END:-17}"
BH_DAYS="${BUSINESS_DAYS:-1,2,3,4,5}"

check_credentials() {
  if [ ! -f "$CRED_FILE" ]; then
    echo '{"error": "Calendar credentials not found. Run /add-calendar-integration first.", "path": "'"$CRED_FILE"'"}'
    exit 1
  fi
  if [ ! -f "$TOKEN_FILE" ]; then
    echo '{"error": "Calendar token not found. Run: node scripts/calendar-auth.js", "path": "'"$TOKEN_FILE"'"}'
    exit 1
  fi
}

case "$1" in
  availability)
    DAYS="${2:-7}"
    check_credentials

    NODE_PATH="$NODE_PATH" node -e "
const { google } = require('googleapis');
const fs = require('fs');

const BH_START = $BH_START;
const BH_END = $BH_END;
const BH_DAYS = [$BH_DAYS];
const DAYS = $DAYS;

const credentials = JSON.parse(fs.readFileSync('$CRED_FILE', 'utf-8'));
const tokens = JSON.parse(fs.readFileSync('$TOKEN_FILE', 'utf-8'));
const { client_secret, client_id } = credentials.installed || credentials.web;
const auth = new google.auth.OAuth2(client_id, client_secret);
auth.setCredentials(tokens);
const calendar = google.calendar({ version: 'v3', auth });

const now = new Date();
const end = new Date(now);
end.setDate(end.getDate() + DAYS);

calendar.events.list({
  calendarId: 'primary',
  timeMin: now.toISOString(),
  timeMax: end.toISOString(),
  singleEvents: true,
  orderBy: 'startTime',
}).then(response => {
  const events = response.data.items || [];

  // Calculate business hours and busy hours
  let totalBusinessMinutes = 0;
  let totalBusyMinutes = 0;
  const slots = [];

  // Iterate through each day
  for (let d = 0; d < DAYS; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    const dayOfWeek = day.getDay();

    if (!BH_DAYS.includes(dayOfWeek)) continue;

    const dayStart = new Date(day);
    dayStart.setHours(BH_START, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(BH_END, 0, 0, 0);

    // Skip if day is already past
    if (dayEnd <= now) continue;

    // Effective start is max(now, dayStart)
    const effectiveStart = dayStart < now ? now : dayStart;
    const businessMinutesToday = Math.max(0, (dayEnd - effectiveStart) / 60000);
    totalBusinessMinutes += businessMinutesToday;

    // Find events that overlap with business hours this day
    const dayEvents = events.filter(e => {
      const eStart = new Date(e.start.dateTime || e.start.date);
      const eEnd = new Date(e.end.dateTime || e.end.date);
      return eStart < dayEnd && eEnd > effectiveStart;
    }).sort((a, b) => {
      const aStart = new Date(a.start.dateTime || a.start.date);
      const bStart = new Date(b.start.dateTime || b.start.date);
      return aStart - bStart;
    });

    // Calculate busy minutes (with overlap handling)
    let busyMinutesToday = 0;
    let cursor = effectiveStart;
    const freeSlots = [];

    for (const event of dayEvents) {
      const eStart = new Date(event.start.dateTime || event.start.date);
      const eEnd = new Date(event.end.dateTime || event.end.date);
      const clampedStart = eStart < effectiveStart ? effectiveStart : eStart > dayEnd ? dayEnd : eStart;
      const clampedEnd = eEnd > dayEnd ? dayEnd : eEnd < effectiveStart ? effectiveStart : eEnd;

      if (clampedStart > cursor) {
        // Free slot before this event
        const slotMinutes = (clampedStart - cursor) / 60000;
        if (slotMinutes >= 30) {
          freeSlots.push({
            date: day.toISOString().split('T')[0],
            start: cursor.toTimeString().slice(0, 5),
            end: clampedStart.toTimeString().slice(0, 5),
            duration_minutes: Math.round(slotMinutes)
          });
        }
      }

      if (clampedEnd > cursor) {
        busyMinutesToday += (clampedEnd - Math.max(cursor, clampedStart)) / 60000;
        cursor = clampedEnd;
      }
    }

    // Free slot after last event
    if (cursor < dayEnd) {
      const slotMinutes = (dayEnd - cursor) / 60000;
      if (slotMinutes >= 30) {
        freeSlots.push({
          date: day.toISOString().split('T')[0],
          start: cursor.toTimeString().slice(0, 5),
          end: dayEnd.toTimeString().slice(0, 5),
          duration_minutes: Math.round(slotMinutes)
        });
      }
    }

    totalBusyMinutes += busyMinutesToday;
    slots.push(...freeSlots);
  }

  const availableHours = Math.round((totalBusinessMinutes - totalBusyMinutes) / 60 * 10) / 10;
  const busyHours = Math.round(totalBusyMinutes / 60 * 10) / 10;
  const totalHours = Math.round(totalBusinessMinutes / 60 * 10) / 10;

  // Weekly capacity calculation (normalize to a 7-day week)
  const weeklyAvailable = DAYS >= 7 ? availableHours : availableHours * (7 / DAYS);
  let capacity;
  if (weeklyAvailable > 20) capacity = 'high';
  else if (weeklyAvailable > 10) capacity = 'medium';
  else if (weeklyAvailable > 5) capacity = 'low';
  else capacity = 'full';

  console.log(JSON.stringify({
    period_days: DAYS,
    available_hours: availableHours,
    busy_hours: busyHours,
    total_business_hours: totalHours,
    capacity: capacity,
    weekly_available_estimate: Math.round(weeklyAvailable * 10) / 10,
    slots: slots.slice(0, 20),
    checked_at: new Date().toISOString()
  }, null, 2));
}).catch(err => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
"
    ;;

  capacity)
    check_credentials

    NODE_PATH="$NODE_PATH" node -e "
const { google } = require('googleapis');
const fs = require('fs');

const BH_START = $BH_START;
const BH_END = $BH_END;
const BH_DAYS = [$BH_DAYS];

const credentials = JSON.parse(fs.readFileSync('$CRED_FILE', 'utf-8'));
const tokens = JSON.parse(fs.readFileSync('$TOKEN_FILE', 'utf-8'));
const { client_secret, client_id } = credentials.installed || credentials.web;
const auth = new google.auth.OAuth2(client_id, client_secret);
auth.setCredentials(tokens);
const calendar = google.calendar({ version: 'v3', auth });

const now = new Date();
const end = new Date(now);
end.setDate(end.getDate() + 7);

calendar.events.list({
  calendarId: 'primary',
  timeMin: now.toISOString(),
  timeMax: end.toISOString(),
  singleEvents: true,
  orderBy: 'startTime',
}).then(response => {
  const events = response.data.items || [];

  let totalBusinessMinutes = 0;
  let totalBusyMinutes = 0;

  for (let d = 0; d < 7; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    if (!BH_DAYS.includes(day.getDay())) continue;

    const dayStart = new Date(day);
    dayStart.setHours(BH_START, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(BH_END, 0, 0, 0);

    if (dayEnd <= now) continue;
    const effectiveStart = dayStart < now ? now : dayStart;
    totalBusinessMinutes += Math.max(0, (dayEnd - effectiveStart) / 60000);

    const dayEvents = events.filter(e => {
      const eStart = new Date(e.start.dateTime || e.start.date);
      const eEnd = new Date(e.end.dateTime || e.end.date);
      return eStart < dayEnd && eEnd > effectiveStart;
    });

    let cursor = effectiveStart;
    for (const event of dayEvents) {
      const eStart = new Date(event.start.dateTime || event.start.date);
      const eEnd = new Date(event.end.dateTime || event.end.date);
      const clampedStart = eStart < effectiveStart ? effectiveStart : eStart > dayEnd ? dayEnd : eStart;
      const clampedEnd = eEnd > dayEnd ? dayEnd : eEnd < effectiveStart ? effectiveStart : eEnd;
      if (clampedEnd > cursor) {
        totalBusyMinutes += (clampedEnd - Math.max(cursor, clampedStart)) / 60000;
        cursor = clampedEnd;
      }
    }
  }

  const availableHours = Math.round((totalBusinessMinutes - totalBusyMinutes) / 60 * 10) / 10;

  let capacity;
  if (availableHours > 20) capacity = 'high';
  else if (availableHours > 10) capacity = 'medium';
  else if (availableHours > 5) capacity = 'low';
  else capacity = 'full';

  console.log(capacity);
}).catch(err => {
  console.error('Error checking capacity:', err.message);
  console.log('unknown');
  process.exit(1);
});
"
    ;;

  next-slot)
    DURATION="${2:-60}"
    check_credentials

    NODE_PATH="$NODE_PATH" node -e "
const { google } = require('googleapis');
const fs = require('fs');

const BH_START = $BH_START;
const BH_END = $BH_END;
const BH_DAYS = [$BH_DAYS];
const DURATION = $DURATION;

const credentials = JSON.parse(fs.readFileSync('$CRED_FILE', 'utf-8'));
const tokens = JSON.parse(fs.readFileSync('$TOKEN_FILE', 'utf-8'));
const { client_secret, client_id } = credentials.installed || credentials.web;
const auth = new google.auth.OAuth2(client_id, client_secret);
auth.setCredentials(tokens);
const calendar = google.calendar({ version: 'v3', auth });

const now = new Date();
const end = new Date(now);
end.setDate(end.getDate() + 14);

calendar.events.list({
  calendarId: 'primary',
  timeMin: now.toISOString(),
  timeMax: end.toISOString(),
  singleEvents: true,
  orderBy: 'startTime',
}).then(response => {
  const events = response.data.items || [];

  // Search day by day for the first slot of the requested duration
  for (let d = 0; d < 14; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    if (!BH_DAYS.includes(day.getDay())) continue;

    const dayStart = new Date(day);
    dayStart.setHours(BH_START, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(BH_END, 0, 0, 0);

    if (dayEnd <= now) continue;
    const effectiveStart = dayStart < now ? now : dayStart;

    // Round up to next 15-minute boundary
    const mins = effectiveStart.getMinutes();
    const roundedMins = Math.ceil(mins / 15) * 15;
    effectiveStart.setMinutes(roundedMins, 0, 0);

    const dayEvents = events.filter(e => {
      const eStart = new Date(e.start.dateTime || e.start.date);
      const eEnd = new Date(e.end.dateTime || e.end.date);
      return eStart < dayEnd && eEnd > effectiveStart;
    }).sort((a, b) => {
      return new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date);
    });

    let cursor = effectiveStart;

    for (const event of dayEvents) {
      const eStart = new Date(event.start.dateTime || event.start.date);
      if ((eStart - cursor) >= DURATION * 60000) {
        const slotEnd = new Date(cursor.getTime() + DURATION * 60000);
        console.log(JSON.stringify({
          date: day.toISOString().split('T')[0],
          day_of_week: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()],
          start: cursor.toTimeString().slice(0, 5),
          end: slotEnd.toTimeString().slice(0, 5),
          duration_minutes: DURATION,
          start_iso: cursor.toISOString(),
          end_iso: slotEnd.toISOString()
        }, null, 2));
        process.exit(0);
      }
      const eEnd = new Date(event.end.dateTime || event.end.date);
      if (eEnd > cursor) cursor = eEnd;
    }

    // Check remaining time after last event
    if ((dayEnd - cursor) >= DURATION * 60000) {
      const slotEnd = new Date(cursor.getTime() + DURATION * 60000);
      console.log(JSON.stringify({
        date: day.toISOString().split('T')[0],
        day_of_week: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()],
        start: cursor.toTimeString().slice(0, 5),
        end: slotEnd.toTimeString().slice(0, 5),
        duration_minutes: DURATION,
        start_iso: cursor.toISOString(),
        end_iso: slotEnd.toISOString()
      }, null, 2));
      process.exit(0);
    }
  }

  console.log(JSON.stringify({
    error: 'No available slot found in the next 14 days',
    duration_requested: DURATION
  }, null, 2));
  process.exit(1);
}).catch(err => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
"
    ;;

  *)
    echo "Usage: calendar-checker.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  availability [days]            - Show available slots for next N days (default: 7)"
    echo "  capacity                       - Quick capacity check: high|medium|low|full"
    echo "  next-slot [duration_minutes]   - Find next available slot (default: 60 min)"
    echo ""
    echo "Capacity levels (based on weekly available hours):"
    echo "  high   - >20 hours free"
    echo "  medium - 10-20 hours free"
    echo "  low    - 5-10 hours free"
    echo "  full   - <5 hours free"
    echo ""
    echo "Environment variables:"
    echo "  BUSINESS_HOURS_START  - Start hour (default: 9)"
    echo "  BUSINESS_HOURS_END   - End hour (default: 17)"
    echo "  BUSINESS_DAYS        - Weekday numbers, 0=Sun (default: 1,2,3,4,5)"
    echo ""
    echo "Examples:"
    echo "  calendar-checker.sh availability 14"
    echo "  calendar-checker.sh capacity"
    echo "  calendar-checker.sh next-slot 90"
    ;;
esac
