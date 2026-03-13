#!/bin/bash
# Unified change detection CLI for NanoClaw agents
# Cross-cutting operations: staleness checks, stats, dedup reports, state reset

NANOCLAW_DIR="/workspace/project"
WORKSPACE_DIR="/workspace/group"

case "$1" in
  staleness)
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const expectations = {
      'reddit-jobs': 24,
      'reddit-community-forhire': 12,
      'reddit-community-freelance_forhire': 12,
      'reddit-community-jobbit': 12,
      'hn-hiring': 720,
      'hn-ask': 168,
      'hn-show': 168,
      'linkedin-jobs': 48,
      'github-help-wanted': 168,
      'jobs-all': 24,
      'jobs-upwork': 24,
      'jobs-freelancer': 24
    };
    const checks = cd.checkStaleness('$WORKSPACE_DIR', expectations);
    console.log(cd.formatStalenessReport(checks));
    "
    ;;

  stats)
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const stats = cd.getAllStats('$WORKSPACE_DIR');
    if (stats.length === 0) {
      console.log('No change detection state found.');
    } else {
      let totalTracked = 0;
      console.log('SOURCE STATS:');
      for (const s of stats) {
        totalTracked += s.tracked;
        const lastRun = s.lastRun ? new Date(s.lastRun).toLocaleString() : 'never';
        console.log('  ' + s.source + ': ' + s.tracked + ' tracked, last run ' + lastRun);
      }
      console.log('\nTotal: ' + stats.length + ' sources, ' + totalTracked + ' items tracked');
    }
    "
    ;;

  dedup-report)
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const jobSources = [
      'reddit-jobs',
      'hn-hiring',
      'linkedin-jobs',
      'github-help-wanted',
      'jobs-all',
      'jobs-upwork',
      'jobs-freelancer'
    ];
    // Filter to sources that actually have state files
    const fs = require('fs');
    const path = require('path');
    const stateDir = path.join('$WORKSPACE_DIR', '.change-detection');
    const activeSources = jobSources.filter(s =>
      fs.existsSync(path.join(stateDir, s + '.json'))
    );
    if (activeSources.length === 0) {
      console.log('No job source state found. Run monitors first.');
      process.exit(0);
    }
    const dupes = cd.findCrossPlatformDuplicates('$WORKSPACE_DIR', activeSources);
    if (dupes.size === 0) {
      console.log('No cross-platform duplicates found across ' + activeSources.length + ' sources.');
    } else {
      console.log('CROSS-PLATFORM DUPLICATES: ' + dupes.size + ' items');
      for (const id of dupes) {
        console.log('  ' + id);
      }
    }
    "
    ;;

  reset-all)
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const stats = cd.getAllStats('$WORKSPACE_DIR');
    const count = stats.length;
    cd.resetState('$WORKSPACE_DIR');
    console.log('Reset change detection state for ' + count + ' sources.');
    "
    ;;

  *)
    echo "Usage: change-detect.sh <command>"
    echo ""
    echo "Commands:"
    echo "  staleness     Check all monitors for staleness against expected intervals"
    echo "  stats         Show stats across all tracked sources"
    echo "  dedup-report  Show cross-platform duplicates across job sources"
    echo "  reset-all     Reset all change detection state"
    exit 1
    ;;
esac
