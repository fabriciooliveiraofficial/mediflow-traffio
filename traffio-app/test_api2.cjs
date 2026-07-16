const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function testFetch() {
  const url1 = `${supabaseUrl}/rest/v1/appointments?select=id&tenant_id=eq.3810a967-507f-4415-866b-0f67b7d06053&start_time=gte.2026-06-30T12%3A00%3A00.000Z&status=not.in.%28%22canceled%22%2C%22cancelled%22%29`;
  const url2 = `${supabaseUrl}/rest/v1/commercial_proposals?select=*%2Cpatients%3Apatient_id%28id%2Cfull_name%2Cphone%2Cmobile%2Cemail%29&tenant_id=eq.3810a967-507f-4415-866b-0f67b7d06053&order=created_at.desc`;

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  };

  let res = await fetch(url1, { headers });
  console.log("URL1 Status:", res.status);
  console.log("URL1 Body:", await res.text());

  res = await fetch(url2, { headers });
  console.log("URL2 Status:", res.status);
  console.log("URL2 Body:", await res.text());
}
testFetch();
