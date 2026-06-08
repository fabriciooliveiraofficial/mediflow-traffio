const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let statusText = fs.readFileSync('supabase_status.json', 'utf8');
if (statusText.charCodeAt(0) === 0xFEFF) {
  statusText = statusText.slice(1);
}
const status = JSON.parse(statusText);

const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY);

async function inspectScript() {
  const targetId = '6b71a773-b1e8-4330-be3e-b5b27af369f6';
  console.log(`Inspecting script: ${targetId}`);
  
  const { data: script, error } = await supabase
    .from('sales_scripts')
    .select('*')
    .eq('id', targetId)
    .single();

  if (error) {
    console.error('Error fetching script:', error);
  } else {
    console.log('Script Data:', JSON.stringify(script, null, 2));
  }
}

inspectScript();
