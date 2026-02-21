---
name: add-property-monitor
description: Weekly property value and rent monitoring using RentCast API. Tracks estimated values, rent prices, tax assessments, and comparables for your properties. Alerts on significant changes.
---

# Add Property Monitor

This skill sets up weekly property value and rent monitoring using the RentCast API (free tier: 50 calls/month). It tracks estimated values, rent estimates, tax assessments, and comparable properties, alerting you to significant changes.

**API budget:** 2 addresses x 3 endpoints = 6 calls/week = 24/month (well within 50 free).

## Setup

### 1. Get RentCast API Key

Ask the user:

> I need a RentCast API key to monitor your properties.
>
> 1. Go to https://app.rentcast.io/app/api
> 2. Sign up for a free account (50 API calls/month)
> 3. Copy your API key (starts with `rc_`)
>
> Paste your API key here.

Wait for the user to provide the key.

### 2. Get Property Addresses

Ask the user:

> Which properties do you want to monitor? Give me the full street addresses including city, state, and ZIP.
>
> Example: "123 Main St, Phoenix, AZ 85001"
>
> You can monitor up to 2 addresses within the free API budget.

Wait for the user to provide 1-2 addresses.

### 3. Save Configuration

Write the config to the group directory (writable):

```bash
cat > /workspace/group/property-config.json << 'EOF'
{
  "apiKey": "USER_API_KEY",
  "addresses": [
    "ADDRESS_1",
    "ADDRESS_2"
  ]
}
EOF
```

Replace `USER_API_KEY` and addresses with actual values from the user.

Also add the API key to the project env file so it's passed to containers via env-dir:

```bash
grep -q 'RENTCAST_API_KEY' /workspace/project/.env 2>/dev/null || echo 'RENTCAST_API_KEY=USER_API_KEY' >> /workspace/project/.env
```

### 4. Create Scheduled Task

Use the `schedule_task()` MCP tool:

```
schedule_task({
  "schedule_type": "cron",
  "schedule_value": "0 9 * * 1",
  "prompt": "Run the weekly property value and rent check.\n\n1. Run: /workspace/project/container/tools/property-monitor.sh check-all\n   This reads config from /workspace/group/property-config.json, calls the RentCast API for each address (property records, value estimate, rent estimate), and compares against previous results in /workspace/group/property-history.json.\n2. The tool outputs a formatted report. Send this report via send_message.\n3. If the output includes 'ACTION_NEEDED' for any property (value changed >5%), highlight which properties need attention.\n4. If API errors occur (rate limit, invalid key), report the error and suggest checking the API key or waiting until next month's quota resets."
})
```

### 5. Test

Run a test check:

```bash
/workspace/project/container/tools/property-monitor.sh check-all
```

Send the output to the user.

## Verification

Tell the user:

> Property monitor is set up! Here's what's configured:
>
> - **Addresses:** [list them]
> - **Schedule:** Every Monday at 9:00 AM
> - **API budget:** 6 calls/week out of 50/month free tier
>
> I just ran a test check. The first scheduled report will arrive next Monday morning.

## Troubleshooting

### API Key Invalid
If you get authentication errors, verify the key at https://app.rentcast.io/app/api and check `/workspace/group/property-config.json`.

### Rate Limit Exceeded
Free tier is 50 calls/month. 2 addresses x 3 endpoints x 4 weeks = 24 calls. Wait for monthly reset or reduce addresses.

### Address Not Found
RentCast needs precise addresses. Use full street address with city, state, ZIP. Check Google Maps for official format.
