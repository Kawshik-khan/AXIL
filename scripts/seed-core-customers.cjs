const fs = require('fs');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { neon } = require('@neondatabase/serverless');

const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
for (const l of lines) {
  const [k, ...v] = l.split('=');
  if (k && v.length) process.env[k.trim()] = v.join('=').trim();
}

const sql = neon(process.env.DATABASE_URL);

async function seed() {
  const custs = [
    { id: 'cust_nusrat', name: 'Nusrat Jahan', email: 'nusrat.jahan@gmail.com', phone: '+8801711223344', district: 'Dhaka' },
    { id: 'cust_tanvir', name: 'Tanvir Ahmed', email: 'tanvir.ahmed@yahoo.com', phone: '+8801819876543', district: 'Chattogram' },
    { id: 'cust_sadia', name: 'Sadia Islam', email: 'sadia.islam@outlook.com', phone: '+8801912445566', district: 'Dhaka' },
    { id: 'cust_kamrul', name: 'Kamrul Hasan', email: 'kamrul.hasan@gmail.com', phone: '+8801712998877', district: 'Dhaka' },
    { id: 'cust_anika', name: 'Anika Rahman', email: 'anika.rahman@gmail.com', phone: '+8801611002233', district: 'Dhaka' },
    { id: 'cust_farhan', name: 'Farhan Kabir', email: 'farhan.kabir@gmail.com', phone: '+8801755667788', district: 'Rajshahi' }
  ];

  for (const c of custs) {
    await sql.query(
      `INSERT INTO customers (id, tenant_id, full_name, email, phone, district) 
       VALUES ($1, 'ten_default_dhaka', $2, $3, $4, $5) 
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
      [c.id, c.name, c.email, c.phone, c.district]
    );
    console.log(`Seeded: ${c.id} (${c.name})`);
  }
  console.log('✅ Core customers seeded successfully.');
}

seed().catch(err => {
  console.error('Error seeding customers:', err);
  process.exit(1);
});
