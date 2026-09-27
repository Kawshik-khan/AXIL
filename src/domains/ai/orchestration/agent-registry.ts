/**
 * CommerceOS Phase 5: Agent Capability Registry
 * Central discovery, capability validation, and policy enforcement for all system agents.
 */

import { AgentType } from "@/types/ai";
import { ActionRiskLevel } from "@/types/orchestration";

export interface AgentCapabilityDeclaration {
  agent_type: AgentType;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  allowed_tools: string[];
  max_risk_level: ActionRiskLevel;
  timeout_ms: number;
  max_iterations: number;
  enabled: boolean;
}

export class AgentRegistryService {
  private registry: Map<AgentType, AgentCapabilityDeclaration> = new Map();

  constructor() {
    this.seedDefaultAgents();
  }

  private seedDefaultAgents(): void {
    // 1. SUPERVISOR AGENT
    this.register({
      agent_type: "SUPERVISOR",
      name: "Autonomous Commerce Supervisor",
      description: "Decomposes business requests, creates DAG task graphs, coordinates specialized agents, monitors SLA, and escalates.",
      version: "1.0.0",
      capabilities: ["TASK_DECOMPOSITION", "AGENT_DELEGATION", "WORKFLOW_MONITORING", "CONFLICT_RESOLUTION", "ESCALATION"],
      allowed_tools: [],
      max_risk_level: "HIGH",
      timeout_ms: 30000,
      max_iterations: 8,
      enabled: true,
    });

    // 2. SALES AGENT
    this.register({
      agent_type: "SALES",
      name: "Conversational Sales & Conversion Agent",
      description: "Handles product recommendations, leads, cart calculation, and order draft creation.",
      version: "1.0.0",
      capabilities: ["PRODUCT_RECOMMENDATION", "LEAD_CAPTURE", "CART_CALCULATION", "ORDER_DRAFT", "PROMOTION_APPLICATION"],
      allowed_tools: ["search_products", "get_product_details", "calculate_cart_totals", "create_order_draft", "create_lead"],
      max_risk_level: "MEDIUM",
      timeout_ms: 15000,
      max_iterations: 5,
      enabled: true,
    });

    // 3. CUSTOMER SUPPORT AGENT
    this.register({
      agent_type: "CUSTOMER_SUPPORT",
      name: "Omnichannel Support Agent",
      description: "Addresses store policy inquiries, returns FAQ, and empathetic customer communication.",
      version: "1.0.0",
      capabilities: ["POLICY_INQUIRY", "RETURN_POLICY", "FAQS", "CUSTOMER_SATISFACTION"],
      allowed_tools: ["search_knowledge_base", "lookup_customer", "request_human_handoff"],
      max_risk_level: "LOW",
      timeout_ms: 12000,
      max_iterations: 4,
      enabled: true,
    });

    // 4. ORDER ASSISTANT AGENT
    this.register({
      agent_type: "ORDER_ASSISTANT",
      name: "Order Lifecycle & Assistance Agent",
      description: "Audits customer orders, status tracking, address modifications, and cancellation reviews.",
      version: "1.0.0",
      capabilities: ["ORDER_LOOKUP", "ORDER_STATUS", "ADDRESS_UPDATE", "CANCELLATION_REVIEW"],
      allowed_tools: ["lookup_order", "check_order_status", "update_customer_address"],
      max_risk_level: "HIGH",
      timeout_ms: 15000,
      max_iterations: 5,
      enabled: true,
    });

    // 5. INVENTORY AGENT
    this.register({
      agent_type: "INVENTORY",
      name: "Autonomous Inventory & Warehouse Operations Agent",
      description: "Inspects stock levels across warehouses, checks reservation availability, and flags stockouts.",
      version: "1.0.0",
      capabilities: ["INVENTORY_AUDIT", "STOCKOUT_ALERT", "RESERVATION_CHECK", "REORDER_ANALYSIS"],
      allowed_tools: ["check_inventory", "get_product_details"],
      max_risk_level: "LOW",
      timeout_ms: 10000,
      max_iterations: 4,
      enabled: true,
    });

    // 6. SHIPPING AGENT
    this.register({
      agent_type: "SHIPPING",
      name: "Logistics & Courier Delivery Agent",
      description: "Calculates delivery estimates, determines Pathao/Steadfast fees, and monitors courier tracking.",
      version: "1.0.0",
      capabilities: ["SHIPPING_ESTIMATE", "COURIER_SELECTION", "PARCEL_TRACKING", "DELIVERY_EXCEPTION"],
      allowed_tools: ["get_shipping_estimate", "track_shipment"],
      max_risk_level: "MEDIUM",
      timeout_ms: 12000,
      max_iterations: 4,
      enabled: true,
    });

    // 7. PAYMENT AGENT
    this.register({
      agent_type: "PAYMENT",
      name: "Financial Settlement & MFS Verification Agent",
      description: "Audits bKash/Nagad transaction IDs, verifies invoice balances, and calculates refund eligibility.",
      version: "1.0.0",
      capabilities: ["PAYMENT_VERIFICATION", "TRXID_MATCHING", "INVOICE_AUDIT", "REFUND_ELIGIBILITY"],
      allowed_tools: ["check_payment_status"],
      max_risk_level: "HIGH",
      timeout_ms: 15000,
      max_iterations: 5,
      enabled: true,
    });

    // 8. VERIFIER AGENT
    this.register({
      agent_type: "VERIFIER",
      name: "Deterministic State & Invariant Verifier Agent",
      description: "Independently validates output claims against database state, receipts, and domain rules.",
      version: "1.0.0",
      capabilities: ["STATE_VERIFICATION", "INVARIANT_AUDIT", "FALSE_CLAIM_DETECTION"],
      allowed_tools: ["lookup_order", "check_inventory", "check_payment_status", "track_shipment"],
      max_risk_level: "LOW",
      timeout_ms: 8000,
      max_iterations: 3,
      enabled: true,
    });

    // 9. SALES INTELLIGENCE AGENT
    this.register({
      agent_type: "SALES_INTELLIGENCE",
      name: "Sales Intelligence & Velocity Analyst",
      description: "Analyzes revenue trends, multi-channel performance, regional distribution, and sales velocity.",
      version: "1.0.0",
      capabilities: ["REVENUE_ANALYSIS", "CHANNEL_PERFORMANCE", "REGIONAL_BREAKDOWN", "VELOCITY_ANALYSIS"],
      allowed_tools: ["get_sales_overview", "query_metrics"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 10. INVENTORY INTELLIGENCE AGENT
    this.register({
      agent_type: "INVENTORY_INTELLIGENCE",
      name: "Inventory Intelligence & Replenishment Analyst",
      description: "Forecasts stockout dates, evaluates days of inventory, and calculates optimal reorder quantities.",
      version: "1.0.0",
      capabilities: ["STOCKOUT_FORECASTING", "REORDER_CALCULATION", "DEAD_STOCK_DETECTION", "INVENTORY_HEALTH"],
      allowed_tools: ["get_inventory_health", "query_metrics"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 11. CUSTOMER INTELLIGENCE AGENT
    this.register({
      agent_type: "CUSTOMER_INTELLIGENCE",
      name: "Customer Intelligence & RFM Analyst",
      description: "Executes RFM quantile segmentation, calculates observed and predictive LTV, and monitors churn risks.",
      version: "1.0.0",
      capabilities: ["RFM_SEGMENTATION", "LTV_MODELING", "CHURN_RISK_DETECTION", "COHORT_ANALYSIS"],
      allowed_tools: ["get_customer_intelligence", "get_cohorts"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 12. PRODUCT INTELLIGENCE AGENT
    this.register({
      agent_type: "PRODUCT_INTELLIGENCE",
      name: "Product & Catalog Performance Analyst",
      description: "Evaluates product performance scores, identifies rising/declining SKUs, and tracks margins.",
      version: "1.0.0",
      capabilities: ["PRODUCT_SCORING", "LIFECYCLE_CATEGORIZATION", "MARGIN_ANALYSIS", "RETURN_RATE_MONITORING"],
      allowed_tools: ["get_product_performance", "query_metrics"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 13. FORECASTING AGENT
    this.register({
      agent_type: "FORECASTING",
      name: "Time-Series Forecasting Specialist",
      description: "Generates multi-horizon demand and revenue projections with confidence intervals.",
      version: "1.0.0",
      capabilities: ["DEMAND_FORECAST", "REVENUE_FORECAST", "CONFIDENCE_BOUNDING", "MODEL_EVALUATION"],
      allowed_tools: ["run_forecast", "get_forecast"],
      max_risk_level: "LOW",
      timeout_ms: 20000,
      max_iterations: 5,
      enabled: true,
    });

    // 14. ANOMALY DETECTION AGENT
    this.register({
      agent_type: "ANOMALY_DETECTION",
      name: "Statistical Anomaly Detection Specialist",
      description: "Flags metric shocks and separates statistical detection from grounded causal explanations.",
      version: "1.0.0",
      capabilities: ["STATISTICAL_DEVIATION", "METRIC_SPIKE_DETECTION", "ANOMALY_EXPLANATION"],
      allowed_tools: ["detect_anomalies", "query_metrics"],
      max_risk_level: "LOW",
      timeout_ms: 12000,
      max_iterations: 3,
      enabled: true,
    });

    // 15. RECOMMENDATION AGENT
    this.register({
      agent_type: "RECOMMENDATION",
      name: "Strategic Recommendation Specialist",
      description: "Synthesizes opportunities and risks into structured proposals adhering to the 7-Factor Explainability standard.",
      version: "1.0.0",
      capabilities: ["RECOMMENDATION_SYNTHESIS", "ROI_ESTIMATION", "EXPLAINABILITY_GENERATION"],
      allowed_tools: ["generate_recommendations", "get_opportunities", "get_risks"],
      max_risk_level: "MEDIUM",
      timeout_ms: 18000,
      max_iterations: 4,
      enabled: true,
    });

    // 16. SIMULATION AGENT
    this.register({
      agent_type: "SIMULATION",
      name: "What-If Scenario Simulation Specialist",
      description: "Executes in-memory elasticity simulations for pricing, restock levels, and discounts with zero production mutation.",
      version: "1.0.0",
      capabilities: ["SCENARIO_SIMULATION", "ELASTICITY_MODELING", "DELTA_PROJECTION"],
      allowed_tools: ["run_simulation"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 17. DECISION ANALYST AGENT
    this.register({
      agent_type: "DECISION_ANALYST",
      name: "Decision Evaluation & Policy Bridge Specialist",
      description: "Evaluates policy compliance, prepares decision requests, and coordinates execution with Phase 5 workflows.",
      version: "1.0.0",
      capabilities: ["POLICY_EVALUATION", "APPROVAL_COORDINATION", "WORKFLOW_DISPATCH"],
      allowed_tools: ["propose_decision", "approve_decision", "reject_decision"],
      max_risk_level: "HIGH",
      timeout_ms: 20000,
      max_iterations: 5,
      enabled: true,
    });

    // 18. GROWTH STRATEGIST AGENT
    this.register({
      agent_type: "GROWTH_STRATEGIST",
      name: "Autonomous Growth Strategist & Orchestrator",
      description: "Synthesizes multi-channel growth initiatives, coordinates cross-functional marketing campaigns, and directs lifecycle interventions.",
      version: "1.0.0",
      capabilities: ["GROWTH_STRATEGY", "CAMPAIGN_ORCHESTRATION", "OPPORTUNITY_SYNTHESIS"],
      allowed_tools: ["generate_growth_recommendations", "dispatch_growth_workflow", "create_campaign_plan"],
      max_risk_level: "HIGH",
      timeout_ms: 25000,
      max_iterations: 6,
      enabled: true,
    });

    // 19. CAMPAIGN PLANNER AGENT
    this.register({
      agent_type: "CAMPAIGN_PLANNER",
      name: "Campaign Planning & Simulation Specialist",
      description: "Structures multi-touch marketing campaigns, predicts conversion/margin impact, and enforces approval safety tiers.",
      version: "1.0.0",
      capabilities: ["CAMPAIGN_PLANNING", "CAMPAIGN_SIMULATION", "RISK_TIERING"],
      allowed_tools: ["create_campaign_plan", "simulate_campaign", "simulate_offer"],
      max_risk_level: "HIGH",
      timeout_ms: 20000,
      max_iterations: 5,
      enabled: true,
    });

    // 20. AUDIENCE ANALYST AGENT
    this.register({
      agent_type: "AUDIENCE_ANALYST",
      name: "Audience Segmentation & Cohort Specialist",
      description: "Builds rule-based and predictive audience segments, queries customer membership, and monitors segment migration.",
      version: "1.0.0",
      capabilities: ["AUDIENCE_SEGMENTATION", "PREDICTIVE_SEGMENTATION", "SEGMENT_REFRESH"],
      allowed_tools: ["query_audience", "refresh_audience"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 21. CUSTOMER LIFECYCLE AGENT
    this.register({
      agent_type: "CUSTOMER_LIFECYCLE",
      name: "Lifecycle State Machine & Transition Specialist",
      description: "Evaluates deterministic 10-stage customer lifecycles, detects churn signals, and triggers win-back transitions.",
      version: "1.0.0",
      capabilities: ["LIFECYCLE_EVALUATION", "TRANSITION_AUDITING", "LIFECYCLE_MIGRATION"],
      allowed_tools: ["get_lifecycle_stage", "evaluate_customer_lifecycle"],
      max_risk_level: "MEDIUM",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 22. CONTENT AGENT
    this.register({
      agent_type: "CONTENT_AGENT",
      name: "Multilingual Copy & Verified Content Specialist",
      description: "Generates localized Banglish/Bangla/English marketing copy strictly verified against live catalog prices and stock.",
      version: "1.0.0",
      capabilities: ["COPY_GENERATION", "CONTENT_VERIFICATION", "LOCALIZED_MESSAGING"],
      allowed_tools: ["generate_marketing_copy", "verify_marketing_content"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 23. PERSONALIZATION AGENT
    this.register({
      agent_type: "PERSONALIZATION_AGENT",
      name: "Customer Personalization & Preference Specialist",
      description: "Tailors communications based on customer consent, preferred channels, quiet hours, and frequency capping rules.",
      version: "1.0.0",
      capabilities: ["PREFERENCE_MANAGEMENT", "FREQUENCY_CAPPING", "MESSAGE_TAILORING"],
      allowed_tools: ["get_customer_preferences"],
      max_risk_level: "LOW",
      timeout_ms: 12000,
      max_iterations: 3,
      enabled: true,
    });

    // 24. OFFER AGENT
    this.register({
      agent_type: "OFFER_AGENT",
      name: "Promotional Offer & Margin Protection Specialist",
      description: "Designs targeted discounts and coupons with pre-simulated gross margin impact to protect profitability.",
      version: "1.0.0",
      capabilities: ["OFFER_DESIGN", "MARGIN_SIMULATION", "DISCOUNT_VALIDATION"],
      allowed_tools: ["simulate_offer", "validate_offer"],
      max_risk_level: "HIGH",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 25. RETENTION AGENT
    this.register({
      agent_type: "RETENTION_AGENT",
      name: "Customer Retention & Engagement Specialist",
      description: "Detects slipping repeat buyers and deploys personalized incentive journeys to increase repurchase rate.",
      version: "1.0.0",
      capabilities: ["RETENTION_OPTIMIZATION", "REPURCHASE_TRIGGER", "ENGAGEMENT_NUDGES"],
      allowed_tools: ["evaluate_customer_lifecycle", "dispatch_growth_workflow"],
      max_risk_level: "MEDIUM",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 26. CHURN INTERVENTION AGENT
    this.register({
      agent_type: "CHURN_INTERVENTION",
      name: "Churn Prevention & Win-Back Specialist",
      description: "Identifies at-risk and dormant accounts, preparing targeted multi-channel win-back offers before permanent loss.",
      version: "1.0.0",
      capabilities: ["CHURN_INTERVENTION", "WINBACK_ORCHESTRATION", "REACTIVATION_RECOVERY"],
      allowed_tools: ["get_lifecycle_stage", "dispatch_growth_workflow", "simulate_offer"],
      max_risk_level: "MEDIUM",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 27. PRODUCT RECOMMENDER AGENT
    this.register({
      agent_type: "PRODUCT_RECOMMENDER",
      name: "Product Recommendation & Affinity Specialist",
      description: "Computes co-purchase affinities, cross-sell/upsell suggestions, and abandoned checkout recommendations.",
      version: "1.0.0",
      capabilities: ["PRODUCT_RECOMMENDATION", "CROSS_SELL", "AFFINITY_SCORING"],
      allowed_tools: ["get_product_recommendations", "get_abandoned_checkouts"],
      max_risk_level: "LOW",
      timeout_ms: 12000,
      max_iterations: 3,
      enabled: true,
    });

    // 28. EXPERIMENT AGENT
    this.register({
      agent_type: "EXPERIMENT_AGENT",
      name: "A/B Testing & Statistical Experimentation Specialist",
      description: "Plans randomized variant assignments, monitors conversion velocity, and calculates frequentist p-value significance.",
      version: "1.0.0",
      capabilities: ["EXPERIMENT_DESIGN", "SAMPLE_SIZE_EVALUATION", "SIGNIFICANCE_CALCULATION"],
      allowed_tools: ["create_experiment", "evaluate_experiment"],
      max_risk_level: "MEDIUM",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 29. ATTRIBUTION AGENT
    this.register({
      agent_type: "ATTRIBUTION_AGENT",
      name: "Multi-Touch Campaign Attribution Specialist",
      description: "Distributes revenue credits across marketing touchpoints using first-touch, last-touch, linear, and time-decay models.",
      version: "1.0.0",
      capabilities: ["MULTI_TOUCH_ATTRIBUTION", "INCREMENTAL_REVENUE_CALCULATION", "ROAS_EVALUATION"],
      allowed_tools: ["calculate_attribution"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // 30. MARKETING ANALYST AGENT
    this.register({
      agent_type: "MARKETING_ANALYST",
      name: "Marketing Performance & Growth Analyst",
      description: "Compiles consolidated growth briefs, evaluates CAC/ROAS, and surfaces actionable campaign opportunities.",
      version: "1.0.0",
      capabilities: ["MARKETING_REPORTING", "GROWTH_AUDIT", "BRIEF_GENERATION"],
      allowed_tools: ["generate_growth_recommendations", "calculate_attribution"],
      max_risk_level: "LOW",
      timeout_ms: 15000,
      max_iterations: 4,
      enabled: true,
    });

    // ============================================================
    // PHASE 8: AUTONOMOUS COMMERCE OPERATIONS AGENTS
    // ============================================================

    // 31. OPERATIONS SUPERVISOR
    this.register({
      agent_type: "OPERATIONS_SUPERVISOR",
      name: "Autonomous Operations Supervisor",
      description: "Coordinates domain operations agents, decomposes operational problems into DAG plans, enforces policy gates, and manages escalations.",
      version: "1.0.0",
      capabilities: ["OPERATIONAL_DAG_PLANNING", "CROSS_DOMAIN_COORDINATION", "POLICY_ENFORCEMENT", "EXCEPTION_ESCALATION"],
      allowed_tools: ["get_autonomy_budget", "get_provider_health", "trigger_kill_switch"],
      max_risk_level: "HIGH",
      timeout_ms: 30000,
      max_iterations: 8,
      enabled: true,
    });

    // 32. INVENTORY OPERATIONS AGENT
    this.register({
      agent_type: "INVENTORY_OPERATIONS",
      name: "Inventory Operations Agent",
      description: "Monitors stock levels, calculates sales velocity, predicts stockouts, and balances multi-warehouse reserves.",
      version: "1.0.0",
      capabilities: ["STOCK_MONITORING", "STOCKOUT_PREDICTION", "WAREHOUSE_TRANSFER", "SAFETY_STOCK_OPTIMIZATION"],
      allowed_tools: ["get_inventory_levels", "get_inventory_forecast", "create_stock_transfer", "adjust_inventory"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 33. PROCUREMENT AGENT
    this.register({
      agent_type: "PROCUREMENT",
      name: "Procurement & Replenishment Agent",
      description: "Evaluates supplier MOQ, lead times, and unit costs to draft and manage purchase orders.",
      version: "1.0.0",
      capabilities: ["SUPPLIER_COMPARISON", "MOQ_OPTIMIZATION", "PO_DRAFTING", "REORDER_PLANNING"],
      allowed_tools: ["get_suppliers", "get_supplier_price", "create_purchase_order", "submit_purchase_order", "receive_purchase_order"],
      max_risk_level: "MEDIUM",
      timeout_ms: 45000,
      max_iterations: 4,
      enabled: true,
    });

    // 34. PRICING OPERATIONS AGENT
    this.register({
      agent_type: "PRICING_OPERATIONS",
      name: "Pricing Operations Agent",
      description: "Monitors gross margins, simulates price elasticity, manages clearance discounts, and safeguards profit floors.",
      version: "1.0.0",
      capabilities: ["MARGIN_MONITORING", "CLEARANCE_PRICING", "PRICE_SIMULATION", "MARGIN_DEFENSE"],
      allowed_tools: ["get_price_rules", "simulate_price_change", "create_price_change_request", "execute_price_change"],
      max_risk_level: "MEDIUM",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 35. ORDER OPERATIONS AGENT
    this.register({
      agent_type: "ORDER_OPERATIONS",
      name: "Order Operations Agent",
      description: "Validates orders, audits fulfillment readiness, tracks order SLAs, and handles safe cancellations.",
      version: "1.0.0",
      capabilities: ["ORDER_VALIDATION", "FULFILLMENT_READINESS", "ORDER_SLA_AUDIT", "SAFE_CANCELLATION"],
      allowed_tools: ["validate_order", "cancel_order_safely", "create_fulfillment_task"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 36. FULFILLMENT AGENT
    this.register({
      agent_type: "FULFILLMENT",
      name: "Fulfillment Planning Agent",
      description: "Sequences warehouse picking priorities, packaging queues, and dispatch timing.",
      version: "1.0.0",
      capabilities: ["WAREHOUSE_SELECTION", "PICKING_PRIORITY", "PACKING_SEQUENCE", "DISPATCH_PLANNING"],
      allowed_tools: ["create_fulfillment_task", "select_best_courier", "get_inventory_levels"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 37. SHIPPING OPERATIONS AGENT
    this.register({
      agent_type: "SHIPPING_OPERATIONS",
      name: "Shipping & Logistics Operations Agent",
      description: "Monitors in-transit couriers, detects delivery delays, and executes automated courier failover.",
      version: "1.0.0",
      capabilities: ["TRANSIT_MONITORING", "COURIER_BENCHMARKING", "DELAY_EXCEPTION_HANDLING", "COURIER_FAILOVER"],
      allowed_tools: ["get_shipment_tracking", "create_shipment", "select_best_courier", "switch_courier"],
      max_risk_level: "MEDIUM",
      timeout_ms: 35000,
      max_iterations: 4,
      enabled: true,
    });

    // 38. CUSTOMER SUPPORT OPERATIONS AGENT
    this.register({
      agent_type: "CUSTOMER_SUPPORT_OPERATIONS",
      name: "Support Operations Agent",
      description: "Resolves order and delivery inquiries in Banglish, creates tickets, and prioritizes escalations.",
      version: "1.0.0",
      capabilities: ["DELIVERY_INQUIRIES", "TICKET_CREATION", "SLA_ESCALATION", "ORDER_STATUS_EXPLANATION"],
      allowed_tools: ["get_support_ticket", "create_support_ticket", "resolve_support_ticket"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 39. PAYMENT OPERATIONS AGENT
    this.register({
      agent_type: "PAYMENT_OPERATIONS",
      name: "Payment Operations Agent",
      description: "Verifies bKash/Nagad transactions, flags payment timeouts, and detects duplicate transactions.",
      version: "1.0.0",
      capabilities: ["TRANSACTION_MATCHING", "MFS_VERIFICATION", "TIMEOUT_DETECTION", "DUPLICATE_PREVENTION"],
      allowed_tools: ["verify_payment_transaction", "request_refund_safely", "reconcile_payment_batch"],
      max_risk_level: "HIGH",
      timeout_ms: 40000,
      max_iterations: 4,
      enabled: true,
    });

    // 40. FINANCE OPERATIONS AGENT
    this.register({
      agent_type: "FINANCE_OPERATIONS",
      name: "Operational Finance Agent",
      description: "Performs deterministic daily revenue reconciliation, audits courier COD, and identifies fee anomalies.",
      version: "1.0.0",
      capabilities: ["REVENUE_AUDITING", "COD_RECONCILIATION", "FEE_AUDITING", "FINANCIAL_DISCREPANCY_QUEUE"],
      allowed_tools: ["run_financial_reconciliation", "get_financial_exceptions", "resolve_financial_exception"],
      max_risk_level: "MEDIUM",
      timeout_ms: 60000,
      max_iterations: 3,
      enabled: true,
    });

    // 41. RETURNS OPERATIONS AGENT
    this.register({
      agent_type: "RETURNS_OPERATIONS",
      name: "Returns & Reverse Logistics Agent",
      description: "Evaluates return eligibility against policy windows, flags return fraud, and disburses verified refunds.",
      version: "1.0.0",
      capabilities: ["RETURN_ELIGIBILITY", "REVERSE_PICKUP", "INSPECTION_VERIFICATION", "REFUND_EXECUTION"],
      allowed_tools: ["request_refund_safely", "resolve_operational_exception"],
      max_risk_level: "HIGH",
      timeout_ms: 35000,
      max_iterations: 3,
      enabled: true,
    });

    // 42. EXCEPTION MANAGEMENT AGENT
    this.register({
      agent_type: "EXCEPTION_MANAGEMENT",
      name: "Exception Management Agent",
      description: "Classifies operational exceptions, assigns recovery tasks to domain agents, and verifies resolution.",
      version: "1.0.0",
      capabilities: ["EXCEPTION_TRIAGE", "ROOT_CAUSE_ANALYSIS", "RESOLUTION_PLANNING", "ESCALATION_MANAGEMENT"],
      allowed_tools: ["get_operational_exceptions", "propose_exception_resolution", "resolve_operational_exception"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 43. RECONCILIATION AGENT
    this.register({
      agent_type: "RECONCILIATION",
      name: "Reconciliation Agent",
      description: "Compares multi-source settlement records, transaction ledgers, and inventory balances.",
      version: "1.0.0",
      capabilities: ["LEDGER_MATCHING", "SETTLEMENT_AUDIT", "VARIANCE_DETECTION"],
      allowed_tools: ["reconcile_payment_batch", "run_financial_reconciliation"],
      max_risk_level: "LOW",
      timeout_ms: 45000,
      max_iterations: 3,
      enabled: true,
    });

    // 44. SUPPLIER OPERATIONS AGENT
    this.register({
      agent_type: "SUPPLIER_OPERATIONS",
      name: "Supplier Operations Agent",
      description: "Tracks supplier fulfillment rates, on-time delivery percentages, and lead-time adherence.",
      version: "1.0.0",
      capabilities: ["SUPPLIER_EVALUATION", "LEAD_TIME_AUDIT", "FILL_RATE_TRACKING"],
      allowed_tools: ["get_suppliers", "get_supplier_price"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 45. OPERATIONS OPTIMIZATION AGENT
    this.register({
      agent_type: "OPERATIONS_OPTIMIZATION",
      name: "Operations Optimization Agent",
      description: "Analyzes end-to-end commerce operational efficiency, SLA compliance, and automation cost savings.",
      version: "1.0.0",
      capabilities: ["SLA_OPTIMIZATION", "COST_ANALYSIS", "BOTTLENECK_IDENTIFICATION"],
      allowed_tools: ["get_autonomy_budget", "get_provider_health"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // ============================================================
    // PHASE 9: ENTERPRISE INTELLIGENCE & ECOSYSTEM AGENTS
    // ============================================================

    // 46. ENTERPRISE SUPERVISOR
    this.register({
      agent_type: "ENTERPRISE_SUPERVISOR",
      name: "Enterprise Multi-Store Supervisor",
      description: "Decomposes cross-entity business requests, orchestrates multi-agent DAG plans across stores and brands, and enforces governance boundaries.",
      version: "1.0.0",
      capabilities: ["CROSS_ENTITY_DAG_PLANNING", "MULTI_STORE_COORDINATION", "ENTERPRISE_GOVERNANCE", "ESCALATION"],
      allowed_tools: ["get_enterprise_overview", "check_enterprise_ai_budget", "resolve_enterprise_incident"],
      max_risk_level: "HIGH",
      timeout_ms: 35000,
      max_iterations: 8,
      enabled: true,
    });

    // 47. ENTERPRISE INTELLIGENCE
    this.register({
      agent_type: "ENTERPRISE_INTELLIGENCE",
      name: "Enterprise Intelligence Agent",
      description: "Performs multi-store portfolio intelligence, performance clustering, and strategic anomaly synthesis.",
      version: "1.0.0",
      capabilities: ["PORTFOLIO_INTELLIGENCE", "PERFORMANCE_CLUSTERING", "CROSS_STORE_SYNTHESIS", "STRATEGIC_ANOMALY_DETECTION"],
      allowed_tools: ["get_enterprise_overview", "get_cross_entity_analytics", "resolve_semantic_metric"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 48. ENTERPRISE ANALYTICS
    this.register({
      agent_type: "ENTERPRISE_ANALYTICS",
      name: "Enterprise Analytics & Metrics Agent",
      description: "Executes semantic metric computation across entity hierarchies, evaluates dynamic metric formulas, and performs multidimensional slicing.",
      version: "1.0.0",
      capabilities: ["SEMANTIC_METRICS", "CROSS_ENTITY_SLICING", "FORMULA_EVALUATION", "DIMENSIONAL_AGGREGATION"],
      allowed_tools: ["get_cross_entity_analytics", "resolve_semantic_metric", "generate_enterprise_report"],
      max_risk_level: "LOW",
      timeout_ms: 35000,
      max_iterations: 4,
      enabled: true,
    });

    // 49. BENCHMARKING
    this.register({
      agent_type: "BENCHMARKING",
      name: "Enterprise Benchmarking Agent",
      description: "Calculates cross-store, cross-brand, and industry percentile rankings, isolating operational variance drivers.",
      version: "1.0.0",
      capabilities: ["PERCENTILE_RANKING", "VARIANCE_DECOMPOSITION", "CROSS_STORE_BENCHMARKING", "EFFICIENCY_FRONTIER"],
      allowed_tools: ["run_enterprise_benchmark", "get_cross_entity_analytics"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 50. INTEGRATION
    this.register({
      agent_type: "INTEGRATION",
      name: "Integration Hub & Connector Agent",
      description: "Orchestrates external connectors, validates data mappings, audits bidirectional syncs, and resolves schema conflicts.",
      version: "1.0.0",
      capabilities: ["CONNECTOR_ORCHESTRATION", "DATA_MAPPING_VERIFICATION", "CONFLICT_AUTO_RESOLUTION", "SYNC_GOVERNANCE"],
      allowed_tools: ["get_integration_status", "trigger_integration_sync", "resolve_integration_conflict"],
      max_risk_level: "HIGH",
      timeout_ms: 45000,
      max_iterations: 3,
      enabled: true,
    });

    // 51. DATA GOVERNANCE
    this.register({
      agent_type: "DATA_GOVERNANCE",
      name: "Data Governance & Compliance Agent",
      description: "Maintains enterprise data catalog, classifies sensitivity tiers, enforces retention policies, and validates provenance.",
      version: "1.0.0",
      capabilities: ["DATA_CATALOGING", "SENSITIVITY_CLASSIFICATION", "RETENTION_ENFORCEMENT", "LINEAGE_AUDITING"],
      allowed_tools: ["trace_data_lineage", "get_data_quality_issues"],
      max_risk_level: "LOW",
      timeout_ms: 25000,
      max_iterations: 3,
      enabled: true,
    });

    // 52. DATA QUALITY
    this.register({
      agent_type: "DATA_QUALITY",
      name: "Data Quality & Profiling Agent",
      description: "Profiles entity streams, detects missing references, flags reconciliation anomalies, and isolates bad data payloads.",
      version: "1.0.0",
      capabilities: ["DATA_PROFILING", "ANOMALY_FLAGGING", "RECONCILIATION_VALIDATION", "RULE_EVALUATION"],
      allowed_tools: ["get_data_quality_issues", "resolve_enterprise_incident"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 53. ENTERPRISE OPERATIONS
    this.register({
      agent_type: "ENTERPRISE_OPERATIONS",
      name: "Enterprise Operations & Incident Agent",
      description: "Coordinates multi-store incident triage, routes inter-store transfers, and enforces enterprise SLA baselines.",
      version: "1.0.0",
      capabilities: ["INCIDENT_TRIAGE", "CROSS_STORE_ROUTING", "SLA_ENFORCEMENT", "ESCALATION_COORDINATION"],
      allowed_tools: ["get_enterprise_incidents", "resolve_enterprise_incident", "balance_cross_store_inventory"],
      max_risk_level: "MEDIUM",
      timeout_ms: 35000,
      max_iterations: 4,
      enabled: true,
    });

    // 54. ENTERPRISE FINANCE
    this.register({
      agent_type: "ENTERPRISE_FINANCE",
      name: "Enterprise Financial Intelligence Agent",
      description: "Executes multi-currency financial consolidation, audits intercompany transactions, and reports segment profitability.",
      version: "1.0.0",
      capabilities: ["MULTI_CURRENCY_CONSOLIDATION", "INTERCOMPANY_RECONCILIATION", "SEGMENT_PROFITABILITY", "FINANCIAL_AUDIT"],
      allowed_tools: ["get_cross_entity_analytics", "resolve_semantic_metric", "generate_enterprise_report"],
      max_risk_level: "HIGH",
      timeout_ms: 45000,
      max_iterations: 3,
      enabled: true,
    });

    // 55. ENTERPRISE INVENTORY
    this.register({
      agent_type: "ENTERPRISE_INVENTORY",
      name: "Global Inventory Balancing Agent",
      description: "Surfaces enterprise-wide stock visibility, detects regional imbalances, and plans optimal inter-store balancing transfers.",
      version: "1.0.0",
      capabilities: ["GLOBAL_STOCK_VISIBILITY", "CROSS_STORE_BALANCING", "DEAD_STOCK_REDISTRIBUTION", "TRANSFER_OPTIMIZATION"],
      allowed_tools: ["balance_cross_store_inventory", "get_cross_entity_analytics"],
      max_risk_level: "MEDIUM",
      timeout_ms: 35000,
      max_iterations: 4,
      enabled: true,
    });

    // 56. ENTERPRISE PROCUREMENT
    this.register({
      agent_type: "ENTERPRISE_PROCUREMENT",
      name: "Consolidated Procurement Agent",
      description: "Aggregates SKU replenishment demands across all stores, unlocks tiered bulk discounts, and splits group orders.",
      version: "1.0.0",
      capabilities: ["DEMAND_CONSOLIDATION", "BULK_TIER_OPTIMIZATION", "VENDOR_SPLITTING", "GROUP_PURCHASING"],
      allowed_tools: ["consolidate_procurement_demand", "get_cross_entity_analytics"],
      max_risk_level: "HIGH",
      timeout_ms: 40000,
      max_iterations: 3,
      enabled: true,
    });

    // 57. ENTERPRISE SECURITY
    this.register({
      agent_type: "ENTERPRISE_SECURITY",
      name: "Enterprise Security & Key Governance Agent",
      description: "Audits API key usage, detects abnormal bulk data export attempts, and monitors zero-trust authorization anomalies.",
      version: "1.0.0",
      capabilities: ["SECURITY_AUDITING", "ABNORMAL_EXPORT_DETECTION", "KEY_HYGIENE_CHECK", "POLICY_ENFORCEMENT"],
      allowed_tools: ["get_enterprise_incidents", "resolve_enterprise_incident"],
      max_risk_level: "HIGH",
      timeout_ms: 25000,
      max_iterations: 3,
      enabled: true,
    });

    // 58. ENTERPRISE REPORTING
    this.register({
      agent_type: "ENTERPRISE_REPORTING",
      name: "Enterprise Executive Reporting Agent",
      description: "Assembles scheduled executive reporting packages, generates board decks, and builds compliance export bundles.",
      version: "1.0.0",
      capabilities: ["REPORT_COMPILATION", "EXECUTIVE_SUMMARY", "EXPORT_PACKAGING", "SCHEDULED_DISPATCH"],
      allowed_tools: ["generate_enterprise_report", "resolve_semantic_metric"],
      max_risk_level: "LOW",
      timeout_ms: 40000,
      max_iterations: 3,
      enabled: true,
    });

    // 59. ECOSYSTEM
    this.register({
      agent_type: "ECOSYSTEM",
      name: "Partner Ecosystem & Connector Agent",
      description: "Certifies partner applications, tracks webhook delivery reliability, and manages developer ecosystem health.",
      version: "1.0.0",
      capabilities: ["PARTNER_CERTIFICATION", "WEBHOOK_HEALTH_MONITORING", "ECOSYSTEM_AUDITING", "APP_DIRECTORY_GOVERNANCE"],
      allowed_tools: ["get_integration_status", "trigger_integration_sync"],
      max_risk_level: "MEDIUM",
      timeout_ms: 30000,
      max_iterations: 3,
      enabled: true,
    });

    // 60. DEVELOPER PLATFORM
    this.register({
      agent_type: "DEVELOPER_PLATFORM",
      name: "Developer Platform & API Governance Agent",
      description: "Manages API key lifecycle, monitors endpoint rate limit compliance, and diagnoses webhook failure patterns.",
      version: "1.0.0",
      capabilities: ["API_USAGE_AUDITING", "RATE_LIMIT_GOVERNANCE", "KEY_LIFECYCLE_MANAGEMENT", "WEBHOOK_DIAGNOSTICS"],
      allowed_tools: ["get_integration_status", "check_enterprise_ai_budget"],
      max_risk_level: "MEDIUM",
      timeout_ms: 30000,
      max_iterations: 3,
      enabled: true,
    });

    // 61. AUTONOMOUS SUPERVISOR
    this.register({
      agent_type: "AUTONOMOUS_SUPERVISOR",
      name: "Autonomous Control Plane Supervisor",
      description: "Master orchestrator decomposing business objectives into cross-domain DAG plans, coordinating multi-agent workflows, and enforcing autonomous safety boundaries.",
      version: "1.0.0",
      capabilities: ["OBJECTIVE_DECOMPOSITION", "CROSS_DOMAIN_ORCHESTRATION", "DAG_SYNTHESIS", "AUTONOMOUS_LOOP_COORDINATION", "GOVERNANCE_ENFORCEMENT"],
      allowed_tools: ["get_autonomous_overview", "get_business_objectives", "pause_domain_autonomy", "execute_autonomous_cycle"],
      max_risk_level: "HIGH",
      timeout_ms: 45000,
      max_iterations: 10,
      enabled: true,
    });

    // 62. OBJECTIVES AGENT
    this.register({
      agent_type: "OBJECTIVES_AGENT",
      name: "Business Objectives Agent",
      description: "Manages enterprise business objectives, evaluates multi-tier KPI progress, enforces constraints, and assesses achievement risks.",
      version: "1.0.0",
      capabilities: ["OBJECTIVE_FORMULATION", "HIERARCHY_MANAGEMENT", "PROGRESS_TRACKING", "CONSTRAINT_MONITORING", "RISK_EVALUATION"],
      allowed_tools: ["get_business_objectives", "create_business_objective", "get_autonomous_overview", "simulate_objective_strategy"],
      max_risk_level: "LOW",
      timeout_ms: 25000,
      max_iterations: 4,
      enabled: true,
    });

    // 63. STRATEGY AGENT
    this.register({
      agent_type: "STRATEGY_AGENT",
      name: "Strategy Formulation & Simulation Agent",
      description: "Formulates comprehensive multi-agent strategies linked to objectives, simulates strategic tradeoffs, and tracks execution outcomes.",
      version: "1.0.0",
      capabilities: ["STRATEGY_FORMULATION", "TRADEOFF_EVALUATION", "POLICY_ALIGNMENT", "STRATEGY_SIMULATION", "OUTCOME_MEASUREMENT"],
      allowed_tools: ["simulate_objective_strategy", "get_active_strategies", "get_business_objectives", "evaluate_global_decision"],
      max_risk_level: "LOW",
      timeout_ms: 30000,
      max_iterations: 4,
      enabled: true,
    });

    // 64. DECISION AGENT
    this.register({
      agent_type: "DECISION_AGENT",
      name: "Global Decision Agent",
      description: "Evaluates cross-domain candidate decisions, calculates risk-adjusted impact, asserts policy constraints, and coordinates human governance approvals.",
      version: "1.0.0",
      capabilities: ["DECISION_SCORING", "RISK_ASSESSMENT", "POLICY_VERIFICATION", "APPROVAL_COORDINATION", "OUTCOME_VERIFICATION"],
      allowed_tools: ["evaluate_global_decision", "approve_autonomous_decision", "get_autonomous_overview"],
      max_risk_level: "HIGH",
      timeout_ms: 20000,
      max_iterations: 3,
      enabled: true,
    });

    // 65. LEARNING AGENT
    this.register({
      agent_type: "LEARNING_AGENT",
      name: "Continuous Learning & Governance Agent",
      description: "Governs the learning candidate lifecycle (Evaluation → Shadow → Canary → Production), audits model accuracy, and triggers automated rollbacks.",
      version: "1.0.0",
      capabilities: ["OUTCOME_EVALUATION", "CANDIDATE_SCREENING", "SHADOW_MONITORING", "CANARY_EVALUATION", "MODEL_ROLLBACK"],
      allowed_tools: ["get_learning_candidates", "evaluate_learning_candidate", "get_quality_scorecard", "get_platform_health"],
      max_risk_level: "MEDIUM",
      timeout_ms: 35000,
      max_iterations: 5,
      enabled: true,
    });

    // 66. OPTIMIZATION AGENT
    this.register({
      agent_type: "OPTIMIZATION_AGENT",
      name: "Multi-Objective Optimization Agent",
      description: "Discovers multi-objective optimization opportunities across inventory, pricing, fulfillment, and marketing while strictly preserving business constraints.",
      version: "1.0.0",
      capabilities: ["PARETO_OPTIMIZATION", "CONSTRAINT_SOLVING", "DYNAMIC_OPPORTUNITY_DISCOVERY", "EFFICIENCY_TUNING"],
      allowed_tools: ["simulate_objective_strategy", "evaluate_global_decision", "execute_autonomous_cycle", "get_autonomous_overview"],
      max_risk_level: "MEDIUM",
      timeout_ms: 35000,
      max_iterations: 4,
      enabled: true,
    });

    // 67. PLATFORM HEALTH AGENT
    this.register({
      agent_type: "PLATFORM_HEALTH_AGENT",
      name: "Autonomous Platform Health Agent",
      description: "Continuously monitors system health across all 11 dimensions, computes the Autonomous Quality Scorecard, tracks SLO error budgets, and detects anomalies.",
      version: "1.0.0",
      capabilities: ["11_DIMENSION_MONITORING", "QUALITY_SCORECARD_COMPUTATION", "SLO_ERROR_BUDGET_TRACKING", "CROSS_DOMAIN_INCIDENT_CORRELATION"],
      allowed_tools: ["get_platform_health", "get_quality_scorecard", "pause_domain_autonomy", "get_autonomous_overview"],
      max_risk_level: "LOW",
      timeout_ms: 20000,
      max_iterations: 3,
      enabled: true,
    });

    // 68. COST GOVERNANCE AGENT
    this.register({
      agent_type: "COST_GOVERNANCE_AGENT",
      name: "Platform Economics & Cost Governance Agent",
      description: "Tracks cost-aware autonomy across LLMs, tools, APIs, and workflows; ensures safety boundaries are never compromised for cost reduction.",
      version: "1.0.0",
      capabilities: ["COST_PER_DECISION_TRACKING", "TOKEN_EXPENDITURE_AUDITING", "EFFICIENCY_RATIO_ANALYSIS", "SAFETY_FIRST_COST_TUNING"],
      allowed_tools: ["get_platform_costs", "get_quality_scorecard", "get_autonomous_overview"],
      max_risk_level: "LOW",
      timeout_ms: 25000,
      max_iterations: 3,
      enabled: true,
    });
  }

  public register(declaration: AgentCapabilityDeclaration): void {
    this.registry.set(declaration.agent_type, declaration);
  }

  public getAgent(agentType: AgentType): AgentCapabilityDeclaration | undefined {
    return this.registry.get(agentType);
  }

  public getAllAgents(): AgentCapabilityDeclaration[] {
    return Array.from(this.registry.values());
  }

  public listAgents(): Array<AgentCapabilityDeclaration & { type: AgentType }> {
    return Array.from(this.registry.values()).map((a) => ({
      ...a,
      type: a.agent_type,
    }));
  }

  public getEnabledAgents(): AgentCapabilityDeclaration[] {
    return this.getAllAgents().filter((a) => a.enabled);
  }

  public setAgentStatus(agentType: AgentType, enabled: boolean): void {
    const agent = this.registry.get(agentType);
    if (agent) {
      agent.enabled = enabled;
    }
  }

  /**
   * Discovers the best agent matching a requested capability
   */
  public discoverAgentForCapability(capability: string): AgentCapabilityDeclaration | undefined {
    for (const agent of this.registry.values()) {
      if (agent.enabled && agent.capabilities.includes(capability)) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * Validates whether source agent has permission to delegate capability to target agent
   */
  public validateDelegation(
    sourceAgent: AgentType,
    targetAgent: AgentType,
    requiredCapability: string
  ): { allowed: boolean; reason?: string } {
    const target = this.registry.get(targetAgent);
    if (!target || !target.enabled) {
      return { allowed: false, reason: `Target agent ${targetAgent} is not active in registry.` };
    }

    if (!target.capabilities.includes(requiredCapability)) {
      return {
        allowed: false,
        reason: `Target agent ${targetAgent} does not possess declared capability: ${requiredCapability}.`,
      };
    }

    // Cyclic delegation protection
    if (sourceAgent === targetAgent) {
      return { allowed: false, reason: `Self-delegation loop detected on agent ${sourceAgent}.` };
    }

    return { allowed: true };
  }
}

export const agentRegistry = new AgentRegistryService();
