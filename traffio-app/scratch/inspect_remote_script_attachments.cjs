const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function inspectAttachments() {
  console.log('Querying remote sales_scripts attachments...');
  const { data, error } = await supabase
    .from('sales_scripts')
    .select('id, title, attachments');

  if (error) {
    console.error('Error fetching:', error);
  } else {
    data.forEach(s => {
      console.log(`- Script: ${s.title}`);
      console.log(`  Attachments: ${JSON.stringify(s.attachments, null, 2)}`);
    });
  }
}

inspectAttachments();
