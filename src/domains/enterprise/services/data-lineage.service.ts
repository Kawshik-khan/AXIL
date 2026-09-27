import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 9: Enterprise Data Lineage Service
 * End-to-end data provenance tracking from source systems through transformations to BI and agent actions.
 */

import { db } from "@/infrastructure/db";
import { DataLineageTrace } from "@/types/enterprise";

export class DataLineageService {
  /**
   * Records a lineage trace connecting a business metric/asset back to its raw origins
   */
  public recordTrace(
    orgId: string,
    params: {
      targetAssetName: string;
      targetField: string;
      sourceSystem: string;
      sourceEndpointOrTable: string;
      transformationsApplied: string[];
      intermediateAggregations: string[];
    }
  ): DataLineageTrace {
    const trace: DataLineageTrace = {
      id: `lin_${Date.now()}_${randomSuffix()}`,
      organization_id: orgId,
      target_asset_name: params.targetAssetName,
      target_field: params.targetField,
      source_system: params.sourceSystem,
      source_endpoint_or_table: params.sourceEndpointOrTable,
      transformations_applied: params.transformationsApplied,
      intermediate_aggregations: params.intermediateAggregations,
      verified_timestamp: new Date().toISOString(),
    };

    return db.createDataLineage(trace);
  }

  /**
   * Retrieves the full provenance graph for a target metric or asset
   */
  public getProvenance(orgId: string, assetName: string): DataLineageTrace[] {
    const traces = db.getDataLineage(orgId);
    return traces.filter((t) => t.target_asset_name.toLowerCase() === assetName.toLowerCase());
  }
}

export const dataLineageService = new DataLineageService();
