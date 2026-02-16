# NanoClaw Optimization Roadmap

Post-pipeline-framework enhancements: skill chaining, new skills, and architectural improvements.

## Status Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[-]` Deprioritized/skipped

---

## 1. Skill Enhancements & Chaining

### 1.1 [x] Implement Proposal Generator
**Priority:** P0 — closes the discovery-to-action loop
**Effort:** Medium | **Impact:** Very High

The pipeline's `deduplicate-and-qualify` step emits `<signal type="LEAD_FOUND">` and `follow-up-detector.ts` has a handler for it, but there's no actual proposal tool. Build `add-proposal-generator` skill with:
- Proposal template system (reads from `~/.nanoclaw-proposals/templates/`)
- Job analysis (extract requirements, budget, timeline)
- Skill matching against portfolio
- Draft generation with personalization
- Output: ready-to-send proposal text

**Files:** `.claude/skills/add-proposal-generator/SKILL.md`, `container/tools/proposal-generator.sh`

### 1.2 [x] VPS Health Pipeline
**Priority:** P0 — leverages Slack + SSH relay already built
**Effort:** Low | **Impact:** High

Chain existing capabilities into an automated health pipeline:
```
slack-check → parse-severity → ssh-investigate → auto-remediate → notify
```

Signals already wired: `AUTO_REMEDIATE`, `ACTION_NEEDED` in follow-up-detector.ts.
Missing: skill that creates the pipeline task and teaches agents to use `SSH_RELAY_URL`.

**Files:** `.claude/skills/add-vps-health-pipeline/SKILL.md`

### 1.3 [x] Monitor Signal Emission
**Priority:** P1 — makes standalone monitors pipeline-aware
**Effort:** Low | **Impact:** Medium

Update each monitor's prompt template to emit `<signal type="LEAD_FOUND">` for 7+ leads even when running outside the pipeline. Follow-up detector catches them regardless.

**Targets:** Reddit, HN, GitHub, n8n monitor scheduled task prompts

### 1.4 [x] Job Board Scraper
**Priority:** P1 — largest lead volume source
**Effort:** Medium | **Impact:** High

Implement `add-job-board-scraper` skill. Upwork/Freelancer/PeoplePerHour have RSS feeds and searchable APIs. Slots into pipeline as another discovery step.

**Files:** `.claude/skills/add-job-board-scraper/SKILL.md`, `container/tools/job-board-scraper.sh`

### 1.5 [x] Client Follow-up Task
**Priority:** P2 — retention/conversion improvement
**Effort:** Low | **Impact:** Medium

Simple cron task: read CRM/tracking files → find leads responded to 3+ days ago with no reply → draft follow-up messages. Doesn't need a full pipeline, just a well-crafted prompt.

**Files:** `.claude/skills/add-client-followup/SKILL.md`

### 1.6 [x] Calendar-Aware Lead Acceptance
**Priority:** P2 — prevents overcommitment
**Effort:** Medium | **Impact:** Medium

Make `add-to-crm-and-notify` pipeline step aware of Google Calendar availability. Deprioritize leads when booked solid, adjust proposal timelines.

**Depends on:** `add-calendar-integration` implementation
**Files:** `container/tools/calendar-checker.sh`, updated `.claude/skills/add-lead-pipeline/SKILL.md`, `.claude/skills/add-client-followup/SKILL.md`, `.claude/skills/add-proposal-generator/SKILL.md`

### 1.7 [x] Portfolio Auto-Update
**Priority:** P3 — passive reputation building
**Effort:** Low | **Impact:** Medium

Chain: `github-activity → extract-highlights → update-portfolio → post-to-linkedin`.
Turns ongoing work into visible social proof without manual effort.

**Depends on:** GitHub monitor (done), LinkedIn monitor (stub)
**Files:** `.claude/skills/add-portfolio-pipeline/SKILL.md`, `container/tools/portfolio-updater.sh`

---

## 2. Architectural Optimizations

### 2.1 [x] Pipeline Step Parallelism
**Priority:** P1 — 4x faster pipeline runs
**Effort:** Medium | **Impact:** High

Discovery steps (Reddit, HN, GitHub, n8n) are independent. Add `parallel_group` field to `PipelineStep` — steps with same group run concurrently, outputs merged before next sequential step.

**Files:** `src/types.ts`, `src/pipeline-runner.ts`

