#!/bin/bash
# Setup monthly auto-optimizer task
# Run this from within a container or via the IPC task system

cat > /workspace/ipc/tasks/setup-optimizer-$(date +%s).json << 'EOF'
{
  "type": "create_task",
  "task": {
    "prompt": "Run the auto-optimizer. Follow the auto-optimizer skill instructions to review the task scorecard, failure patterns, and skill effectiveness data. Pause low-value tasks, adjust schedules if needed, and send a summary of changes made and recommendations.",
    "schedule_type": "cron",
    "schedule_value": "0 10 1 * *",
    "context_mode": "group"
  }
}
EOF

echo "Auto-optimizer task created (1st of each month at 10 AM)"
