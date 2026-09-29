-- ============================================================
-- CommerceOS Migration 003: Default Seed Data
-- Creates the default tenant, owner user, and membership
-- ============================================================

-- Default Tenant: Dhaka D2C Apparel
INSERT INTO tenants (id, name, slug, currency, timezone, language, settings, status)
VALUES (
  'ten_default_dhaka',
  'Dhaka D2C Apparel',
  'dhaka-d2c-apparel',
  'BDT',
  'Asia/Dhaka',
  'en',
  '{
    "delivery_charge_inside_dhaka": 60,
    "delivery_charge_outside_dhaka": 120,
    "cod_advance_required": false,
    "business_category": "Fashion & Apparel",
    "allow_overselling": false
  }'::jsonb,
  'ACTIVE'
) ON CONFLICT (id) DO NOTHING;

-- Default Owner User
-- Password: admin123 (bcrypt hash)
INSERT INTO users (id, email, name, password_hash, status)
VALUES (
  'usr_owner_default',
  'owner@dhakad2c.com',
  'Store Owner',
  '$2a$12$LJ3m4ys3uz0Gy/M4w5we7uAQZwFJp2.Q.PJcfMq3VhBrPmKqI.nHm',
  'ACTIVE'
) ON CONFLICT (id) DO NOTHING;

-- Owner Membership
INSERT INTO memberships (id, tenant_id, user_id, role)
VALUES (
  'mem_default_owner',
  'ten_default_dhaka',
  'usr_owner_default',
  'OWNER'
) ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Default Autonomy Budget
INSERT INTO autonomy_budgets (id, tenant_id, daily_max_spend_bdt, daily_max_actions)
VALUES (
  'budget_default',
  'ten_default_dhaka',
  50000,
  100
) ON CONFLICT (tenant_id) DO NOTHING;

-- Default Core Customers
INSERT INTO customers (id, tenant_id, full_name, email, phone, district) VALUES
  ('cust_nusrat', 'ten_default_dhaka', 'Nusrat Jahan', 'nusrat.jahan@gmail.com', '+8801711223344', 'Dhaka'),
  ('cust_tanvir', 'ten_default_dhaka', 'Tanvir Ahmed', 'tanvir.ahmed@yahoo.com', '+8801819876543', 'Chattogram'),
  ('cust_sadia', 'ten_default_dhaka', 'Sadia Islam', 'sadia.islam@outlook.com', '+8801912445566', 'Dhaka'),
  ('cust_kamrul', 'ten_default_dhaka', 'Kamrul Hasan', 'kamrul.hasan@gmail.com', '+8801712998877', 'Dhaka'),
  ('cust_anika', 'ten_default_dhaka', 'Anika Rahman', 'anika.rahman@gmail.com', '+8801611002233', 'Dhaka'),
  ('cust_farhan', 'ten_default_dhaka', 'Farhan Kabir', 'farhan.kabir@gmail.com', '+8801755667788', 'Rajshahi')
ON CONFLICT (id) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('003_seed_data')
ON CONFLICT (name) DO NOTHING;
