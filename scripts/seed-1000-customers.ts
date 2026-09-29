/**
 * CommerceOS — 1,000 Bangladeshi Customer Generator & Database Seeder
 * 
 * Generates 1,000 realistic customer profiles with:
 * - Real Bangladeshi first & last names
 * - Unique, valid Bangladeshi phone numbers (+8801[3-9]xxxxxxxx)
 * - Unique email addresses
 * - Geographic distributions across all 8 divisions and major districts
 * - Granular street addresses and upazilas
 * - Retail customer segmentation: VIPs, regulars, new buyers, RTO risks, blacklisted
 * 
 * Seeds into:
 * 1. Local storage engine (.data/commerceos.json via db.persist())
 * 2. SQL migration file (src/infrastructure/db/migrations/legacy/004_seed_1000_customers.sql)
 */

import fs from 'fs';
import path from 'path';
import { db } from '../src/infrastructure/db';
import { Customer, CustomerAddress, CustomerSource } from '../src/types/commerce';
import { assertNoOtherStoreWriter } from './lib/store-guard';

// Refuse to write the JSON store while the app (or another script) owns it (FX-24).
assertNoOtherStoreWriter();

const TENANT_ID = 'ten_default_dhaka';

const maleFirstNames = [
  'Mohammad', 'Tanvir', 'Rakib', 'Shakib', 'Arif', 'Mehedi', 'Sabbir', 'Hasan',
  'Mahmud', 'Nayeem', 'Farhan', 'Zahid', 'Faisal', 'Imtiaz', 'Sazzad', 'Rashed',
  'Al-Amin', 'Towhid', 'Tariq', 'Ashiq', 'Sohel', 'Mahfuz', 'Kamrul', 'Shahriar',
  'Rehan', 'Mominul', 'Anisur', 'Nazmul', 'Jubayer', 'Saiful', 'Aminul', 'Mizanur',
  'Jahid', 'Billal', 'Rubel', 'Shamim', 'Ripon', 'Jewel', 'Masud', 'Rony',
  'Shahidul', 'Khaled', 'Mustafizur', 'Tamim', 'Mushfiq', 'Taskin', 'Liton', 'Soumya'
];

const femaleFirstNames = [
  'Farhana', 'Sadia', 'Anika', 'Nusrat', 'Sabrina', 'Tahmina', 'Afroza', 'Jannatul',
  'Sharmin', 'Sumaiya', 'Rumpa', 'Mim', 'Tasnim', 'Israt', 'Nadia', 'Fatema',
  'Marufa', 'Sanzida', 'Nabila', 'Samia', 'Farzana', 'Roksana', 'Shamima', 'Meherun',
  'Fahmida', 'Nahid', 'Shirin', 'Lovely', 'Parvin', 'Sultana', 'Jahanara', 'Rozina',
  'Ruma', 'Akhi', 'Shanta', 'Purnima', 'Bristi', 'Jui', 'Shathi', 'Mou',
  'Lamia', 'Mithila', 'Zarin', 'Tania', 'Ayesha', 'Khadija', 'Maria', 'Sanjida'
];

const lastNames = [
  'Rahman', 'Ahmed', 'Islam', 'Hasan', 'Ali', 'Hossain', 'Chowdhury', 'Khan',
  'Sarker', 'Sikder', 'Talukder', 'Mollah', 'Howlader', 'Bhuiyan', 'Akter', 'Begum',
  'Khatun', 'Roy', 'Das', 'Majumder', 'Dewan', 'Patwary', 'Munshi', 'Gazi',
  'Bepari', 'Kazi', 'Barua', 'Haque', 'Uddin', 'Mia', 'Miah', 'Sheikh'
];

interface LocationInfo {
  division: string;
  district: string;
  upazila: string;
  areas: string[];
  postalCode: string;
}

