#!/bin/bash
# Rebuild and restart NanoClaw with notification fix

set -e

echo "🔧 Rebuilding NanoClaw with notification fix..."

# Navigate to project directory
cd /workspace/project

# Build with increased memory (needed for TypeScript compilation)
echo "📦 Running TypeScript build (this may take a moment)..."
NODE_OPTIONS="--max-old-space-size=4096" npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Trying alternative build method..."
    # Try incremental build if full build fails
    NODE_OPTIONS="--max-old-space-size=4096" npx tsc --incremental
fi

echo "✅ Build complete!"

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
    fi
    echo "✅ Service stopped"
else
    echo "⚠️  No running service found"
fi

# Copy built files to /tmp/dist (where the service runs from)
echo "📋 Copying built files to /tmp/dist..."
rm -rf /tmp/dist
cp -r /workspace/project/dist /tmp/dist
echo "✅ Files copied"

# Start the service
echo "🚀 Starting service..."
cd /workspace/project
nohup npm start > /tmp/nanoclaw.log 2>&1 &
NEW_PID=$!

sleep 2

# Verify it started
if ps -p $NEW_PID > /dev/null 2>&1; then
    echo "✅ Service started successfully! PID: $NEW_PID"
    echo ""
    echo "📱 Notification fix applied:"
    echo "   - Client now marked as 'unavailable' to enable mobile notifications"
    echo "   - WhatsApp should now send push notifications to your phone"
    echo ""
    echo "📊 Check logs with: tail -f /tmp/nanoclaw.log"
    echo ""
    echo "🧪 Test by sending a message - you should now get a notification!"
else
    echo "❌ Service failed to start. Check logs:"
    tail -20 /tmp/nanoclaw.log
    exit 1
fi
