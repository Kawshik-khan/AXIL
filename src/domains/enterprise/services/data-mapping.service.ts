/**
 * CommerceOS Phase 9: Data Mapping Engine
 * Explicit field mapping, transformations, data typing, and schema translation between external systems and CommerceOS.
 */

import { db } from "@/infrastructure/db";
import { IntegrationMapping, MappingField } from "@/types/enterprise";

export class DataMappingService {
  /**
   * Defines a new field mapping schema for an integration entity
   */
  public createMapping(
    orgId: string,
    integrationId: string,
    entityType: string,
    fields: MappingField[]
  ): IntegrationMapping {
    const mapping: IntegrationMapping = {
      id: `map_${entityType.toLowerCase()}_${Date.now()}`,
      organization_id: orgId,
      integration_id: integrationId,
      entity_type: entityType,
      fields,
      version: "1.0.0",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createIntegrationMapping(mapping);
  }

  /**
   * Transforms an external payload into a normalized CommerceOS canonical object
   */
  public transformInbound(
    mapping: IntegrationMapping,
    externalData: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const field of mapping.fields) {
      let val = externalData[field.source_field];

      if (val === undefined || val === null) {
        if (field.is_required && field.default_value === undefined) {
          throw new Error(`Required field '${field.source_field}' missing from external payload`);
        }
        val = field.default_value;
      }

      // Apply transformations
      if (typeof val === "string" && field.transformation) {
        switch (field.transformation) {
          case "TRIM":
            val = val.trim();
            break;
          case "UPPERCASE":
            val = val.toUpperCase();
            break;
          case "LOWERCASE":
            val = val.toLowerCase();
            break;
          case "PARSE_NUMBER":
            val = Number(val) || 0;
            break;
          case "DATE_ISO":
            val = new Date(val).toISOString();
            break;
        }
      }

      result[field.target_field] = val;
    }

    return result;
  }
}

export const dataMappingService = new DataMappingService();