const locations: LocationInfo[] = [
  // Dhaka Division
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Dhanmondi', areas: ['Road 27', 'Road 8/A', 'Satmasjid Road', 'Shankar'], postalCode: '1209' },
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Gulshan', areas: ['Gulshan 1', 'Gulshan 2', 'Avenue Road', 'Niketan'], postalCode: '1212' },
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Banani', areas: ['Road 11', 'Block D', 'Block F', 'Kamal Ataturk Ave'], postalCode: '1213' },
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Mirpur', areas: ['Mirpur 1', 'Mirpur 2', 'Mirpur 10', 'Mirpur 12', 'Pallabi'], postalCode: '1216' },
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Uttara', areas: ['Sector 3', 'Sector 7', 'Sector 11', 'Sector 13', 'Sonargaon Janapath'], postalCode: '1230' },
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Mohammadpur', areas: ['Town Hall', 'Taj Mahal Road', 'Iqbal Road', 'Japan Garden City'], postalCode: '1207' },
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Badda', areas: ['Middle Badda', 'South Badda', 'Aftabnagar Block B'], postalCode: '1212' },
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Khilgaon', areas: ['Taltola', 'Block C', 'Gorran'], postalCode: '1219' },
  { division: 'Dhaka', district: 'Dhaka', upazila: 'Bashundhara', areas: ['Block C', 'Block D', 'Block G', 'Block I'], postalCode: '1229' },
  { division: 'Dhaka', district: 'Gazipur', upazila: 'Gazipur Sadar', areas: ['Chowrasta', 'Joydebpur', 'Board Bazar'], postalCode: '1700' },
  { division: 'Dhaka', district: 'Narayanganj', upazila: 'Narayanganj Sadar', areas: ['Chashara', 'Tanbazar', 'Deobhog'], postalCode: '1400' },
  { division: 'Dhaka', district: 'Tangail', upazila: 'Tangail Sadar', areas: ['Akur Takur Para', 'Victoria Road'], postalCode: '1900' },

  // Chattogram Division
  { division: 'Chattogram', district: 'Chattogram', upazila: 'Panchlaish', areas: ['GEC Circle', 'Nasirabad', 'Khulshi', 'Prabartak Circle'], postalCode: '4000' },
  { division: 'Chattogram', district: 'Chattogram', upazila: 'Double Mooring', areas: ['Agrabad C/A', 'Chotopool', 'Halishahar'], postalCode: '4100' },
  { division: 'Chattogram', district: 'Chattogram', upazila: 'Kotwali', areas: ['Anderkilla', 'New Market', 'Chawkbazar'], postalCode: '4000' },
  { division: 'Chattogram', district: "Cox's Bazar", upazila: 'Sadar', areas: ['Kolatoli', 'Laboni Beach Road', 'Main Road'], postalCode: '4700' },
  { division: 'Chattogram', district: 'Cumilla', upazila: 'Adarsha Sadar', areas: ['Kandirpar', 'Tomsom Bridge', 'Shasongachha'], postalCode: '3500' },
  { division: 'Chattogram', district: 'Feni', upazila: 'Feni Sadar', areas: ['Trunk Road', 'SSk Road'], postalCode: '3900' },

  // Sylhet Division
  { division: 'Sylhet', district: 'Sylhet', upazila: 'Sylhet Sadar', areas: ['Zindabazar', 'Amberkhana', 'Shibganj', 'Kumarpara', 'Upashahar'], postalCode: '3100' },
  { division: 'Sylhet', district: 'Moulvibazar', upazila: 'Sadar', areas: ['Court Road', 'Sreemangal Road'], postalCode: '3200' },

  // Rajshahi Division
  { division: 'Rajshahi', district: 'Rajshahi', upazila: 'Boalia', areas: ['Shaheb Bazar', 'Motihar', 'Kazla', 'Upashahar'], postalCode: '6000' },
  { division: 'Rajshahi', district: 'Bogura', upazila: 'Bogura Sadar', areas: ['Satmatha', 'Jaleshwaritola', 'Thanthania'], postalCode: '5800' },
  { division: 'Rajshahi', district: 'Pabna', upazila: 'Pabna Sadar', areas: ['Abdul Hamid Road', 'Kheyaghat'], postalCode: '6600' },

  // Khulna Division
  { division: 'Khulna', district: 'Khulna', upazila: 'Khulna Sadar', areas: ['Shibbari', 'Dakbangla', 'Boyra', 'Sonadanga'], postalCode: '9100' },
  { division: 'Khulna', district: 'Jashore', upazila: 'Jashore Sadar', areas: ['Doratana', 'Rail Road', 'Chowrasta'], postalCode: '7400' },
  { division: 'Khulna', district: 'Kushtia', upazila: 'Kushtia Sadar', areas: ['NS Road', 'Majampur'], postalCode: '7000' },

  // Barishal Division
  { division: 'Barishal', district: 'Barishal', upazila: 'Barishal Sadar', areas: ['Sadar Road', 'Natullabad', 'Rupatali', 'Chawkbazar'], postalCode: '8200' },

  // Rangpur Division
  { division: 'Rangpur', district: 'Rangpur', upazila: 'Rangpur Sadar', areas: ['Jahaj Company Mor', 'Dhap', 'Medical Mor'], postalCode: '5400' },
  { division: 'Rangpur', district: 'Dinajpur', upazila: 'Dinajpur Sadar', areas: ['Goneshtola', 'Nimtola', 'Station Road'], postalCode: '5200' },

  // Mymensingh Division
  { division: 'Mymensingh', district: 'Mymensingh', upazila: 'Mymensingh Sadar', areas: ['Ganginarpar', 'Town Hall Mor', 'Charpara'], postalCode: '2200' },
];

