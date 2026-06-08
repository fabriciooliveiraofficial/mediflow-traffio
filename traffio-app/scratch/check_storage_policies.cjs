const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function checkStoragePolicies() {
  console.log('Querying storage policies...');
  // We can query the pg_policies or storage.policies table via RPC or direct SQL if exposed,
  // or check if we can list files in the bucket using ANON_KEY.
  const { data, error } = await supabase.storage.from('chat-media').list('', { limit: 5 });
  
  if (error) {
    console.error('Error listing chat-media bucket:', error);
  } else {
    console.log('Successfully listed chat-media bucket contents:', data);
  }
}

checkStoragePolicies();
