---
name: add-hubspot-crm
description: Connect HubSpot CRM for lead syncing, deal tracking, and pipeline management. Uses a Private App token with fast-fail validation.
---

# Add HubSpot CRM

This skill connects your HubSpot CRM account so leads from monitors get synced as contacts and deals automatically.

## Setup

### 1. Get HubSpot Private App Token

Ask the user:

> I need a HubSpot Private App access token.
>
> 1. Go to **HubSpot > Settings > Integrations > Private Apps**
> 2. Click **Create a private app**
> 3. Name it "NanoClaw" (or anything)
> 4. Under **Scopes**, enable these:
>    - `crm.objects.contacts.read`
>    - `crm.objects.contacts.write`
>    - `crm.objects.deals.read`
>    - `crm.objects.deals.write`
>    - `crm.schemas.contacts.read`
>    - `crm.schemas.deals.read`
>    - `crm.objects.owners.read`
> 5. Click **Create app**, then copy the access token (starts with `pat-`)
>
> Paste your token here.

Wait for the user to provide the token.

### 2. Save Token

Add the token to the project `.env` file:

```bash
grep -q 'HUBSPOT_TOKEN' /workspace/project/.env 2>/dev/null || echo 'HUBSPOT_TOKEN=USER_TOKEN' >> /workspace/project/.env
```

Replace `USER_TOKEN` with the actual token from the user.

### 3. Validate Token (fast-fail)

Run validation immediately — this catches bad tokens before wasting time:

```bash
hubspot.sh validate
```

If validation fails, tell the user the exact error and ask them to check their token. Do NOT proceed until validation passes.

### 4. Set Up Custom Properties

```bash
hubspot.sh setup-properties
```

This creates NanoClaw-specific properties in HubSpot (lead source, quality score, etc.). Idempotent — safe to run multiple times.

### 5. Register Scheduled Sync Task

Use the `schedule_task()` MCP tool:

```
schedule_task({
  "schedule_type": "cron",
  "schedule_value": "0 10 * * *",
  "prompt": "Run the daily HubSpot CRM sync.\n\n1. Run: hubspot.sh sync --limit 20\n   This syncs unsynced leads from the local CRM to HubSpot as contacts and deals.\n2. Run: hubspot.sh status\n   This shows current HubSpot stats.\n3. Send a brief sync summary via send_message: how many synced, any errors, total contacts/deals.\n4. If sync errors occur (auth failure, rate limit), report the specific error. Do NOT attempt to debug or fix token issues — just report them."
})
```

### 6. Verify

Run a quick status check:

```bash
hubspot.sh status
```

## Verification

Tell the user:

> HubSpot CRM is connected! Here's what's configured:
>
> - **Token:** Validated successfully
> - **Custom properties:** Created in HubSpot
> - **Daily sync:** Every day at 10:00 AM (up to 20 leads per run)
>
> Available commands:
> - `hubspot.sh validate` — Check token is working
> - `hubspot.sh sync --limit N` — Sync leads to HubSpot
> - `hubspot.sh status` — Show CRM stats
> - `hubspot.sh push-lead <id>` — Sync a specific lead
> - `hubspot.sh lookup <email>` — Find a contact

## Troubleshooting

### Token Invalid
Run `hubspot.sh validate`. If it fails, the user needs to regenerate the token in HubSpot > Settings > Integrations > Private Apps.

### Rate Limited
HubSpot free tier allows 100 API calls per 10 seconds. The sync uses rate limiting (150ms between calls). If hit, wait and retry.

### Properties Already Exist
`setup-properties` is idempotent — it skips existing properties. Safe to re-run.
