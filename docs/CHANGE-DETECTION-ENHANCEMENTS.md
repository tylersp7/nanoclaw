# Change Detection Enhancements

Inspired by OpenFang's Collector Hand OSINT system. Built on top of the file-based change detection in `src/change-detector.ts`.

## Architecture

State is stored per-source as JSON files in `/workspace/group/.change-detection/`. Each monitor run compares current items against stored hashes and reports only deltas.

### Key Functions

| Function | Purpose |
|----------|---------|
| `detectChanges()` | Core delta engine — new, changed, returning, gone |
| `tagWithSignificance()` | Classify items as critical/important/minor |
| `findCrossPlatformDuplicates()` | Title-hash matching across sources |
| `deduplicateAcrossSources()` | Filter dupes from a ChangeResult |
| `checkStaleness()` | Flag monitors that missed their schedule |
| `aggregateDeltas()` | Unified summary across all sources |
| `parseDeltaFromOutput()` | Extract delta from pipeline step text |

### CLI Tool

`change-detect.sh` provides cross-cutting operations:
- `staleness` — Check all monitors against expected intervals
- `stats` — Show tracked items across all sources
- `dedup-report` — Find cross-platform duplicates
- `reset-all` — Clear all change detection state

## Enhancements (all implemented)

### 1. Cross-Platform Dedup
**Status**: Done
Normalizes titles (strips brackets, budgets, URLs, punctuation), hashes them, compares across all sources. Items seen in an earlier source are filtered from later ones.

### 2. Significance Tiers (Critical / Important / Minor)
**Status**: Done
Three-tier classification based on relevance score:
- **Critical** (9-10): high budget + exact skill match — shown immediately
- **Important** (7-8): good match — shown in report
- **Minor** (5-6): tangential — count noted, details suppressed

All 5 monitor scripts output by tier: `CRITICAL (1):` / `IMPORTANT (2):` / `MINOR (3): logged only`

### 3. Dead Code Cleanup
**Status**: Done
Removed unused `is_seen()`, `mark_seen()`, and seen-file initialization from `job-board-scraper.sh`.

### 4. Returning Items Detection
**Status**: Done
Items that disappear and reappear are flagged as "returning" (not "new"). The `gone` flag on stored items tracks disappearance. Useful for detecting job reposts which often signal urgency.

### 5. Unified Lead Pipeline Delta Summary
**Status**: Done
`pipeline-runner.ts` now:
- Parses delta summary lines from each step's text output
- Aggregates across all monitor/discovery steps
- Produces unified summary: `Lead Pipeline Delta: 5 new, 2 updated (54 total across 4 sources)`
- Logs metrics: `{ totalNew, totalChanged, totalItems, sources }`

### 6. Staleness Alerts
**Status**: Done
`checkStaleness()` compares `lastRun` timestamps against expected intervals (2x threshold). `formatStalenessReport()` produces human-readable output. Default intervals configured in `change-detect.sh`.
