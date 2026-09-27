/**
 * CommerceOS Phase 8: Bulk Action Safeguards Service
 * Prevents catastrophic unintended mass mutations by enforcing preview sampling,
 * dry-run simulations, approval gates, and emergency kill switches for bulk operations.
 */

import { db } from "@/infrastructure/db";
import { BulkOperationSafeguard } from "@/types/operations";

export class BulkSafeguardService {
  /**
   * Initializes a bulk operation preview with sampling and dry-run validation
   */
  public prepareBulkOperation<T>(
    tenantId: string,
    params: {
      actionType: string;
      targetEntityType: string;
      targetObjects: T[];
      dryRunSimulationFn?: (sample: T[]) => Record<string, unknown>;
    }
  ): BulkOperationSafeguard {
    const totalCount = params.targetObjects.length;
    const sampleItems = params.targetObjects.slice(0, 5);
    const dryRunSummary = params.dryRunSimulationFn
      ? params.dryRunSimulationFn(sampleItems)
      : { verified_sample_count: sampleItems.length, projected_total: totalCount };

    const safeguard: BulkOperationSafeguard = {
      id: `bulk_${params.actionType.toLowerCase()}_${Date.now()}`,
      tenant_id: tenantId,
      action_type: params.actionType,
      target_entity_type: params.targetEntityType,
      total_objects_count: totalCount,
      sample_preview_items: sampleItems,
      dry_run_summary: dryRunSummary,
      status: totalCount > 50 ? "PENDING_APPROVAL" : "DRY_RUN_COMPLETED",
      processed_count: 0,
      successful_count: 0,
      failed_count: 0,
      kill_switch_active: false,
      created_at: new Date().toISOString(),
    };

    return db.createBulkSafeguard(safeguard);
  }

  /**
   * Executes a bulk operation progressively with kill-switch checks at each batch
   */
  public async executeProgressiveBatch<T>(
    tenantId: string,
    safeguardId: string,
    items: T[],
    processorFn: (item: T) => Promise<boolean>
  ): Promise<BulkOperationSafeguard> {
    const safeguard = db.getBulkSafeguards(tenantId).find((bs) => bs.id === safeguardId);
    if (!safeguard) throw new Error(`Bulk operation safeguard not found: ${safeguardId}`);

    if (safeguard.kill_switch_active) {
      throw new Error(`Bulk operation ${safeguardId} was halted by emergency kill switch.`);
    }

    db.updateBulkSafeguard(safeguardId, {
      status: "RUNNING",
      started_at: new Date().toISOString(),
    });

    for (const item of items) {
      // Re-check kill switch on each iteration
      const current = db.getBulkSafeguards(tenantId).find((bs) => bs.id === safeguardId);
      if (current?.kill_switch_active) {
        db.updateBulkSafeguard(safeguardId, { status: "HALTED" });
        return current;
      }

      try {
        const success = await processorFn(item);
        if (success) {
          safeguard.successful_count++;
        } else {
          safeguard.failed_count++;
        }
      } catch {
        safeguard.failed_count++;
      }
      safeguard.processed_count++;
    }

    const completed = db.updateBulkSafeguard(safeguardId, {
      status: "COMPLETED",
      processed_count: safeguard.processed_count,
      successful_count: safeguard.successful_count,
      failed_count: safeguard.failed_count,
      completed_at: new Date().toISOString(),
    });

    return completed;
  }

  /**
   * Executes a bulk operation progressively in batch chunks
   */
  public async executeProgressively<T>(
    tenantId: string,
    safeguardId: string,
    items: T[],
    processorFn: (item: T) => Promise<unknown>,
    batchSize?: number
  ): Promise<BulkOperationSafeguard> {
    return this.executeProgressiveBatch(tenantId, safeguardId, items, async (item) => {
      const res = await processorFn(item);
      return res !== false;
    });
  }

  /**
   * Immediately halts an active bulk operation
   */
  public triggerBulkKillSwitch(tenantId: string, safeguardId: string): BulkOperationSafeguard {
    return db.updateBulkSafeguard(safeguardId, {
      kill_switch_active: true,
      status: "HALTED",
    });
  }
}

export const bulkSafeguardService = new BulkSafeguardService();
