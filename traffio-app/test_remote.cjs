const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function testRemote() {
  console.log('Testing against remote DB:', url);
  // We don't have a user session, but we can see if RLS immediately blocks it
  // or if there's a constraint error.
  const { data, error } = await supabase.from('doctor_services').insert({
     tenant_id: '11111111-1111-1111-1111-111111111111',
     doctor_id: '22222222-2222-2222-2222-222222222222',
     service_id: '33333333-3333-3333-3333-333333333333',
     location_id: '44444444-4444-4444-4444-444444444444'
  }).select();

  console.log('Insert Result:', data);
  if (error) console.error('Insert Error Detail:', error);
}

testRemote();
