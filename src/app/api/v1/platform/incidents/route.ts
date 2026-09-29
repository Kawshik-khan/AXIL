import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformIncidentService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

const IncidentPatch = z
  .object({
    id: z.string().min(1).max(100),
    status: z.enum(["OPEN", "INVESTIGATING", "IDENTIFIED", "MONITORING", "MITIGATING", "RESOLVED", "CLOSED"]),
    notes: z.string().max(5000).default(""),
  })
  .strict();

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const incidents = PlatformIncidentService.listIncidents(context);
    return apiSuccess(incidents);
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const incident = PlatformIncidentService.declareIncident(body, context);
    return apiSuccess(incident, undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

async function handlePATCH(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { id, status, notes } = parseOrThrow(IncidentPatch, await readJson(request));
    const updated = PlatformIncidentService.updateIncidentStatus(id, status, notes, context);
    return apiSuccess(updated);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
export const PATCH = withStore("PATCH", handlePATCH);