### 2.2 [x] Notification Batching
**Priority:** P2 — reduces message noise
**Effort:** Low | **Impact:** Medium

Hold notifications for 60 seconds, merge any that arrive for the same chat. Benefits standalone tasks that currently send separate messages.

**Files:** `src/task-scheduler.ts` or new `src/notification-batcher.ts`

### 2.3 [x] Container Pre-warming
**Priority:** P3 — benefits everything but complex
**Effort:** High | **Impact:** Medium

Cache expensive setup work (mount computation, skills sync, IPC dirs, env files) to reduce per-spawn overhead. Checksum-based skills sync avoids redundant copies.

**Files:** `src/container-pool.ts` (new), `src/container-runner.ts`, `src/config.ts`

---

## Implementation Log

### 2026-02-15: Pipeline Framework
- Created `src/pipeline-runner.ts` — multi-step execution engine
- Created `src/follow-up-detector.ts` — signal detection and follow-up queueing
- Modified `src/task-scheduler.ts` — pipeline dispatch, signal scanning, follow-up polling
- Modified `src/db.ts` — pipeline_run_logs, follow_up_queue tables
- Modified `src/types.ts` — PipelineStep, PipelineState, FollowUpAction types
- Modified `src/ipc.ts` — pipeline_steps passthrough
- Modified `container/agent-runner/src/ipc-mcp-stdio.ts` — pipeline_steps in MCP schema
- Created `.claude/skills/add-lead-pipeline/SKILL.md`

### 2026-02-15: Swarm Coding Session (4 parallel agents)
- **1.1 Proposal Generator:** Created `.claude/skills/add-proposal-generator/SKILL.md`, `container/tools/proposal-generator.sh`, 3 templates (`technical-automation.md`, `n8n-specialist.md`, `general-freelance.md`)
- **1.2 VPS Health Pipeline:** Created `.claude/skills/add-vps-health-pipeline/SKILL.md` with 3-step pipeline (slack-check → classify-investigate → remediate-report)
- **1.3 Monitor Signals:** Added `<signal type="LEAD_FOUND">` emission to all 15 prompt templates across Reddit, HN, GitHub, n8n monitors
- **2.1 Pipeline Parallelism:** Added `parallel_group` to PipelineStep, refactored `pipeline-runner.ts` with batch execution (`groupStepsIntoBatches`, `executeStep`), updated MCP schema

### 2026-02-15: Swarm Coding Session #2 (3 parallel agents)
- **1.4 Job Board Scraper:** Created `.claude/skills/add-job-board-scraper/SKILL.md`, `container/tools/job-board-scraper.sh` (Upwork RSS, Fiverr scraping, Freelancer API, built-in scoring/dedup), updated lead pipeline with optional job-board-discover step
- **1.5 Client Follow-up:** Created `.claude/skills/add-client-followup/SKILL.md` with CRM schema, 3 follow-up templates (`followup-initial.md`, `followup-proposal.md`, `followup-final.md`), 3-stage escalation cadence
- **2.2 Notification Batching:** Created `src/notification-batcher.ts` (90-line decorator class), added `NOTIFICATION_BATCH_WINDOW`/`NOTIFICATION_BATCH_MAX` to config, integrated into task-scheduler with graceful shutdown flush in index.ts

### 2026-02-15: Swarm Coding Session #3 (3 parallel agents)
- **1.6 Calendar-Aware Lead Acceptance:** Created `container/tools/calendar-checker.sh` (availability/capacity/next-slot commands via Google Calendar API), updated lead pipeline CRM step with capacity-based rules (high/medium/low/full), updated client followup with calendar-aware prioritization, added calendar notes to proposal generator
- **1.7 Portfolio Auto-Update:** Created `.claude/skills/add-portfolio-pipeline/SKILL.md` with 4-step pipeline (github-scan → extract-highlights → update-portfolio → post-to-linkedin), created `container/tools/portfolio-updater.sh` (scan/highlights/update/stats), LinkedIn step always draft-only
- **2.3 Container Pre-warming:** Created `src/container-pool.ts` (mount caching, checksum-based skills sync, IPC dir pre-creation, env file dedup), modified `container-runner.ts` for conditional pool usage, added `CONTAINER_POOL_ENABLED`/`CONTAINER_POOL_SIZE` to config, integrated warmup in scheduler loop
