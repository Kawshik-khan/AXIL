# CommerceOS Production n8n Workflow Import & Deployment Guide

This guide details how to import, configure, and activate the production workflows delivered in `/n8n/workflows/` into your self-hosted or managed n8n instance.

---

## Pre-requisites

1. **Running n8n Instance**: Pinned to **n8n v1.76.0** or higher.
2. **Environment Variable Configured**: `COMMERCEOS_API_BASE_URL` set in n8n host environment (e.g. `https://api.commerceos.com.bd` or `http://localhost:3000` for local testing).
3. **CommerceOS API Token / Session Key**: Obtained from CommerceOS Settings or Developer Platform (`/enterprise/developer`).

---

## Step 1: Configure Credentials in n8n

Before importing or activating workflows, configure the shared header credential in n8n:

1. In the n8n UI, navigate to **Credentials** $\rightarrow$ **New Credential**.
2. Search for **Header Auth** (or `httpHeaderAuth`).
3. Set the credential details:
   - **Credential Name**: `CommerceOS API`
   - **Header Name**: `Authorization`
   - **Header Value**: `Bearer <your_commerceos_service_token>`
4. Click **Save**.

> [!NOTE]
> All HTTP Request nodes in the exported workflows reference the credential name `CommerceOS API`. Configuring this once binds all workflows automatically.

---

## Step 2: Import Workflow Definitions

### Option A: Via n8n CLI (Automated Deployment)

If deploying inside Docker or via CI/CD, run:

```bash
# Import the initial production workflow
n8n import:workflow --input=/n8n/workflows/commerceos-order-created-notification.json

# Import all workflows in batch
for wf in /n8n/workflows/*.json; do
  echo "Importing $wf..."
  n8n import:workflow --input="$wf"
done
```

### Option B: Via n8n Web GUI (Manual Deployment)

1. Open your n8n web dashboard.
2. In the top-right menu, select **Workflows** $\rightarrow$ **Import from File...**.
3. Select `commerceos-order-created-notification.json` from `/n8n/workflows/`.
4. Review the node graph:
   - **Order Created Webhook Trigger**
   - **Validate Event Envelope**
   - **Prepare Context & Idempotency**
   - **Call CommerceOS Notification API**
   - **Verify Execution Result**
   - **Respond Success / Failure**
5. Confirm that the **Call CommerceOS Notification API** node is linked to the `CommerceOS API` credential created in Step 1.
6. Click **Save**.

---

## Step 3: Webhook Verification & Testing

1. In the imported workflow, click on the **Order Created Webhook Trigger** node.
2. Note the Webhook URL (e.g. `https://n8n.yourdomain.com/webhook/commerceos-order-created`).
3. Register this endpoint inside CommerceOS:
   - Via Automation Hub: Go to **Automations** $\rightarrow$ **Webhooks** $\rightarrow$ **Register Webhook**.
   - Or test via curl:
   ```bash
   curl -X POST "https://n8n.yourdomain.com/webhook/commerceos-order-created" \
     -H "Content-Type: application/json" \
     -d '{
       "id": "evt_test_123456",
       "type": "order.created",
       "version": 1,
       "tenant_id": "tenant_default",
       "aggregate_type": "order",
       "aggregate_id": "ord_9999",
       "actor_id": "usr_test",
       "correlation_id": "ORD-2026-9999",
       "timestamp": "2026-09-20T12:00:00.000Z",
       "payload": {
         "order_number": "ORD-2026-9999",
         "grand_total": 2450,
         "customer_phone": "+8801700000000"
       }
     }'
   ```
4. Verify that n8n executes the steps, calls CommerceOS notification API, checks idempotency, and returns:
   ```json
   {
     "success": true,
     "verified": true,
     "status": "COMPLETED",
     "correlation_id": "ORD-2026-9999"
   }
   ```

---

## Step 4: Activation & Immutability

Once verification passes:
1. Toggle the workflow to **Active**.
2. **Immutability Principle**: Never edit active workflows in production directly. Create version $N+1$ in CommerceOS, test in `TEST` mode, approve, and deploy.

---

## Courier and payment callbacks into CommerceOS (changed in Phase 0)

`commerceos-courier-status-sync.json` and `commerceos-payment-verification.json` relay provider callbacks to
`POST /api/v1/automation/webhooks/{provider}`. Since Phase 0 (ADR-103), that endpoint accepts only signed calls:

| Part | Value |
|---|---|
| URL | `…/api/v1/automation/webhooks/{provider}?wh=<webhook id>`. Copy the full callback URL from **Automations → Webhooks**. |
| `x-webhook-timestamp` | Current Unix time in milliseconds (or seconds). It must be within 300 s of the server clock. |
| `x-webhook-signature` | Hex HMAC-SHA256 of `<timestamp>.<raw body>`, keyed with that provider's secret: the value of `STEADFAST_WEBHOOK_SECRET`, `PATHAO_WEBHOOK_SECRET`, `BKASH_WEBHOOK_SECRET` or `NAGAD_WEBHOOK_SECRET` on the CommerceOS server (at least 24 characters). |

`X-Tenant-ID`, `?tenant_id=` and bearer/header-auth credentials are ignored; the tenant is the one that owns the
webhook id. **The two workflows above do not sign yet, so their calls get `401` and change nothing.** Updating them
belongs to FIX_IMPLEMENTATION_PLAN FX-18 (machine credentials for n8n). Until then, sign in a Code node placed before
the HTTP Request node:

```js
// Needs NODE_FUNCTION_ALLOW_BUILTIN=crypto on the n8n container, and the secret available to the workflow.
const crypto = require('crypto');
const body = JSON.stringify($json);
const timestamp = Date.now().toString();
const signature = crypto.createHmac('sha256', $env.STEADFAST_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
return [{ json: { body, timestamp, signature } }];
```

Send `body` as a raw JSON string, byte for byte. If the HTTP node re-serializes it, the signature will not match.
