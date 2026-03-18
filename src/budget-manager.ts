/**
 * Budget Manager for NanoClaw
 *
 * Enforces daily and monthly cost caps with soft warnings and hard stops.
 * Budget config is stored in the router_state table for simplicity.
 * Cost events are stored in the cost_events table for history.
 */

import {
  getCostSummary,
  getRouterState,
  logCostEvent,
  setRouterState,
  type CostEvent,
} from './db.js';
import { logger } from './logger.js';

export interface BudgetConfig {
  // Daily budget in USD (default: $10)
  dailyLimitUsd: number;
  // Monthly budget in USD (default: $200)
  monthlyLimitUsd: number;
  // Soft warning threshold as percentage (default: 80)
  softWarningPercent: number;
  // Whether hard stops are enabled (pause all work when limit hit)
  hardStopEnabled: boolean;
  // Groups exempt from budget checks (e.g., main group for critical tasks)
  exemptGroups: string[];
}

const DEFAULT_CONFIG: BudgetConfig = {
  dailyLimitUsd: 10,
  monthlyLimitUsd: 200,
  softWarningPercent: 80,
  hardStopEnabled: true,
  exemptGroups: [],
};

let cachedConfig: BudgetConfig | null = null;

export function getBudgetConfig(): BudgetConfig {
  if (cachedConfig) return cachedConfig;

  const raw = getRouterState('budget_config');
  if (raw) {
    try {
      cachedConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      return cachedConfig!;
    } catch {
      logger.warn('Corrupted budget_config, using defaults');
    }
  }

  cachedConfig = { ...DEFAULT_CONFIG };
  return cachedConfig;
}

export function setBudgetConfig(config: Partial<BudgetConfig>): void {
  const current = getBudgetConfig();
  const updated = { ...current, ...config };
  setRouterState('budget_config', JSON.stringify(updated));
  cachedConfig = updated;
  logger.info({ config: updated }, 'Budget config updated');
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
  dailyPercent: number;
  monthlyPercent: number;
}

/**
 * Check if a container invocation is allowed under current budget constraints.
 * Returns allowed: false if hard stop is enabled and either limit is exceeded.
 */
export function checkBudget(groupFolder?: string): BudgetCheckResult {
  const config = getBudgetConfig();

  // Exempt groups bypass budget checks
  if (groupFolder && config.exemptGroups.includes(groupFolder)) {
    return {
      allowed: true,
      dailyUsed: 0,
      dailyLimit: config.dailyLimitUsd,
      monthlyUsed: 0,
      monthlyLimit: config.monthlyLimitUsd,
      dailyPercent: 0,
      monthlyPercent: 0,
    };
  }

  const summary = getCostSummary();
  const dailyPercent = (summary.dailyCostUsd / config.dailyLimitUsd) * 100;
  const monthlyPercent =
    (summary.monthlyCostUsd / config.monthlyLimitUsd) * 100;

  const result: BudgetCheckResult = {
    allowed: true,
    dailyUsed: summary.dailyCostUsd,
    dailyLimit: config.dailyLimitUsd,
    monthlyUsed: summary.monthlyCostUsd,
    monthlyLimit: config.monthlyLimitUsd,
    dailyPercent,
    monthlyPercent,
  };

  if (config.hardStopEnabled) {
    if (summary.dailyCostUsd >= config.dailyLimitUsd) {
      result.allowed = false;
      result.reason = `Daily budget exceeded: $${summary.dailyCostUsd.toFixed(2)} / $${config.dailyLimitUsd.toFixed(2)}`;
    } else if (summary.monthlyCostUsd >= config.monthlyLimitUsd) {
      result.allowed = false;
      result.reason = `Monthly budget exceeded: $${summary.monthlyCostUsd.toFixed(2)} / $${config.monthlyLimitUsd.toFixed(2)}`;
    }
  }

  return result;
}

/**
 * Check if we should emit a soft warning for approaching budget limits.
 * Returns a warning message or null.
 */
export function checkSoftWarning(): string | null {
  const config = getBudgetConfig();
  const summary = getCostSummary();

  const dailyPercent = (summary.dailyCostUsd / config.dailyLimitUsd) * 100;
  const monthlyPercent =
    (summary.monthlyCostUsd / config.monthlyLimitUsd) * 100;

  // Only warn once per threshold crossing (tracked via router_state)
  const lastDailyWarn = getRouterState('budget_daily_warn_date');
  const lastMonthlyWarn = getRouterState('budget_monthly_warn_date');
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  if (
    dailyPercent >= config.softWarningPercent &&
    lastDailyWarn !== today
  ) {
    setRouterState('budget_daily_warn_date', today);
    return `Budget warning: Daily spend at ${dailyPercent.toFixed(0)}% ($${summary.dailyCostUsd.toFixed(2)} / $${config.dailyLimitUsd.toFixed(2)})`;
  }

  if (
    monthlyPercent >= config.softWarningPercent &&
    lastMonthlyWarn !== thisMonth
  ) {
    setRouterState('budget_monthly_warn_date', thisMonth);
    return `Budget warning: Monthly spend at ${monthlyPercent.toFixed(0)}% ($${summary.monthlyCostUsd.toFixed(2)} / $${config.monthlyLimitUsd.toFixed(2)})`;
  }

  return null;
}

/**
 * Record a cost event after a container run completes.
 */
export function recordRunCost(event: Omit<CostEvent, 'id' | 'created_at'>): void {
  logCostEvent(event);

  logger.info(
    {
      groupFolder: event.group_folder,
      inputTokens: event.input_tokens,
      outputTokens: event.output_tokens,
      costUsd: event.cost_usd,
      source: event.source,
    },
    'Cost event recorded',
  );
}

/**
 * Get a formatted budget summary string for reporting.
 */
export function getBudgetSummary(): string {
  const config = getBudgetConfig();
  const summary = getCostSummary();

  const lines = [
    `Daily:   $${summary.dailyCostUsd.toFixed(2)} / $${config.dailyLimitUsd.toFixed(2)} (${((summary.dailyCostUsd / config.dailyLimitUsd) * 100).toFixed(0)}%)`,
    `Monthly: $${summary.monthlyCostUsd.toFixed(2)} / $${config.monthlyLimitUsd.toFixed(2)} (${((summary.monthlyCostUsd / config.monthlyLimitUsd) * 100).toFixed(0)}%)`,
    `Requests today: ${summary.dailyRequests}`,
  ];

  if (summary.topGroups.length > 0) {
    lines.push('Top groups (month):');
    for (const g of summary.topGroups.slice(0, 5)) {
      lines.push(`  ${g.group_folder}: $${g.cost_usd.toFixed(2)}`);
    }
  }

  return lines.join('\n');
}
