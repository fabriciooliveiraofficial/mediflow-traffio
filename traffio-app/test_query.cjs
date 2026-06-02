const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
let statusText = fs.readFileSync('supabase_status.json', 'utf8');
if (statusText.charCodeAt(0) === 0xFEFF) {
  statusText = statusText.slice(1);
}
const status = JSON.parse(statusText);

const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY);

async function testQuery() {
  console.log('Testing select on doctor_services...');
  const { data, error } = await supabase.from('doctor_services').select('*').limit(1);
  console.log('Select Result:', data);
  if (error) console.error('Select Error:', error);
}

testQuery();
