const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
let statusText = fs.readFileSync('supabase_status.json', 'utf8');
if (statusText.charCodeAt(0) === 0xFEFF) {
  statusText = statusText.slice(1);
}
const status = JSON.parse(statusText);

const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY);

async function testInsert() {
  console.log('Testing insert on doctor_services...');
  // Fake IDs
  const fakeDoc = '11111111-1111-1111-1111-111111111111';
  const fakeSvc = '22222222-2222-2222-2222-222222222222';
  
  const { data, error } = await supabase.from('doctor_services').insert({
     doctor_id: fakeDoc,
     service_id: fakeSvc
  }).select();

  console.log('Insert Result:', data);
  if (error) {
     console.error('Insert Error Detail:', error);
  }

  const { data: cols, error: colErr } = await supabase.from('doctor_services').select('*').limit(1);
  console.log('Columns:', Object.keys(cols?.[0] || {}));
}

testInsert();
