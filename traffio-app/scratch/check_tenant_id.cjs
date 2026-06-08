const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let statusText = fs.readFileSync('supabase_status.json', 'utf8');
if (statusText.charCodeAt(0) === 0xFEFF) {
  statusText = statusText.slice(1);
}
const status = JSON.parse(statusText);

const envLocal = fs.readFileSync('.env.local', 'utf8');
const supabaseUrlMatch = envLocal.match(/VITE_SUPABASE_URL=([^\n]+)/);
const supabaseAnonKeyMatch = envLocal.match(/VITE_SUPABASE_ANON_KEY=([^\n]+)/);

const supabaseUrl = supabaseUrlMatch[1].trim();
const supabaseAnonKey = supabaseAnonKeyMatch[1].trim();

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data, error } = await supabase.from('sales_scripts').select('*');
  console.log("Scripts:");
  if (data) {
    data.forEach(s => console.log(`ID: ${s.id}, Title: ${s.title}, tenant_id: ${s.tenant_id}`));
  }
  if (error) {
    console.error("Error:", error);
  }
}

run();
