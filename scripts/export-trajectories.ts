#!/usr/bin/env npx tsx
/**
 * Export conversation trajectories for training or analysis.
 *
 * Usage:
 *   npx tsx scripts/export-trajectories.ts [options]
 *
 * Options:
 *   --format sharegpt|jsonl    Output format (default: sharegpt)
 *   --output <path>            Output file (default: trajectories-{date}.jsonl)
 *   --outcome success|error    Filter by outcome
 *   --topic <topic>            Filter by topic (can repeat)
 *   --group <folder>           Filter by group folder
 *   --from <date>              Filter from date (YYYY-MM-DD)
 *   --to <date>                Filter to date (YYYY-MM-DD)
 *   --min-messages <n>         Minimum message count
 *   --max-messages <n>         Maximum message count
 *   --has-tool-use             Only include entries with tool use
 *   --no-tool-use              Only include entries without tool use
 *   --stats                    Print stats only, don't export
 *   --help                     Show this help message
 */

import {
  scanTrajectories,
  exportToJSONL,
  exportToShareGPTJSONL,
  getTrajectoryStats,
  type ExportFilters,
} from '../src/trajectory-export.js';

// ── Arg Parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  format: 'sharegpt' | 'jsonl';
  output: string;
  statsOnly: boolean;
  filters: ExportFilters;
} {
  const args = argv.slice(2);
  let format: 'sharegpt' | 'jsonl' = 'sharegpt';
  let output = '';
  let statsOnly = false;
  const topics: string[] = [];
  const filters: ExportFilters = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      case '--format':
        format = args[++i] as 'sharegpt' | 'jsonl';
        if (format !== 'sharegpt' && format !== 'jsonl') {
          console.error(`Invalid format: ${format}. Use "sharegpt" or "jsonl".`);
          process.exit(1);
        }
        break;
      case '--output':
      case '-o':
        output = args[++i];
        break;
      case '--outcome':
        filters.outcome = args[++i] as ExportFilters['outcome'];
        break;
      case '--topic':
        topics.push(args[++i]);
        break;
      case '--group':
        filters.groupFolder = args[++i];
        break;
      case '--from':
        filters.dateFrom = args[++i];
        break;
      case '--to':
        filters.dateTo = args[++i];
        break;
      case '--min-messages':
        filters.minMessages = parseInt(args[++i], 10);
        break;
      case '--max-messages':
        filters.maxMessages = parseInt(args[++i], 10);
        break;
      case '--has-tool-use':
        filters.hasToolUse = true;
        break;
      case '--no-tool-use':
        filters.hasToolUse = false;
        break;
      case '--stats':
        statsOnly = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  if (topics.length > 0) {
    filters.topics = topics;
  }

  if (!output && !statsOnly) {
    const date = new Date().toISOString().slice(0, 10);
    output = `trajectories-${date}.jsonl`;
  }

  return { format, output, statsOnly, filters };
}

function printUsage(): void {
  console.log(`
Usage: npx tsx scripts/export-trajectories.ts [options]

Options:
  --format sharegpt|jsonl    Output format (default: sharegpt)
  --output <path>            Output file (default: trajectories-{date}.jsonl)
  --outcome success|error    Filter by outcome
  --topic <topic>            Filter by topic (can repeat)
  --group <folder>           Filter by group folder
  --from <date>              Filter from date (YYYY-MM-DD)
  --to <date>                Filter to date (YYYY-MM-DD)
  --min-messages <n>         Minimum message count
  --max-messages <n>         Maximum message count
  --has-tool-use             Only include entries with tool use
  --no-tool-use              Only include entries without tool use
  --stats                    Print stats only, don't export
  --help                     Show this help message

Examples:
  npx tsx scripts/export-trajectories.ts --stats
  npx tsx scripts/export-trajectories.ts --format sharegpt --outcome success
  npx tsx scripts/export-trajectories.ts --format jsonl --min-messages 4 --from 2026-02-15
  npx tsx scripts/export-trajectories.ts --topic cli --topic research -o training.jsonl
`.trim());
}

// ── Stats Printer ───────────────────────────────────────────────────────────

function printStats(stats: ReturnType<typeof getTrajectoryStats>): void {
  console.log('\n=== Trajectory Stats ===\n');
  console.log(`Total conversations:  ${stats.total}`);
  console.log(`Total messages:       ${stats.totalMessages}`);
  console.log(`Avg messages/convo:   ${stats.avgMessages}`);
  console.log(`With tool use:        ${stats.withToolUse}`);
  console.log(`With errors:          ${stats.withErrors}`);

  if (stats.dateRange) {
    console.log(`Date range:           ${stats.dateRange.earliest} .. ${stats.dateRange.latest}`);
  }

  if (Object.keys(stats.byOutcome).length > 0) {
    console.log('\nBy outcome:');
    for (const [outcome, count] of Object.entries(stats.byOutcome)) {
      console.log(`  ${outcome}: ${count}`);
    }
  }

  if (Object.keys(stats.byTopic).length > 0) {
    console.log('\nBy topic:');
    const sorted = Object.entries(stats.byTopic).sort((a, b) => b[1] - a[1]);
    for (const [topic, count] of sorted) {
      console.log(`  ${topic}: ${count}`);
    }
  }

  console.log('');
}

// ── Main ────────────────────────────────────────────────────────────────────

const { format, output, statsOnly, filters } = parseArgs(process.argv);

const activeFilters = Object.entries(filters).filter(
  ([, v]) => v !== undefined,
);
if (activeFilters.length > 0) {
  console.log(
    'Filters:',
    activeFilters.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', '),
  );
}

console.log('Scanning conversation archives...');
const entries = scanTrajectories(
  activeFilters.length > 0 ? filters : undefined,
);
console.log(`Found ${entries.length} matching conversation(s).`);

if (entries.length === 0) {
  console.log('Nothing to export.');
  process.exit(0);
}

const stats = getTrajectoryStats(entries);
printStats(stats);

if (statsOnly) {
  process.exit(0);
}

// Export
let count: number;
if (format === 'sharegpt') {
  console.log(`Exporting ${entries.length} entries as ShareGPT JSONL to ${output}...`);
  count = exportToShareGPTJSONL(entries, output);
} else {
  console.log(`Exporting ${entries.length} entries as plain JSONL to ${output}...`);
  count = exportToJSONL(entries, output);
}

console.log(`Done. Wrote ${count} entries to ${output}`);
