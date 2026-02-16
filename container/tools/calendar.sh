#!/bin/bash
# Calendar tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"

case "$1" in
  today)
    node -e "
    const { getTodayEvents, formatEventsForWhatsApp } = require('$NANOCLAW_DIR/dist/calendar-helper.js');
    getTodayEvents().then(events => {
      if (events.length === 0) { console.log('No events today.'); }
      else { console.log(formatEventsForWhatsApp(events)); }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  week)
    node -e "
    const { getWeekSummary } = require('$NANOCLAW_DIR/dist/calendar-helper.js');
    getWeekSummary().then(s => console.log(s)).catch(err => console.error('Error:', err.message));
    "
    ;;

  availability)
    DATE="${2:-today}"
    DURATION="${3:-60}"
    node -e "
    const { findAvailableSlots, formatAvailability } = require('$NANOCLAW_DIR/dist/calendar-helper.js');
    const date = '$DATE' === 'today' ? new Date() : new Date('$DATE');
    findAvailableSlots(date, $DURATION).then(slots => {
      console.log(formatAvailability(slots));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  create)
    SUMMARY="$2"
    START="$3"
    END="$4"
    ATTENDEES="${5:-}"
    node -e "
    const { createEvent } = require('$NANOCLAW_DIR/dist/calendar-helper.js');
    const opts = {};
    if ('$ATTENDEES') opts.attendees = '$ATTENDEES'.split(',');
    createEvent('$SUMMARY', new Date('$START'), new Date('$END'), opts).then(link => {
      console.log('Event created:', link);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  block)
    DATE="$2"
    HOURS="${3:-2}"
    LABEL="${4:-Deep Work}"
    node -e "
    const { blockDeepWorkTime } = require('$NANOCLAW_DIR/dist/calendar-helper.js');
    blockDeepWorkTime(new Date('$DATE'), $HOURS, '$LABEL').then(link => {
      console.log('Time blocked:', link);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: calendar.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  today                          - Show today's events"
    echo "  week                           - Show week summary"
    echo "  availability [date] [minutes]  - Find open slots"
    echo "  create <title> <start> <end> [attendees]  - Create event"
    echo "  block <datetime> [hours] [label]  - Block deep work time"
    echo ""
    echo "Examples:"
    echo "  calendar.sh today"
    echo "  calendar.sh availability 2026-02-11 30"
    echo "  calendar.sh create 'Client Call' '2026-02-11T14:00' '2026-02-11T15:00' 'client@example.com'"
    echo "  calendar.sh block '2026-02-11T09:00' 4 'Focus Time'"
    ;;
esac
