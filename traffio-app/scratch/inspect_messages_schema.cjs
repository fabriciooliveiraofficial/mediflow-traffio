const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function inspectSchema() {
  console.log('Querying conversation_messages column schema...');
  // We can select a single message and print its keys
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching columns:', error);
  } else {
    console.log('Sample record keys:', data.length > 0 ? Object.keys(data[0]) : 'No records found');
  }
}

inspectSchema();