const mobilePrefixes = ['17', '13', '18', '19', '14', '16', '15'];
const emailDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateCustomers(count: number = 1000): { customers: Customer[]; addresses: CustomerAddress[] } {
  const customers: Customer[] = [];
  const addresses: CustomerAddress[] = [];
  const usedPhones = new Set<string>();
  const usedEmails = new Set<string>();

  const now = Date.now();
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  for (let i = 1; i <= count; i++) {
    const isFemale = Math.random() > 0.48;
    const firstName = isFemale ? randomChoice(femaleFirstNames) : randomChoice(maleFirstNames);
    const lastName = randomChoice(lastNames);
    const fullName = `${firstName} ${lastName}`;

    // Generate unique Bangladeshi phone number (+8801[3-9]XXXXXXXX)
    let phone = '';
    do {
      const prefix = randomChoice(mobilePrefixes);
      const suffix = Math.floor(Math.random() * 90000000 + 10000000).toString().substring(0, 8);
      phone = `+880${prefix}${suffix}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);

    // Generate unique email
    let email = '';
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, '');
    const domain = randomChoice(emailDomains);
    let attempts = 0;
    do {
      const randNum = attempts === 0 ? randomInt(10, 99) : randomInt(100, 9999);
      email = `${cleanFirst}.${cleanLast}${randNum}@${domain}`;
      attempts++;
    } while (usedEmails.has(email));
    usedEmails.add(email);

    // Pick location
    const loc = randomChoice(locations);
    const area = randomChoice(loc.areas);
    const houseNum = randomInt(1, 140);
    const roadNum = randomInt(1, 35);
    const addressLine1 = `House #${houseNum}, Road #${roadNum}, ${area}`;

    // Segmentation
    const segmentRoll = Math.random();
    let totalOrders = 1;
    let totalSpent = 850;
    let status: 'ACTIVE' | 'BLACKLISTED' = 'ACTIVE';
    let isBlacklisted = false;
    let tags: string[] = [];
    let notes: string | undefined = undefined;

    if (segmentRoll < 0.10) {
      // VIP (10%)
      totalOrders = randomInt(15, 45);
      totalSpent = totalOrders * randomInt(1600, 2600);
      tags = ['VIP', 'REPEAT_BUYER'];
      notes = 'High-value loyal customer. Prioritize express courier.';
    } else if (segmentRoll < 0.45) {
      // Repeat Regulars (35%)
      totalOrders = randomInt(4, 14);
      totalSpent = totalOrders * randomInt(1200, 2100);
      tags = ['REPEAT_BUYER'];
    } else if (segmentRoll < 0.90) {
      // New / First-time (45%)
      totalOrders = randomInt(1, 3);
      totalSpent = totalOrders * randomInt(850, 1950);
      tags = ['NEW_CUSTOMER'];
    } else if (segmentRoll < 0.95) {
      // High RTO Risk (5%)
      totalOrders = randomInt(1, 2);
      totalSpent = randomInt(0, 1200);
      tags = ['HIGH_RTO_RISK'];
      notes = 'History of cancelled COD parcel at delivery doorstep.';
    } else {
      // Blacklisted (5%)
      status = 'BLACKLISTED';
      isBlacklisted = true;
      totalOrders = randomInt(1, 3);
      totalSpent = 0;
      tags = ['BLACKLISTED', 'FRAUD_SUSPECT'];
      notes = 'Blacklisted due to multiple fraudulent COD refusals.';
    }

    // Created timestamp spread over past 365 days
    const createdOffset = randomInt(0, ONE_YEAR_MS);
    const createdAt = new Date(now - createdOffset).toISOString();
    const lastOrderOffset = randomInt(0, Math.min(createdOffset, 30 * 24 * 60 * 60 * 1000));
    const lastOrderAt = totalOrders > 0 ? new Date(now - lastOrderOffset).toISOString() : undefined;

    // Sources
    const sources: CustomerSource[] = ['WEBSITE', 'SOCIAL', 'MANUAL', 'IMPORT'];
    const sourceRoll = Math.random();
    const source: CustomerSource =
      sourceRoll < 0.45 ? 'WEBSITE' : sourceRoll < 0.80 ? 'SOCIAL' : sourceRoll < 0.95 ? 'MANUAL' : 'IMPORT';

    const customerId = `cust_${String(i).padStart(5, '0')}`;
    const addressId = `addr_${String(i).padStart(5, '0')}_01`;

    const address: CustomerAddress = {
      id: addressId,
      tenant_id: TENANT_ID,
      customer_id: customerId,
      type: 'SHIPPING',
      is_default: true,
      country: 'Bangladesh',
      division: loc.division,
      district: loc.district,
      upazila: loc.upazila,
      area: area,
      address_line_1: addressLine1,
      postal_code: loc.postalCode,
      phone: phone,
      created_at: createdAt,
    };

    const customer: Customer & Record<string, unknown> = {
      id: customerId,
      tenant_id: TENANT_ID,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email: email,
      phone: phone,
      status: status,
      source: source,
      notes: notes,
      total_orders: totalOrders,
      total_spent: totalSpent,
      lifetime_value: totalSpent,
      is_blacklisted: isBlacklisted,
      district: loc.district,
      tags: tags,
      default_address: address,
      last_order_at: lastOrderAt,
      created_at: createdAt,
      updated_at: createdAt,
    };

    customers.push(customer);
    addresses.push(address);
  }

  return { customers, addresses };
}

export function runSeed() {
  const count = parseInt(process.env.COUNT || '10000', 10);
  console.log('====================================================');
  console.log(`   COMMERCEOS: GENERATING ${count.toLocaleString()} BANGLADESHI CUSTOMERS`);
  console.log('====================================================\n');

  const start = Date.now();
  const { customers, addresses } = generateCustomers(count);
  console.log(`Generated ${customers.length} customers and ${addresses.length} default addresses in ${(Date.now() - start)}ms.`);

  // 1. Seed into In-Memory & Local Database (.data/commerceos.json)
  console.log('\n[1/3] Seeding into local JSON storage (.data/commerceos.json)...');
  const existingCustomers = db.data.customers || [];
  const existingAddresses = db.data.customer_addresses || [];

  // Filter out any previous seeded batch with cust_00xxx to allow clean idempotency
  const nonSeedCustomers = existingCustomers.filter((c) => !c.id.startsWith('cust_0'));
  const nonSeedAddresses = existingAddresses.filter((a) => !a.id.startsWith('addr_0'));

  db.data.customers = [...nonSeedCustomers, ...customers];
  db.data.customer_addresses = [...nonSeedAddresses, ...addresses];
  if (typeof (db as any).persist === 'function') {
    (db as any).persist();
  }

  // Directly write to .data/commerceos.json to ensure disk durability
  const jsonPath = path.resolve(process.cwd(), '.data/commerceos.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const currentJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      currentJson.customers = db.data.customers;
      currentJson.customer_addresses = db.data.customer_addresses;
      fs.writeFileSync(jsonPath, JSON.stringify(currentJson, null, 2), 'utf8');
      console.log(`  ✓ Written ${db.data.customers.length} customers to disk at ${jsonPath}`);
    } catch (e) {
      console.error(`  Warning: failed to direct-write ${jsonPath}:`, e);
    }
  }

  // Also save a dedicated JSON seed file for reproducibility
  const seedsDir = path.resolve(__dirname, '../src/infrastructure/db/seeds');
  if (!fs.existsSync(seedsDir)) {
    fs.mkdirSync(seedsDir, { recursive: true });
  }
  const dedicatedSeedPath = path.join(seedsDir, count >= 10000 ? 'customers-10000.json' : 'customers-1000.json');
  fs.writeFileSync(
    dedicatedSeedPath,
    JSON.stringify({ customers, addresses, count: customers.length, seeded_at: new Date().toISOString() }, null, 2),
    'utf8'
  );
  console.log(`  ✓ Saved dedicated snapshot to ${dedicatedSeedPath} (${(fs.statSync(dedicatedSeedPath).size / 1024).toFixed(1)} KB)`);
  console.log(`  ✓ Successfully stored ${db.data.customers.length} total customers in local DB.`);

  // 2. Generate SQL Migration File for Neon PostgreSQL
  console.log('\n[2/3] Generating SQL migration for Neon PostgreSQL...');
  const migrationPath = path.resolve(__dirname, `../src/infrastructure/db/migrations/legacy/004_seed_${count}_customers.sql`);

  let sqlContent = `-- ============================================================\n`;
  sqlContent += `-- CommerceOS Migration 004: Seed ${count.toLocaleString()} Bangladeshi Customers\n`;
  sqlContent += `-- Neon PostgreSQL — High-fidelity customer CRM and addresses\n`;
  sqlContent += `-- ============================================================\n\n`;

  // Batch insert in chunks of 50 for optimal query execution
  const BATCH_SIZE = 50;
  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const chunk = customers.slice(i, i + BATCH_SIZE);
    sqlContent += `INSERT INTO customers (\n`;
    sqlContent += `  id, tenant_id, full_name, email, phone, district, default_address, tags,\n`;
    sqlContent += `  total_orders, total_spent, lifetime_value, is_blacklisted, notes, created_at, updated_at\n`;
    sqlContent += `) VALUES\n`;

    const values = chunk.map((c) => {
      const escapedFullName = (c.first_name + ' ' + c.last_name).replace(/'/g, "''");
      const escapedEmail = (c.email || '').replace(/'/g, "''");
      const escapedPhone = c.phone.replace(/'/g, "''");
      const escapedDistrict = (c as any).district.replace(/'/g, "''");
      const defaultAddrJson = JSON.stringify((c as any).default_address).replace(/'/g, "''");
      const tagsJson = JSON.stringify((c as any).tags || []).replace(/'/g, "''");
      const escapedNotes = c.notes ? `'${c.notes.replace(/'/g, "''")}'` : 'NULL';
      const isBl = c.status === 'BLACKLISTED' ? 'true' : 'false';

      return `  ('${c.id}', '${TENANT_ID}', '${escapedFullName}', '${escapedEmail}', '${escapedPhone}', '${escapedDistrict}', '${defaultAddrJson}'::jsonb, '${tagsJson}'::jsonb, ${c.total_orders}, ${c.total_spent}, ${c.total_spent}, ${isBl}, ${escapedNotes}, '${c.created_at}', '${c.updated_at}')`;
    });

    sqlContent += values.join(',\n') + `\nON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;\n\n`;
  }

  // Address inserts
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const chunk = addresses.slice(i, i + BATCH_SIZE);
    sqlContent += `INSERT INTO customer_addresses (\n`;
    sqlContent += `  id, tenant_id, customer_id, label, full_name, phone, address_line, area, city, postal_code, is_default, created_at\n`;
    sqlContent += `) VALUES\n`;

    const values = chunk.map((a) => {
      const parentCust = customers.find((c) => c.id === a.customer_id);
      const name = parentCust ? `${parentCust.first_name} ${parentCust.last_name}`.replace(/'/g, "''") : 'Customer';
      const addrLine = a.address_line_1.replace(/'/g, "''");
      const area = (a.area || '').replace(/'/g, "''");
      const city = a.district.replace(/'/g, "''");
      const postal = (a.postal_code || '').replace(/'/g, "''");

      return `  ('${a.id}', '${TENANT_ID}', '${a.customer_id}', 'Default Shipping', '${name}', '${a.phone}', '${addrLine}', '${area}', '${city}', '${postal}', true, '${a.created_at}')`;
    });

    sqlContent += values.join(',\n') + `\nON CONFLICT (id) DO NOTHING;\n\n`;
  }

  fs.writeFileSync(migrationPath, sqlContent, 'utf8');
  console.log(`  ✓ SQL migration saved to: ${migrationPath} (${(fs.statSync(migrationPath).size / 1024).toFixed(1)} KB)`);

  // 3. Verification Sample
  console.log('\n[3/3] Verification Sample of Seeded Customers:');
  const sample = db.data.customers.slice(0, 5);
  sample.forEach((c, idx) => {
    console.log(`  [${idx + 1}] ${c.first_name} ${c.last_name} (${c.phone}) | ${c.email}`);
    console.log(`      District: ${(c as any).district} | Segment: ${(c as any).tags?.join(', ')} | Spent: ৳${c.total_spent?.toLocaleString()}`);
  });

  console.log('\n====================================================');
  console.log('  SEED COMPLETE: 1,000 Customers Ready In CommerceOS!');
  console.log('====================================================\n');
}

// Execute seed
runSeed();
