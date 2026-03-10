#!/bin/bash
# Setup weekly reflection task
# Run this from within a container or via the IPC task system

cat > /workspace/ipc/tasks/setup-reflection-$(date +%s).json << 'EOF'
{
  "type": "create_task",
  "task": {
    "prompt": "Run your weekly learning reflection. Follow the weekly-reflection skill instructions to review recent conversations, extract patterns, update intelligence files, and send a summary.",
    "schedule_type": "cron",
    "schedule_value": "0 9 * * 0",
    "context_mode": "group"
  }
}
EOF

echo "Weekly reflection task created (Sundays at 9 AM)"
