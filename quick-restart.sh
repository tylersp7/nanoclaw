#!/bin/bash
# Quick restart using existing compiled code from /workspace/project/dist
# (which already has the notification fix)

set -e

echo "🚀 Quick restart with notification fix..."

# Find and stop the running service
echo "🛑 Stopping current service..."
CURRENT_PID=$(pgrep -f "node.*dist/index.js" || echo "")

if [ -n "$CURRENT_PID" ]; then
    echo "Found running process: $CURRENT_PID"
    kill $CURRENT_PID
    sleep 2

    # Force kill if still running
    if ps -p $CURRENT_PID > /dev/null 2>&1; then
        echo "Process still running, force killing..."
        kill -9 $CURRENT_PID
        sleep 1
    fi
    echo "✅ Service stopped"
else
    echo "⚠️  No running service found"
fi

# Copy the ALREADY COMPILED files from /workspace/project/dist to /tmp/dist
# These files already have the notification fix!
echo "📋 Copying pre-built files to /tmp/dist..."
rm -rf /tmp/dist
cp -r /workspace/project/dist /tmp/dist
echo "✅ Files copied"

# Verify the fix is in place
if grep -q "unavailable" /tmp/dist/channels/whatsapp.js; then
    echo "✅ Notification fix verified in compiled code"
else
    echo "⚠️  Warning: Could not verify notification fix"
fi

# Start the service
echo "🚀 Starting service from /tmp/dist..."
cd /tmp/dist
nohup node index.js > /tmp/nanoclaw.log 2>&1 &
NEW_PID=$!

sleep 3

# Verify it started
if ps -p $NEW_PID > /dev/null 2>&1; then
    echo ""
    echo "✅ Service restarted successfully! PID: $NEW_PID"
    echo ""
    echo "📱 *Notification Fix Applied:*"
    echo "   - WhatsApp client now marked as 'unavailable'"
    echo "   - Mobile push notifications should now work"
    echo ""
    echo "📊 Monitor logs: tail -f /tmp/nanoclaw.log"
    echo "🧪 Test: Send a message and check if you get a notification!"
    echo ""
else
    echo "❌ Service failed to start. Check logs:"
    tail -30 /tmp/nanoclaw.log
    exit 1
fi
