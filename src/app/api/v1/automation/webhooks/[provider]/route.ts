import { NextResponse } from "next/server";
import { WebhookGatewayService } from "@/domains/automation/services/webhook-gateway.service";
import { CourierSyncService } from "@/domains/automation/services/courier-sync.service";
import { WebhookProvider } from "@/types/automation";
import { db } from "@/infrastructure/db";

export async function POST(
  request: Request,
  { params }: { params: { provider: string } }
) {
  try {
    const providerUpper = params.provider.toUpperCase() as WebhookProvider;
    const { searchParams } = new URL(request.url);

    // Resolve tenant context safely from query or header
    let tenantId: string =
      request.headers.get("x-tenant-id") ||
      searchParams.get("tenant_id") ||
      searchParams.get("tenant") ||
      "";

    if (!tenantId) {
      // Resolve from registered active webhook configuration for this provider
      const allWebhooks = (db as any).data.automation_webhooks || [];
      const match = allWebhooks.find((w: any) => w.provider === providerUpper && w.is_active);
      if (match) {
        tenantId = match.tenant_id;
      } else {
        tenantId = "tenant_default";
      }
    }

    const rawBody = await request.text();
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      parsedBody = {};
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // 1. Cryptographic Signature & Timestamp Freshness Verification
    const verification = await WebhookGatewayService.processInboundWebhook(tenantId, {
      provider: providerUpper,
      endpointPath: `/api/v1/automation/webhooks/${params.provider}`,
      headers,
      rawBody,
      parsedBody,
    });

    if (!verification.verified) {
      return NextResponse.json(
        {
          error: {
            code: verification.code,
            message: verification.reason,
            delivery_id: verification.deliveryId,
          },
        },
        { status: verification.code === "INVALID_SIGNATURE" ? 401 : 400 }
      );
    }

    // 2. If Courier Webhook, execute deterministic Courier Synchronization
    if (["STEADFAST", "PATHAO", "REDX", "PAPERFLY", "ECOURIER", "SUNDARBAN"].includes(providerUpper)) {
      const syncResult = await CourierSyncService.processCourierWebhook(
        tenantId,
        providerUpper as any,
        {
          tracking_number: (parsedBody.tracking_code || parsedBody.tracking_number || parsedBody.consignment_id) as string,
          consignment_id: (parsedBody.consignment_id || parsedBody.invoice_id) as string,
          raw_status: (parsedBody.status || parsedBody.delivery_status || "in_transit") as string,
          status_details: (parsedBody.status_details || parsedBody.reason || parsedBody.notes) as string,
          location: (parsedBody.current_hub || parsedBody.location) as string,
        }
      );

      return NextResponse.json({
        success: true,
        verified: true,
        delivery_id: verification.deliveryId,
        courier_sync: syncResult,
      });
    }

    return NextResponse.json({
      success: true,
      verified: true,
      delivery_id: verification.deliveryId,
      message: `Webhook for ${providerUpper} verified and ingested successfully.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "WEBHOOK_PROCESSING_FAILED",
          message: err instanceof Error ? err.message : "Error processing webhook",
        },
      },
      { status: 500 }
    );
  }
}
