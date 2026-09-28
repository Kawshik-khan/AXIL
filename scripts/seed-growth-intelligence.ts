import * as fs from "fs";
import * as path from "path";
import {
  CustomerLifecycleRecord,
  CustomerLifecycleTransition,
  Audience,
  AudienceMember,
  GrowthCampaign,
  CustomerJourney,
  CampaignAttribution,
  GrowthInsight,
  GrowthRecommendation,
  GrowthExperiment,
  GrowthOffer,
  LifecycleStage,
} from "../src/types/growth";
import { ActionRiskLevel } from "../src/types/orchestration";
import { assertNoOtherStoreWriter } from "./lib/store-guard";

// Refuse to write the JSON store while the app (or another script) owns it (FX-24).
assertNoOtherStoreWriter();

const TENANT_ID = "ten_default_dhaka";
const USER_ID = "usr_owner_default";

function run() {
  console.log("=== COMMERCEOS GROWTH COMMAND CENTER SEEDER ===");

  const dataDir = path.join(process.cwd(), ".data");
  const dbFile = path.join(dataDir, "commerceos.json");
  const custSeedPath = path.join(process.cwd(), "src/infrastructure/db/seeds/customers-10000.json");
  const prodSeedPath = path.join(process.cwd(), "src/infrastructure/db/seeds/products-catalog.json");
  const orderSeedPath = path.join(process.cwd(), "src/infrastructure/db/seeds/orders-5000.json");
  const growthSeedPath = path.join(process.cwd(), "src/infrastructure/db/seeds/growth-data.json");

  console.log("Loading master seeds...");
  const custData = JSON.parse(fs.readFileSync(custSeedPath, "utf-8"));
  const prodData = JSON.parse(fs.readFileSync(prodSeedPath, "utf-8"));
  const orderData = JSON.parse(fs.readFileSync(orderSeedPath, "utf-8"));

  const customers = custData.customers || [];
  const addresses = custData.addresses || [];
  const products = prodData.products || [];
  const productVariants = prodData.productVariants || [];
  const inventoryItems = prodData.inventoryItems || [];
  const categories = prodData.categories || [];
  const brands = prodData.brands || [];
  const warehouses = prodData.warehouses || [];
  const orders = orderData.orders || [];
  const orderItems = orderData.orderItems || [];
  const shipments = orderData.shipments || [];
  const payments = orderData.payments || [];

  console.log(`Loaded: ${customers.length} customers, ${orders.length} orders, ${products.length} products`);

  // 1. Map orders by customer ID
  console.log("Indexing orders by customer...");
  const ordersByCustomer = new Map<string, any[]>();
  for (const o of orders) {
    if (!o.customer_id) continue;
    let list = ordersByCustomer.get(o.customer_id);
    if (!list) {
      list = [];
      ordersByCustomer.set(o.customer_id, list);
    }
    list.push(o);
  }

  // 2. Compute deterministic Customer Lifecycles for all 10,008 customers
  console.log("Evaluating deterministic customer lifecycles...");
  const lifecycles: CustomerLifecycleRecord[] = [];
  const transitions: CustomerLifecycleTransition[] = [];
  const now = Date.now();
  const nowIso = new Date().toISOString();

  const lifecycleCounts: Record<LifecycleStage, number> = {
    PROSPECT: 0,
    NEW: 0,
    FIRST_PURCHASE: 0,
    ACTIVE: 0,
    REPEAT: 0,
    LOYAL: 0,
    AT_RISK: 0,
    DORMANT: 0,
    CHURNED: 0,
    REACTIVATED: 0,
  };

  const vipCustomerIds: string[] = [];
  const dormantCustomerIds: string[] = [];
  const repeatCustomerIds: string[] = [];
  const cartAbandonerIds: string[] = [];
  const dhakaCustomerIds: string[] = [];

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    const custOrders = ordersByCustomer.get(c.id) || [];
    const totalSpend = custOrders.reduce((sum: number, o: any) => sum + (o.grand_total || 0), 0);
    const orderCount = custOrders.length;
    const aov = orderCount > 0 ? Math.round(totalSpend / orderCount) : 0;

    const timestamps = custOrders
      .map((o: any) => new Date(o.created_at).getTime())
      .filter((t: number) => !isNaN(t))
      .sort((a: number, b: number) => b - a);

    const daysSinceLastOrder = timestamps.length > 0 ? Math.floor((now - timestamps[0]) / 86400000) : 999;
    const lastOrderAt = timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : undefined;

    let stage: LifecycleStage = "PROSPECT";
    if (orderCount === 0) {
      stage = i % 3 === 0 ? "NEW" : "PROSPECT";
    } else if (orderCount >= 5 || totalSpend >= 25000) {
      if (daysSinceLastOrder > 75) {
        stage = "AT_RISK";
      } else {
        stage = "LOYAL";
      }
    } else if (orderCount >= 2) {
      if (daysSinceLastOrder > 120) {
        stage = "CHURNED";
      } else if (daysSinceLastOrder > 60) {
        stage = "DORMANT";
      } else if (daysSinceLastOrder > 30) {
        stage = "AT_RISK";
      } else {
        stage = daysSinceLastOrder <= 10 && orderCount === 2 ? "REACTIVATED" : "REPEAT";
      }
    } else if (orderCount === 1) {
      if (daysSinceLastOrder <= 14) {
        stage = "FIRST_PURCHASE";
      } else if (daysSinceLastOrder <= 45) {
        stage = "ACTIVE";
      } else if (daysSinceLastOrder <= 90) {
        stage = "AT_RISK";
      } else {
        stage = "DORMANT";
      }
    }

    lifecycleCounts[stage] = (lifecycleCounts[stage] || 0) + 1;

    const churnRisk = daysSinceLastOrder > 90 ? 0.85 : daysSinceLastOrder > 45 ? 0.55 : 0.12;
    const predictedLtv = Math.round(totalSpend * (orderCount > 2 ? 1.85 : 1.35));

    const enteredAt = lastOrderAt || c.created_at || nowIso;
    const daysInStage = Math.max(0, Math.floor((now - new Date(enteredAt).getTime()) / 86400000));

    lifecycles.push({
      id: `cl_${c.id}`,
      tenant_id: TENANT_ID,
      customer_id: c.id,
      stage,
      stage_entered_at: enteredAt,
      days_in_current_stage: daysInStage,
      order_count: orderCount,
      total_revenue_bdt: totalSpend,
      average_order_value_bdt: aov,
      last_order_at: lastOrderAt,
      predicted_churn_risk: churnRisk,
      predicted_ltv_12m_bdt: predictedLtv,
      created_at: c.created_at || nowIso,
      updated_at: nowIso,
    });

    // Generate transitions for key stages
    if (stage === "LOYAL" || stage === "REPEAT" || stage === "FIRST_PURCHASE" || stage === "DORMANT") {
      transitions.push({
        id: `clt_${now}_${c.id}`,
        tenant_id: TENANT_ID,
        customer_id: c.id,
        from_stage: orderCount === 1 ? "NEW" : orderCount === 2 ? "FIRST_PURCHASE" : "ACTIVE",
        to_stage: stage,
        trigger_event: orderCount > 0 ? "order.created" : "inactivity.threshold",
        reason: orderCount > 0
          ? `Placed verified order totaling ৳${totalSpend}. Evaluated into ${stage}.`
          : `Inactive for ${daysSinceLastOrder} days. Evaluated into ${stage}.`,
        transitioned_at: enteredAt,
      });
    }

    // Classify into audience cohorts
    if (totalSpend >= 5000 && orderCount >= 2) vipCustomerIds.push(c.id);
    if (stage === "DORMANT" || stage === "AT_RISK") dormantCustomerIds.push(c.id);
    if (orderCount >= 2) repeatCustomerIds.push(c.id);
    if (orderCount === 0 && (c.source === "SOCIAL" || c.source === "CHAT")) cartAbandonerIds.push(c.id);
    if (c.district === "Dhaka") dhakaCustomerIds.push(c.id);
  }

  console.log("Lifecycle distribution:", lifecycleCounts);

  // 3. Create Audiences
  console.log("Building audiences and membership graphs...");
  const audiences: Audience[] = [
    {
      id: "aud_vip_spenders",
      tenant_id: TENANT_ID,
      name: "VIP High Spenders (>৳5k LTV)",
      description: "High-equity customers with verified lifetime value > ৳5,000 and 2+ repeat orders",
      type: "DYNAMIC",
      status: "ACTIVE",
      rule_groups: [
        {
          conjunction: "AND",
          conditions: [
            { field: "total_spend", operator: "GREATER_THAN_OR_EQUAL", value: 5000 },
            { field: "order_count", operator: "GREATER_THAN_OR_EQUAL", value: 2 },
          ],
        },
      ],
      estimated_size: vipCustomerIds.length,
      last_evaluated_at: nowIso,
      created_by: USER_ID,
      created_at: new Date(now - 7 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "aud_dormant_winback",
      tenant_id: TENANT_ID,
      name: "Dormant & At-Risk Buyers",
      description: "Prior buyers with no orders in over 45 days requiring win-back intervention",
      type: "PREDICTIVE",
      status: "ACTIVE",
      rule_groups: [
        {
          conjunction: "OR",
          conditions: [
            { field: "lifecycle_stage", operator: "EQUALS", value: "DORMANT" },
            { field: "lifecycle_stage", operator: "EQUALS", value: "AT_RISK" },
          ],
        },
      ],
      estimated_size: dormantCustomerIds.length,
      last_evaluated_at: nowIso,
      created_by: USER_ID,
      created_at: new Date(now - 14 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "aud_repeat_buyers",
      tenant_id: TENANT_ID,
      name: "Active Repeat Buyers",
      description: "Customers who have completed 2 or more verified orders across all channels",
      type: "DYNAMIC",
      status: "ACTIVE",
      rule_groups: [
        {
          conjunction: "AND",
          conditions: [{ field: "order_count", operator: "GREATER_THAN_OR_EQUAL", value: 2 }],
        },
      ],
      estimated_size: repeatCustomerIds.length,
      last_evaluated_at: nowIso,
      created_by: USER_ID,
      created_at: new Date(now - 21 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "aud_cart_abandoners",
      tenant_id: TENANT_ID,
      name: "WhatsApp Conversational Carts",
      description: "Abandoned conversational shopping cart sessions via WhatsApp & Messenger",
      type: "BEHAVIORAL",
      status: "ACTIVE",
      rule_groups: [
        {
          conjunction: "AND",
          conditions: [{ field: "source", operator: "EQUALS", value: "SOCIAL" }],
        },
      ],
      estimated_size: cartAbandonerIds.length,
      last_evaluated_at: nowIso,
      created_by: USER_ID,
      created_at: new Date(now - 10 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "aud_dhaka_fast",
      tenant_id: TENANT_ID,
      name: "Dhaka Metropolitan Fast-Delivery",
      description: "Customers in Dhaka eligible for Steadfast next-day guaranteed fulfillment",
      type: "STATIC",
      status: "ACTIVE",
      rule_groups: [
        {
          conjunction: "AND",
          conditions: [{ field: "location", operator: "EQUALS", value: "Dhaka" }],
        },
      ],
      estimated_size: dhakaCustomerIds.length,
      last_evaluated_at: nowIso,
      created_by: USER_ID,
      created_at: new Date(now - 30 * 86400000).toISOString(),
      updated_at: nowIso,
    },
  ];

  const audienceMembers: AudienceMember[] = [];
  for (const cid of vipCustomerIds.slice(0, 300)) {
    audienceMembers.push({
      id: `mem_vip_${cid}`,
      tenant_id: TENANT_ID,
      audience_id: "aud_vip_spenders",
      customer_id: cid,
      matched_at: nowIso,
      match_reasons: ["LTV exceeds ৳5,000", "Order count >= 2"],
    });
  }
  for (const cid of dormantCustomerIds.slice(0, 300)) {
    audienceMembers.push({
      id: `mem_dorm_${cid}`,
      tenant_id: TENANT_ID,
      audience_id: "aud_dormant_winback",
      customer_id: cid,
      matched_at: nowIso,
      match_reasons: ["Inactivity > 45 days", "Stage: DORMANT/AT_RISK"],
    });
  }

  // 4. Create Governed Campaigns
  console.log("Setting up multi-channel campaigns...");
  const campaigns: GrowthCampaign[] = [
    {
      id: "cmp_wa_vip_eid",
      tenant_id: TENANT_ID,
      name: "Eid Festive Drop • VIP WhatsApp Exclusive",
      objective: "CONVERSION",
      status: "RUNNING",
      audience_id: "aud_vip_spenders",
      channel: "WHATSAPP",
      variants: [
        {
          id: "var_wa_vip_01",
          name: "Early Access VIP Link",
          subject_or_title: "Exclusive Eid VIP Early Access",
          content_body: "Assalamu Alaikum {customer_name}! Apnar jonno amader Royal Panjabi & Muslin Festive collection ekhon early access e: https://commerceos.io/vip. Reply STOP to unsubscribe",
          call_to_action: "Shop Early Access",
          allocation_pct: 100,
        },
      ],
      budget_bdt: 35000,
      action_risk_level: ActionRiskLevel.MEDIUM,
      required_approval: false,
      risk_class: "MEDIUM",
      simulation_snapshot: {
        simulated_at: new Date(now - 14 * 86400000).toISOString(),
        estimated_reach: 480,
        expected_conversion_rate: 18.2,
        expected_orders: 87,
        expected_revenue_bdt: 2900000,
        expected_cost_bdt: 35000,
        expected_margin_delta_pct: 22.4,
        simulated_label: "SIMULATED",
      },
      result_metrics: {
        planned_audience: 520,
        actual_audience: 512,
        messages_sent: 512,
        messages_delivered: 508,
        messages_failed: 4,
        messages_suppressed: 0,
        engagements: 294,
        conversions: 92,
        attributed_revenue_bdt: 2840000,
        incremental_revenue_bdt: 1988000,
        total_cost_bdt: 32400,
        roas: 8.76,
        evaluated_at: nowIso,
      },
      created_by: USER_ID,
      created_at: new Date(now - 15 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "cmp_fb_winter_panjabi",
      tenant_id: TENANT_ID,
      name: "Winter Royal Panjabi & Blazer Drop",
      objective: "CONVERSION",
      status: "RUNNING",
      audience_id: "aud_repeat_buyers",
      channel: "FACEBOOK_MESSENGER",
      variants: [
        {
          id: "var_fb_01",
          name: "Winter Collection Catalog",
          subject_or_title: "Winter Collection Live",
          content_body: "Discover our premium heavy cotton Panjabis and tailored winter waistcoats. Enjoy nationwide delivery: https://commerceos.io/winter",
          call_to_action: "View Catalog",
          allocation_pct: 100,
        },
      ],
      budget_bdt: 28000,
      action_risk_level: ActionRiskLevel.LOW,
      required_approval: false,
      risk_class: "LOW",
      result_metrics: {
        planned_audience: 650,
        actual_audience: 640,
        messages_sent: 640,
        messages_delivered: 632,
        messages_failed: 8,
        messages_suppressed: 0,
        engagements: 310,
        conversions: 84,
        attributed_revenue_bdt: 2180000,
        incremental_revenue_bdt: 1526000,
        total_cost_bdt: 26100,
        roas: 8.35,
        evaluated_at: nowIso,
      },
      created_by: USER_ID,
      created_at: new Date(now - 18 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "cmp_ig_muslin_saree",
      tenant_id: TENANT_ID,
      name: "Handloom Muslin Saree Collection",
      objective: "AWARENESS",
      status: "RUNNING",
      audience_id: "aud_dhaka_fast",
      channel: "INSTAGRAM",
      variants: [
        {
          id: "var_ig_01",
          name: "Artisanal Silk Story",
          subject_or_title: "Pure Handloom Muslin",
          content_body: "Authentic Tangail and Jamdani muslin sarees handwoven with pure silk yarn. Free Dhaka delivery today: https://commerceos.io/sarees",
          call_to_action: "Explore Sarees",
          allocation_pct: 100,
        },
      ],
      budget_bdt: 22000,
      action_risk_level: ActionRiskLevel.LOW,
      required_approval: false,
      risk_class: "LOW",
      result_metrics: {
        planned_audience: 400,
        actual_audience: 395,
        messages_sent: 395,
        messages_delivered: 391,
        messages_failed: 4,
        messages_suppressed: 0,
        engagements: 198,
        conversions: 61,
        attributed_revenue_bdt: 1920000,
        incremental_revenue_bdt: 1344000,
        total_cost_bdt: 21500,
        roas: 8.93,
        evaluated_at: nowIso,
      },
      created_by: USER_ID,
      created_at: new Date(now - 22 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "cmp_wa_winback_15",
      tenant_id: TENANT_ID,
      name: "Automated VIP Comeback 15% Nudge",
      objective: "REACTIVATION",
      status: "RUNNING",
      audience_id: "aud_dormant_winback",
      channel: "WHATSAPP",
      variants: [
        {
          id: "var_wb_01",
          name: "Comeback Voucher",
          subject_or_title: "15% Special Comeback Voucher",
          content_body: "Assalamu Alaikum {customer_name}! We missed you at CommerceOS. Use code 'COMEBACK15' for 15% off your next order: https://commerceos.io/shop",
          call_to_action: "Claim 15% OFF",
          allocation_pct: 100,
        },
      ],
      budget_bdt: 12000,
      action_risk_level: ActionRiskLevel.HIGH,
      required_approval: false,
      risk_class: "HIGH",
      result_metrics: {
        planned_audience: 280,
        actual_audience: 275,
        messages_sent: 275,
        messages_delivered: 270,
        messages_failed: 5,
        messages_suppressed: 0,
        engagements: 142,
        conversions: 38,
        attributed_revenue_bdt: 890000,
        incremental_revenue_bdt: 623000,
        total_cost_bdt: 11800,
        roas: 7.54,
        evaluated_at: nowIso,
      },
      created_by: USER_ID,
      created_at: new Date(now - 25 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "cmp_web_cart_recovery",
      tenant_id: TENANT_ID,
      name: "Autonomous Web Abandoned Cart Follow-up",
      objective: "CONVERSION",
      status: "SCHEDULED",
      audience_id: "aud_cart_abandoners",
      channel: "WHATSAPP",
      variants: [
        {
          id: "var_cr_01",
          name: "Cart Reminder with Free Shipping",
          subject_or_title: "Your cart is waiting",
          content_body: "Did you forget something? Complete your order now and get free delivery across Bangladesh: https://commerceos.io/cart",
          call_to_action: "Checkout Now",
          allocation_pct: 100,
        },
      ],
      budget_bdt: 8500,
      action_risk_level: ActionRiskLevel.MEDIUM,
      required_approval: true,
      risk_class: "MEDIUM",
      result_metrics: {
        planned_audience: 190,
        actual_audience: 185,
        messages_sent: 185,
        messages_delivered: 182,
        messages_failed: 3,
        messages_suppressed: 0,
        engagements: 98,
        conversions: 27,
        attributed_revenue_bdt: 620000,
        incremental_revenue_bdt: 434000,
        total_cost_bdt: 8100,
        roas: 7.65,
        evaluated_at: nowIso,
      },
      created_by: USER_ID,
      created_at: new Date(now - 5 * 86400000).toISOString(),
      updated_at: nowIso,
    },
  ];

  // 5. Generate Campaign Attributions for real orders
  console.log("Synthesizing multi-touch campaign attributions for orders...");
  const campaignAttributions: CampaignAttribution[] = [];
  const campaignIds = ["cmp_wa_vip_eid", "cmp_fb_winter_panjabi", "cmp_ig_muslin_saree", "cmp_wa_winback_15", "cmp_web_cart_recovery"];
  const channels: Array<"WHATSAPP" | "FACEBOOK_MESSENGER" | "INSTAGRAM"> = ["WHATSAPP", "FACEBOOK_MESSENGER", "INSTAGRAM"];

  let totalAttributedRev = 0;
  let totalIncrementalRev = 0;

  // Attribute ~2,000 real orders to campaigns
  for (let i = 0; i < orders.length; i++) {
    if (i % 2 !== 0 && i % 5 !== 0) continue; // attribute approx 40% of orders
    const order = orders[i];
    const orderTotal = order.grand_total || 2500;
    const cid = campaignIds[i % campaignIds.length];
    const channel = channels[i % channels.length];

    const touchTime = new Date(new Date(order.created_at).getTime() - 2 * 3600000).toISOString();
    const incrementalEst = Math.round(orderTotal * 0.7);

    campaignAttributions.push({
      id: `att_${order.id}`,
      tenant_id: TENANT_ID,
      order_id: order.id,
      customer_id: order.customer_id,
      order_total_bdt: orderTotal,
      attribution_model: "LAST_TOUCH",
      touchpoints: [
        {
          touch_id: `tch_${order.id}`,
          campaign_id: cid,
          channel: channel as any,
          touched_at: touchTime,
          weight: 1.0,
        },
      ],
      campaign_credits: {
        [cid]: {
          attributed_revenue_bdt: orderTotal,
          share_pct: 100,
        },
      },
      incremental_revenue_estimated_bdt: incrementalEst,
      created_at: order.created_at,
    });

    totalAttributedRev += orderTotal;
    totalIncrementalRev += incrementalEst;
  }

  console.log(`Generated ${campaignAttributions.length} attributions: Total Attributed ৳${totalAttributedRev.toLocaleString()}, Incremental ৳${totalIncrementalRev.toLocaleString()}`);

  // 6. Create Customer Journeys
  console.log("Setting up autonomous customer journeys...");
  const journeys: CustomerJourney[] = [
    {
      id: "jrn_cart_recovery",
      tenant_id: TENANT_ID,
      name: "Abandoned Cart Recovery Flow",
      description: "Automated 3-touch WhatsApp nudge sequence for cart drops over 60 minutes",
      status: "ACTIVE",
      trigger_event: "cart.abandoned",
      steps: [
        {
          id: "step_wait_60m",
          type: "WAIT",
          title: "Wait 60 Minutes",
          config: { wait_duration_minutes: 60 },
          next_step_id: "step_send_wa_nudge",
        },
        {
          id: "step_send_wa_nudge",
          type: "ACTION",
          title: "Send WhatsApp Friendly Nudge",
          config: {
            action_type: "SEND_MESSAGE",
            channel: "WHATSAPP",
          },
          next_step_id: "step_wait_24h",
        },
        {
          id: "step_wait_24h",
          type: "WAIT",
          title: "Wait 24 Hours",
          config: { wait_duration_minutes: 1440 },
          next_step_id: "step_send_free_ship",
        },
        {
          id: "step_send_free_ship",
          type: "ACTION",
          title: "Offer Free Delivery Voucher",
          config: {
            action_type: "CREATE_DISCOUNT_OFFER",
            channel: "WHATSAPP",
          },
        },
      ],
      enrolled_count: 342,
      completed_count: 298,
      created_at: new Date(now - 30 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "jrn_dormancy_winback",
      tenant_id: TENANT_ID,
      name: "VIP Dormancy Win-Back Automation",
      description: "Triggered when a customer with >৳5,000 spend has zero orders for 45 days",
      status: "ACTIVE",
      trigger_event: "customer.dormancy_detected",
      steps: [
        {
          id: "step_check_vip",
          type: "CONDITION",
          title: "Verify VIP Equity",
          config: {
            condition_predicate: {
              field: "total_spend",
              operator: "GREATER_THAN_OR_EQUAL",
              value: 5000,
            },
          },
          next_step_id: "step_send_comeback_wa",
        },
        {
          id: "step_send_comeback_wa",
          type: "ACTION",
          title: "Send 15% Comeback Offer",
          config: {
            action_type: "SEND_MESSAGE",
            channel: "WHATSAPP",
          },
        },
      ],
      enrolled_count: 186,
      completed_count: 142,
      created_at: new Date(now - 25 * 86400000).toISOString(),
      updated_at: nowIso,
    },
    {
      id: "jrn_post_delivery",
      tenant_id: TENANT_ID,
      name: "Post-Delivery Cross-Sell Journey",
      description: "Recommends complementary accessories 3 days after courier marks order DELIVERED",
      status: "ACTIVE",
      trigger_event: "shipment.delivered",
      steps: [
        {
          id: "step_wait_3d",
          type: "WAIT",
          title: "Wait 3 Days Post Delivery",
          config: { wait_duration_minutes: 4320 },
          next_step_id: "step_send_cross_sell",
        },
        {
          id: "step_send_cross_sell",
          type: "ACTION",
          title: "Send Messenger Matching Accessories",
          config: {
            action_type: "SEND_MESSAGE",
            channel: "FACEBOOK_MESSENGER",
          },
        },
      ],
      enrolled_count: 624,
      completed_count: 512,
      created_at: new Date(now - 20 * 86400000).toISOString(),
      updated_at: nowIso,
    },
  ];

  // 7. Create AI Growth Insights & Recommendations
  console.log("Synthesizing AI Growth Insights & Recommendations...");
  const growthInsights: GrowthInsight[] = [
    {
      id: "ins_dormancy_vip",
      tenant_id: TENANT_ID,
      type: "HIGH_VALUE_DORMANCY",
      title: `${dormantCustomerIds.length} VIP Customers Entering Inactivity Window`,
      summary: `Detected ${dormantCustomerIds.length} high-value customers with historical spend exceeding ৳5,000 who have not ordered in the past 45+ days. Immediate win-back activation recommended.`,
      evidence: [
        {
          id: "evi_dorm_01",
          source_type: "CUSTOMER",
          source_id: "cust_cohort_dormant",
          metric: "historical_spend",
          value: 48500,
          timestamp: nowIso,
          confidence: 0.96,
          query_version: "v1.0",
          description: "Top dormant customer cohort average LTV is ৳6,420 across 3.2 lifetime orders",
        },
      ],
      severity: "HIGH",
      detected_at: nowIso,
    },
    {
      id: "ins_repeat_rate",
      tenant_id: TENANT_ID,
      type: "REPEAT_PURCHASE_DROP",
      title: "Second-Purchase Velocity Window Detected",
      summary: "First-time buyers show highest repeat conversion probability between day 7 and day 14 post-delivery. Automated cross-sell triggers capture 24% higher GMV.",
      evidence: [
        {
          id: "evi_rep_01",
          source_type: "METRIC",
          source_id: "repeat_customer_rate",
          metric: "repeat_customer_rate",
          value: 38.4,
          timestamp: nowIso,
          confidence: 0.92,
          query_version: "v1.0",
          description: "Healthy 38.4% overall repeat rate across 5,004 orders",
        },
      ],
      severity: "MEDIUM",
      detected_at: nowIso,
    },
  ];

  const growthRecommendations: GrowthRecommendation[] = [
    {
      id: "grec_wa_winback",
      tenant_id: TENANT_ID,
      title: "Execute VIP Dormancy Win-Back Campaign on WhatsApp",
      strategy: "Target 280 top dormant purchasers with an exclusive 15% comeback voucher ('COMEBACK15') and personalized recommendations.",
      target_audience_name: "Dormant & At-Risk Buyers",
      recommended_channel: "WHATSAPP",
      rationale: "Reactivating a verified high-value customer costs 5x less than acquiring a new customer, and protects historical customer equity.",
      evidence: growthInsights[0].evidence,
      expected_impact: {
        projected_revenue_bdt: 345000,
        projected_roi_multiplier: 7.4,
        summary: "Projected reactivation of 25-30% of dormant VIPs, yielding ~৳345,000 in recovered revenue.",
      },
      action_risk_level: ActionRiskLevel.HIGH,
      required_autonomy_level: 3,
      assumptions: [
        "Customers remain reachable on registered WhatsApp mobile numbers.",
        "Catalog contains sufficient in-stock items in their historically preferred categories.",
      ],
      expires_at: new Date(now + 7 * 86400000).toISOString(),
      status: "PROPOSED",
      created_at: nowIso,
    },
    {
      id: "grec_cross_sell",
      tenant_id: TENANT_ID,
      title: "Activate Automated Post-Delivery Accessory Cross-Sell Journey",
      strategy: "Trigger an automated Messenger/WhatsApp message 3 days after courier delivery recommending top matching accessories with free delivery subsidy.",
      target_audience_name: "Recent Delivered Purchasers (Last 7 Days)",
      recommended_channel: "WHATSAPP",
      rationale: "Customer satisfaction is highest immediately following successful order delivery, presenting an optimal conversion window for accessories.",
      evidence: growthInsights[1].evidence,
      expected_impact: {
        projected_revenue_bdt: 185000,
        projected_roi_multiplier: 8.2,
        summary: "Boosts second-order conversion velocity by 18% with negligible operational overhead.",
      },
      action_risk_level: ActionRiskLevel.MEDIUM,
      required_autonomy_level: 2,
      assumptions: ["Steadfast/Pathao courier delivery webhook delivers accurate DELIVERED timestamps."],
      expires_at: new Date(now + 14 * 86400000).toISOString(),
      status: "PROPOSED",
      created_at: nowIso,
    },
    {
      id: "grec_advance_cod",
      tenant_id: TENANT_ID,
      title: "Enforce ৳150 Advance for High-RTO Districts (Cox's Bazar, Sunamganj)",
      strategy: "Require automated bKash ৳150 delivery charge advance for high-refusal districts before shipment dispatch.",
      target_audience_name: "High-RTO Regional Orders",
      recommended_channel: "WHATSAPP",
      rationale: "Doorstep refusal rates in remote districts reach 18.2%. Collecting delivery cost advance reduces doorstep cancellations by 68%.",
      evidence: [
        {
          id: "evi_rto_01",
          source_type: "METRIC",
          source_id: "courier_rto_hotspots",
          metric: "rto_rate_pct",
          value: 18.2,
          timestamp: nowIso,
          confidence: 0.94,
          query_version: "v1.0",
          description: "Elevated RTO observed in Cox's Bazar and Sunamganj",
        },
      ],
      expected_impact: {
        projected_revenue_bdt: 92000,
        projected_roi_multiplier: 5.6,
        summary: "Saves ~৳92,000 monthly in wasted two-way courier return penalties.",
      },
      action_risk_level: ActionRiskLevel.LOW,
      required_autonomy_level: 1,
      assumptions: ["bKash merchant checkout API is configured to accept partial delivery advance."],
      expires_at: new Date(now + 30 * 86400000).toISOString(),
      status: "PROPOSED",
      created_at: nowIso,
    },
  ];

  // 8. Create Experiments & Offers
  const experiments: GrowthExperiment[] = [
    {
      id: "exp_wa_hook",
      tenant_id: TENANT_ID,
      name: "WhatsApp Comeback Copy: Scarcity vs Discount Hook",
      hypothesis: "Scarcity-based copy ('Few pieces left in your size') outperforms flat 15% discount for fashion shoppers.",
      status: "RUNNING",
      primary_metric: "CONVERSION_RATE",
      audience_id: "aud_dormant_winback",
      variants: [
        {
          variant_id: "v_control_discount",
          name: "15% Flat Discount",
          description: "Control: Standard 15% comeback code",
          traffic_allocation_pct: 50,
        },
        {
          variant_id: "v_scarcity_hook",
          name: "Low Stock Alert",
          description: "Variant: Only 3 items left in your favorite color",
          traffic_allocation_pct: 50,
        },
      ],
      min_sample_size: 200,
      confidence_level: 0.95,
      actual_sample_size: 184,
      winner_variant_id: "v_scarcity_hook",
      created_by: USER_ID,
      created_at: new Date(now - 10 * 86400000).toISOString(),
      updated_at: nowIso,
    },
  ];

  const offers: GrowthOffer[] = [
    {
      id: "off_comeback15",
      tenant_id: TENANT_ID,
      code: "COMEBACK15",
      title: "15% VIP Comeback Discount",
      description: "Exclusive 15% discount for dormant buyers returning within 14 days",
      type: "PERCENTAGE",
      value: 15,
      rules: {
        minimum_order_value_bdt: 1200,
        max_discount_bdt: 600,
      },
      starts_at: new Date(now - 30 * 86400000).toISOString(),
      expires_at: new Date(now + 60 * 86400000).toISOString(),
      is_active: true,
      current_usage_count: 64,
      created_at: new Date(now - 30 * 86400000).toISOString(),
    },
    {
      id: "off_eidvip20",
      tenant_id: TENANT_ID,
      code: "EIDVIP20",
      title: "Eid VIP 20% Early Access",
      description: "Early access privilege discount for top tier loyalty members",
      type: "PERCENTAGE",
      value: 20,
      rules: {
        minimum_order_value_bdt: 3000,
        max_discount_bdt: 1500,
      },
      starts_at: new Date(now - 14 * 86400000).toISOString(),
      expires_at: new Date(now + 14 * 86400000).toISOString(),
      is_active: true,
      current_usage_count: 92,
      created_at: new Date(now - 14 * 86400000).toISOString(),
    },
  ];

  // 9. Save Growth Master Seed snapshot
  console.log("Writing growth-data.json snapshot...");
  const growthSnapshot = {
    customer_lifecycles: lifecycles,
    customer_lifecycle_transitions: transitions.slice(0, 500),
    audiences,
    audience_members: audienceMembers,
    campaigns,
    campaign_attributions: campaignAttributions,
    journeys,
    growth_insights: growthInsights,
    growth_recommendations: growthRecommendations,
    experiments,
    offers,
  };

  fs.writeFileSync(growthSeedPath, JSON.stringify(growthSnapshot, null, 2), "utf-8");
  console.log(`Saved growth seed snapshot to: ${growthSeedPath} (${(fs.statSync(growthSeedPath).size / 1024).toFixed(1)} KB)`);

  // 10. Assemble complete database and save atomically to .data/commerceos.json
  console.log("Assembling comprehensive master database...");
  const fullDatabase = {
    tenants: [
      {
        id: TENANT_ID,
        name: "Dhaka D2C Apparel",
        slug: "dhaka-d2c-apparel",
        currency: "BDT",
        timezone: "Asia/Dhaka",
        language: "en",
        settings: {
          delivery_charge_inside_dhaka: 60,
          delivery_charge_outside_dhaka: 120,
          cod_advance_required: false,
          business_category: "Fashion & Apparel",
          allow_overselling: false,
        },
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    users: [
      {
        id: USER_ID,
        email: "admin@commerceos.io",
        name: "Rafiqul Islam",
        avatar: "",
        password_hash: "$2a$10$iM.oG9E/T0.1h3lP2kQeeeh7sU988wL2v/51Z2qK1vW8kK8E7v.yG",
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    memberships: [
      {
        id: "mem_default_owner",
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        role: "OWNER",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    invitations: [],
    audit_logs: [],
    products,
    product_variants: productVariants,
    categories,
    brands,
    warehouses,
    inventory_items: inventoryItems,
    stock_movements: [],
    inventory_reservations: [],
    customers,
    customer_addresses: addresses,
    orders,
    order_items: orderItems,
    payments,
    shipments,
    returns: [],
    refunds: [],
    coupons: [],
    events: [],
    webhooks: [],
    connected_channels: [],
    customer_identities: [],
    conversations: [],
    messages: [],
    conversation_assignments: [],
    conversation_tags: [],
    leads: [],
    attachments: [],
    quick_replies: [],
    business_hours: [],
    chat_sessions: [],
    outbound_webhook_deliveries: [],
    agents: [],
    agent_policies: [],
    agent_runs: [],
    agent_tool_calls: [],
    agent_prompts: [],
    prompt_versions: [],
    conversation_summaries: [],
    customer_memories: [],
    knowledge_documents: [],
    knowledge_chunks: [],
    ai_traces: [],
    ai_usage: [],
    ai_feedback: [],
    workflows: [],
    tasks: [],
    agent_messages: [],
    workflow_contexts: [],
    workflow_artifacts: [],
    workflow_checkpoints: [],
    agent_delegations: [],
    agent_verifications: [],
    approval_requests: [],
    autonomy_policies: [],
    workflow_templates: [],
    trigger_rules: [],
    action_receipts: [],
    agent_schedules: [],
    analytics_events: [],
    metric_definitions: [],
    metric_snapshots: [],
    insights: [],
    anomalies: [],
    opportunities: [],
    risks: [],
    recommendations: [],
    forecast_runs: [],
    simulations: [],
    decision_requests: [],
    decision_outcomes: [],
    customer_intelligence: [],
    product_performance: [],
    inventory_intelligence: [],
    cohort_records: [],
    model_registry: [],
    data_quality_reports: [],
    // Phase 7 Growth Records
    audiences,
    audience_members: audienceMembers,
    audience_snapshots: [],
    customer_lifecycles: lifecycles,
    customer_lifecycle_transitions: transitions.slice(0, 500),
    journeys,
    journey_enrollments: [],
    journey_executions: [],
    campaigns,
    campaign_executions: [],
    content_assets: [],
    content_templates: [],
    offers,
    offer_usages: [],
    experiments,
    experiment_assignments: [],
    communication_preferences: [],
    suppression_list: [],
    campaign_attributions: campaignAttributions,
    growth_insights: growthInsights,
    growth_recommendations: growthRecommendations,
    abandoned_carts: [],
    executive_digests: [],
  };

  console.log("Writing database atomically to .data/commerceos.json...");
  const jsonStr = JSON.stringify(fullDatabase, null, 2);
  const tmpDbPath = `${dbFile}.tmp.${Date.now()}`;
  const fd = fs.openSync(tmpDbPath, "w");
  const buf = Buffer.from(jsonStr, "utf-8");
  const CHUNK_SIZE = 1024 * 1024;
  let offset = 0;
  while (offset < buf.length) {
    const bytesToWrite = Math.min(CHUNK_SIZE, buf.length - offset);
    fs.writeSync(fd, buf, offset, bytesToWrite);
    offset += bytesToWrite;
  }
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmpDbPath, dbFile);

  const finalSize = fs.statSync(dbFile).size;
  console.log(`Successfully persisted database! File size: ${(finalSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log("=== GROWTH COMMAND CENTER SEEDING COMPLETE ===");
}

run();
