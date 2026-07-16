const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function testFetch() {
  const url = `${supabaseUrl}/rest/v1/`;
  const headers = { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };
  let res = await (await fetch(url, { headers })).json();
  const def = res.definitions.appointments;
  console.log("start_time type:", def.properties.start_time.type, def.properties.start_time.format);
}
testFetch();
