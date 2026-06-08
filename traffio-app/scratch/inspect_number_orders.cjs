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
  const { data: orders, error: ordersErr } = await supabase.from('number_order_requests').select('*');
  console.log("Orders:");
  console.log(orders);
  if (ordersErr) console.error("Orders Error:", ordersErr);

  const { data: numbers, error: numbersErr } = await supabase.from('tenant_phone_numbers').select('*');
  console.log("Numbers:");
  console.log(numbers);
  if (numbersErr) console.error("Numbers Error:", numbersErr);
}

run();
