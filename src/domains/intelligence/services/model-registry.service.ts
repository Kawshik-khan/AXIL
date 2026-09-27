/**
 * CommerceOS Phase 6: Model Registry & Evaluation Service
 * Governs machine learning & statistical models, versioned artifacts, and benchmark metrics.
 */

import { db } from "@/infrastructure/db";
import { ModelRegistryEntry } from "@/types/intelligence";

export class ModelRegistryService {
  /**
   * Retrieves all registered models
   */
  public listModels(): ModelRegistryEntry[] {
    return db.getModelRegistry();
  }

  /**
   * Retrieves a specific model by ID
   */
  public getModel(id: string): ModelRegistryEntry | undefined {
    return db.getModelRegistryEntry(id);
  }

  /**
   * Registers or updates a model version
   */
  public registerModel(entry: ModelRegistryEntry): ModelRegistryEntry {
    return db.upsertModelRegistryEntry(entry);
  }
}

export const modelRegistryService = new ModelRegistryService();
