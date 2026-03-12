# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/pipeline-runner.ts` | Multi-step pipeline execution engine |
| `src/follow-up-detector.ts` | Scans agent output for signals, queues follow-ups |
| `src/notification-batcher.ts` | Batches scheduled task notifications per chat |
| `src/container-pool.ts` | Caches mount setup, skills sync, IPC dirs for faster container spawns |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |
| `/add-slack` | Monitor VPS alerts from Slack channels |
| `/add-gmail` | Add Gmail integration for email access |
| `/add-telegram` | Add Telegram as alternative/additional channel |
| `/add-reddit-monitor` | Monitor Reddit for freelance opportunities (r/forhire, r/n8n, etc.) |
| `/add-hn-monitor` | Monitor HackerNews "Who's Hiring" and Ask HN posts |
| `/add-github-monitor` | Track repo activity, find consulting in GitHub issues |
| `/add-n8n-monitor` | Build reputation in n8n community, find consulting opportunities |
| `/add-job-board-scraper` | Monitor Upwork, Fiverr, Freelancer for automation/n8n projects |
| `/add-proposal-generator` | AI-powered proposal generation from templates for qualified leads |
| `/add-lead-pipeline` | Unified lead pipeline: chains all monitors → dedup → qualify → notify |
| `/add-vps-health-pipeline` | Automated VPS health: Slack alerts → SSH investigate → auto-remediate → report |
| `/add-client-followup` | Automated follow-ups: CRM monitoring, draft follow-up messages, deadline reminders |
| `/add-portfolio-pipeline` | Portfolio auto-update: GitHub activity → highlights → portfolio files → LinkedIn draft |
| `/add-property-monitor` | Weekly property value/rent monitoring via RentCast API (free tier) |
| `/add-life-system` | Personal life OS: daily accountability loop + deep work reminders |
| `/add-hubspot-crm` | HubSpot CRM integration: lead sync, deal tracking, fast-fail token validation |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate channel fork, not bundled in core. Run `/add-whatsapp` (or `git remote add whatsapp https://github.com/qwibitai/nanoclaw-whatsapp.git && git fetch whatsapp main && (git merge whatsapp/main || { git checkout --theirs package-lock.json && git add package-lock.json && git merge --continue; }) && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
