const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log("Testing commercial_proposals query:");
  const res1 = await supabase.from('commercial_proposals').select('*, patients:patient_id(id)').limit(1);
  console.log(res1.error);

  console.log("\nTesting appointments query:");
  const res2 = await supabase.from('appointments').select('id, start_time, status, patients(full_name)').limit(1);
  console.log(res2.error);
  
  console.log("\nTesting appointments not.in with string:");
  const res3 = await supabase.from('appointments').select('id').not('status', 'in', '("canceled","cancelled")').limit(1);
  console.log(res3.error);
  
  console.log("\nTesting appointments in with array:");
  const res4 = await supabase.from('appointments').select('id').in('status', ['noshow','no_show']).limit(1);
  console.log(res4.error);
}
test();
