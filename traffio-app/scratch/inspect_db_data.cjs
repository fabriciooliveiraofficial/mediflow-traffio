const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function inspectData() {
  console.log('Querying remote conversation_sessions...');
  const { data: sessions, error } = await supabase
    .from('conversation_sessions')
    .select('id, tenant_id, assigned_to_user_id, patient_phone, channel')
    .limit(5);

  if (error) {
    console.error('Error fetching sessions:', error);
  } else {
    console.log('Conversation Sessions:');
    sessions.forEach(s => {
      console.log(`- Session ID: ${s.id}, Tenant ID: ${s.tenant_id}, Assigned User: ${s.assigned_to_user_id}, Phone: ${s.patient_phone}, Channel: ${s.channel}`);
    });
  }

  console.log('\nQuerying members...');
  const { data: members, error: memError } = await supabase
    .from('members')
    .select('tenant_id, user_id')
    .limit(5);

  if (memError) {
    console.error('Error fetching members:', memError);
  } else {
    console.log('Members:');
    members.forEach(m => {
      console.log(`- Tenant ID: ${m.tenant_id}, User ID: ${m.user_id}`);
    });
  }
}

inspectData();
