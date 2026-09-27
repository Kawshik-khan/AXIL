import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 7: Customer Journey Engine Service
 * Executes durable, multi-step customer journeys with checkpointing, wait delays, and branching.
 */

import { db } from "@/infrastructure/db";
import {
  CustomerJourney,
  JourneyStep,
  JourneyEnrollment,
  JourneyExecutionRecord,
} from "@/types/growth";
import { segmentEngineService } from "./audience.service";
import { marketingChannelService } from "./marketing-channel.service";

export class JourneyEngineService {
  /**
   * Creates a new customer journey definition
   */
  public createJourney(params: {
    tenantId: string;
    name: string;
    description: string;
    triggerEvent: string;
    steps: JourneyStep[];
  }): CustomerJourney {
    const { tenantId, name, description, triggerEvent, steps } = params;

    const journey: CustomerJourney = {
      id: `jrn_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      name,
      description,
      status: "ACTIVE",
      trigger_event: triggerEvent,
      steps,
      enrolled_count: 0,
      completed_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.insertJourney(journey);
    return journey;
  }

  /**
   * Enrolls a customer into an active journey based on a domain trigger event
   */
  public enrollCustomer(params: {
    tenantId: string;
    journeyId: string;
    customerId: string;
    contextData?: Record<string, unknown>;
  }): JourneyEnrollment {
    const { tenantId, journeyId, customerId, contextData = {} } = params;

    const journey = db.getJourneyById(tenantId, journeyId);
    if (!journey || journey.tenant_id !== tenantId || journey.status !== "ACTIVE") {
      throw new Error(`Journey not found or not active: ${journeyId}`);
    }

    const firstStep = journey.steps[0];
    if (!firstStep) {
      throw new Error(`Journey ${journeyId} has no configured steps.`);
    }

    const enrollment: JourneyEnrollment = {
      id: `enr_${Date.now()}_${customerId}`,
      tenant_id: tenantId,
      journey_id: journeyId,
      customer_id: customerId,
      current_step_id: firstStep.id,
      status: "ENROLLED",
      context_data: contextData,
      enrolled_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.insertJourneyEnrollment(enrollment);
    db.updateJourney(tenantId, journeyId, { enrolled_count: journey.enrolled_count + 1 });

    return enrollment;
  }

  /**
   * Executes the next step in an enrolled journey
   */
  public async advanceEnrollment(tenantId: string, enrollmentId: string): Promise<JourneyEnrollment> {
    const enrollment = db.getJourneyEnrollments(tenantId).find((e) => e.id === enrollmentId);
    if (!enrollment) {
      throw new Error(`Enrollment not found: ${enrollmentId}`);
    }

    if (enrollment.status === "COMPLETED" || enrollment.status === "EXITED" || enrollment.status === "PAUSED") {
      return enrollment;
    }

    const journey = db.getJourneyById(tenantId, enrollment.journey_id);
    if (!journey) throw new Error(`Journey not found: ${enrollment.journey_id}`);

    const currentStep = journey.steps.find((s) => s.id === enrollment.current_step_id);
    if (!currentStep) {
      db.updateJourneyEnrollment(tenantId, enrollmentId, { status: "COMPLETED" });
      return { ...enrollment, status: "COMPLETED" };
    }

    // 1. Wait node handling
    if (currentStep.type === "WAIT") {
      const waitMinutes = currentStep.config.wait_duration_minutes || 60;
      const waitUntil = new Date(Date.now() + waitMinutes * 60000).toISOString();

      if (!enrollment.wait_until) {
        db.updateJourneyEnrollment(tenantId, enrollmentId, {
          status: "WAITING",
          wait_until: waitUntil,
        });
        return { ...enrollment, status: "WAITING", wait_until: waitUntil };
      }

      // Check if wait time elapsed
      if (new Date() < new Date(enrollment.wait_until)) {
        return enrollment; // Still waiting
      }
    }

    // 2. Action node handling
    let actionResult: Record<string, unknown> = { executed: true };
    if (currentStep.type === "ACTION") {
      if (currentStep.config.action_type === "SEND_MESSAGE" && currentStep.config.channel) {
        const cust = db.findCustomerById(tenantId, enrollment.customer_id);
        const recipient = cust?.phone || cust?.email || enrollment.customer_id;

        const res = await marketingChannelService.dispatchMessage({
          tenantId,
          channel: currentStep.config.channel,
          recipientId: recipient,
          content: `Automated journey update from '${journey.name}'`,
        });
        actionResult = { channel_delivery: res };
      }
    }

    // 3. Exit node handling
    if (currentStep.type === "EXIT") {
      db.updateJourneyEnrollment(tenantId, enrollmentId, {
        status: "EXITED",
        exit_reason: currentStep.config.exit_reason || "REACHED_EXIT_NODE",
      });
      return { ...enrollment, status: "EXITED" };
    }

    // Record execution audit log
    const execRecord: JourneyExecutionRecord = {
      id: `jex_${Date.now()}_${enrollmentId}`,
      tenant_id: tenantId,
      journey_id: journey.id,
      enrollment_id: enrollmentId,
      step_id: currentStep.id,
      node_type: currentStep.type,
      action_result: actionResult,
      executed_at: new Date().toISOString(),
    };
    db.insertJourneyExecution(execRecord);

    // Advance to next step
    if (currentStep.next_step_id) {
      db.updateJourneyEnrollment(tenantId, enrollmentId, {
        current_step_id: currentStep.next_step_id,
        status: "EXECUTING",
        wait_until: undefined,
        last_action_at: new Date().toISOString(),
      });
      return {
        ...enrollment,
        current_step_id: currentStep.next_step_id,
        status: "EXECUTING",
      };
    } else {
      // Reached journey end
      db.updateJourneyEnrollment(tenantId, enrollmentId, {
        status: "COMPLETED",
        last_action_at: new Date().toISOString(),
      });
      db.updateJourney(tenantId, journey.id, { completed_count: journey.completed_count + 1 });
      return { ...enrollment, status: "COMPLETED" };
    }
  }

  /**
   * Pauses a journey
   */
  public pauseJourney(tenantId: string, journeyId: string): CustomerJourney {
    const journey = db.getJourneyById(tenantId, journeyId);
    if (!journey || journey.tenant_id !== tenantId) {
      throw new Error(`Journey not found: ${journeyId}`);
    }
    return db.updateJourney(tenantId, journeyId, { status: "PAUSED" });
  }

  /**
   * Resumes a journey
   */
  public resumeJourney(tenantId: string, journeyId: string): CustomerJourney {
    const journey = db.getJourneyById(tenantId, journeyId);
    if (!journey || journey.tenant_id !== tenantId) {
      throw new Error(`Journey not found: ${journeyId}`);
    }
    return db.updateJourney(tenantId, journeyId, { status: "ACTIVE" });
  }
}

export const journeyEngineService = new JourneyEngineService();
