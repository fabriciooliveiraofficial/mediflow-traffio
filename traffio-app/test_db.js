const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
async function run() {
  await client.connect();
  const res = await client.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'doctor_services'");
  console.log('Columns:', res.rows);
  const pol = await client.query("SELECT polname FROM pg_policy WHERE polrelid = 'doctor_services'::regclass");
  console.log('Policies:', pol.rows);
  await client.end();
}
run();
