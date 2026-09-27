/**
 * CommerceOS — AI & Agent Runs Repository
 * Tracks agent executions, tool calls, and knowledge document metadata via Neon PostgreSQL.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';
import { AgentRun } from '@/types/ai';

export class AiRepository extends BaseRepository<AgentRun> {
  constructor() {
    super('agent_runs', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async recordRun(run: AgentRun): Promise<AgentRun> {
    if (!this.isNeonConfigured()) {
      return db.createAgentRun(run);
    }

    const agentName = run.agent_type || (run as any).agent_name || "AGENT";
    const inputText = (run.metadata?.input_text as string) || (run as any).input_text || "";
    const outputText = run.final_response || (run as any).output_text || null;
    const tokensUsed = (run.input_tokens || 0) + (run.output_tokens || 0) || (run as any).tokens_used || 0;
    const costEstimated = run.estimated_cost_bdt || (run as any).cost_estimated || 0;
    const modelUsed = run.model || (run as any).model_used || null;

    await queryOne<any>(
      `INSERT INTO agent_runs (
        id, tenant_id, agent_name, conversation_id, input_text, output_text,
        status, latency_ms, tokens_used, cost_estimated, model_used, tool_calls_count, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        run.id,
        run.tenant_id,
        agentName,
        run.conversation_id || null,
        inputText,
        outputText,
        run.status,
        run.latency_ms || 0,
        tokensUsed,
        costEstimated,
        modelUsed,
        run.tool_calls_count || 0,
        JSON.stringify(run.metadata || {}),
        run.created_at || new Date().toISOString(),
      ]
    );

    // Keep fallback in sync
    db.createAgentRun(run);
    return run;
  }

  async getRecentRuns(tenantId: string, limit: number = 20): Promise<AgentRun[]> {
    if (!this.isNeonConfigured()) {
      return db.getAgentRuns(tenantId, { limit });
    }
    return query<AgentRun>(
      `SELECT * FROM agent_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit]
    );
  }
}

export const aiRepository = new AiRepository();
