const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
async function run() {
  await client.connect();
  await client.query("NOTIFY pgrst, 'reload schema'");
  console.log('Schema cache reloaded.');
  await client.end();
}
run();
