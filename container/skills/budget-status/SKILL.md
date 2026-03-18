---
name: budget-status
description: Query API cost tracking and budget status via IPC
---

# Budget Status

Query NanoClaw's cost tracking and budget management system.

## How to Check Budget

Write an IPC task file to request budget status:

```bash
echo '{"type": "budget_status"}' > /workspace/ipc/tasks/budget-$(date +%s).json
```

Then read the result from the IPC input directory:

```bash
cat /workspace/ipc/input/budget-result-*.json 2>/dev/null
```

## Response Format

The response includes:
- `summary`: Human-readable budget summary with daily/monthly usage and top groups
- `allowed`: Whether new invocations are currently allowed
- `dailyPercent`: Percentage of daily budget used
- `monthlyPercent`: Percentage of monthly budget used

## Budget Limits

The system enforces:
- **Daily limit**: Default $10/day (configurable)
- **Monthly limit**: Default $200/month (configurable)
- **Soft warning**: At 80% of either limit
- **Hard stop**: When either limit is exceeded (blocks new container runs)

## Cost Attribution

Every API call is tracked per-group with:
- Input/output token counts
- Cache creation/read tokens
- Estimated USD cost based on model pricing
- Request count and duration
