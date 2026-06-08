const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function checkScripts() {
  console.log('Querying remote sales_scripts...');
  const { data, error } = await supabase
    .from('sales_scripts')
    .select('*');

  if (error) {
    console.error('Error fetching sales_scripts:', error);
  } else {
    console.log(`Fetched ${data.length} scripts:`);
    data.forEach(s => {
      console.log(`- ID: ${s.id}, Tenant: ${s.tenant_id}, Shortcut: ${s.shortcut}, Title: ${s.title}`);
    });
  }
}

checkScripts();
