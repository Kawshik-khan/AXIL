/**
 * CommerceOS Phase 4: Tenant AI Budget Metering & Cap Enforcer
 * Tracks monthly AI spend per tenant, provides soft-cap warnings (e.g. 80%)
 * and hard-cap freezes (100%) to prevent runaway API billing.
 */

import { db } from "@/infrastructure/db";
import type { TenantAiGuardSettingsRecord } from "@/types/ai";

export interface BudgetCheckResult {
  allowed: boolean;
  isSoftCapExceeded: boolean;
  isHardCapExceeded: boolean;
  currentSpendUsd: number;
  monthlyBudgetUsd: number;
  usagePercent: number;
  reason?: string;
}

export class AiBudgetGuard {
  public static readonly DEFAULT_MONTHLY_BUDGET_USD = 15.0;
  public static readonly DEFAULT_SOFT_CAP_PERCENT = 80;
  public static readonly DEFAULT_HARD_CAP_PERCENT = 100;

  /**
   * Retrieves or initializes guard settings for a tenant.
   */
  public static getSettings(tenantId: string): TenantAiGuardSettingsRecord {
    const existing = db.getTenantAiGuardSettings(tenantId);
    if (existing) return existing;

    return {
      tenant_id: tenantId,
      is_guard_enabled: true,
      monthly_budget_usd: this.DEFAULT_MONTHLY_BUDGET_USD,
      soft_cap_percent: this.DEFAULT_SOFT_CAP_PERCENT,
      hard_cap_percent: this.DEFAULT_HARD_CAP_PERCENT,
      current_month_spend_usd: 0,
      current_month_tokens_used: 0,
      confidence_escalation_threshold: 75,
      max_unresolved_turns: 3,
      high_value_cod_threshold_bdt: 5000,
      escalate_on_negative_sentiment: true,
      auto_pause_bot_on_human_message: true,
      block_adversarial_jailbreaks: true,
      quarantine_suspicious_conversations: false,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Checks if a tenant is within their allowed AI token spend budget.
   */
  public static checkBudget(tenantId: string): BudgetCheckResult {
    const settings = this.getSettings(tenantId);

    if (!settings.is_guard_enabled) {
      return {
        allowed: true,
        isSoftCapExceeded: false,
        isHardCapExceeded: false,
        currentSpendUsd: settings.current_month_spend_usd,
        monthlyBudgetUsd: settings.monthly_budget_usd,
        usagePercent: (settings.current_month_spend_usd / (settings.monthly_budget_usd || 1)) * 100,
      };
    }

    const budget = Math.max(0.01, settings.monthly_budget_usd);
    const usagePercent = (settings.current_month_spend_usd / budget) * 100;
    const isHardCapExceeded = usagePercent >= settings.hard_cap_percent;
    const isSoftCapExceeded = usagePercent >= settings.soft_cap_percent;

    if (isHardCapExceeded) {
      return {
        allowed: false,
        isSoftCapExceeded: true,
        isHardCapExceeded: true,
        currentSpendUsd: settings.current_month_spend_usd,
        monthlyBudgetUsd: budget,
        usagePercent,
        reason: `Monthly AI budget hard cap reached (${usagePercent.toFixed(1)}% of $${budget.toFixed(2)})`,
      };
    }

    return {
      allowed: true,
      isSoftCapExceeded,
      isHardCapExceeded: false,
      currentSpendUsd: settings.current_month_spend_usd,
      monthlyBudgetUsd: budget,
      usagePercent,
      ...(isSoftCapExceeded ? { reason: `AI budget soft cap warning (${usagePercent.toFixed(1)}% used)` } : {}),
    };
  }

  /**
   * Records token usage and USD cost for a turn.
   */
  public static recordSpend(tenantId: string, tokens: number, costUsd: number): TenantAiGuardSettingsRecord {
    const settings = this.getSettings(tenantId);
    const updated: TenantAiGuardSettingsRecord = {
      ...settings,
      current_month_tokens_used: (settings.current_month_tokens_used || 0) + tokens,
      current_month_spend_usd: Number(((settings.current_month_spend_usd || 0) + costUsd).toFixed(4)),
      updated_at: new Date().toISOString(),
    };

    return db.saveTenantAiGuardSettings(updated);
  }
}
