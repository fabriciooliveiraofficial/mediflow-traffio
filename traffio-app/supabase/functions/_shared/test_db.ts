import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  console.log("No Supabase URL/Key provided");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPending() {
  const { data, error } = await supabase.from('outbound_message_queue').select('*').eq('status', 'pending');
  console.log('Pending messages:', data);
  if (error) console.error('Error fetching pending:', error);
}

async function testClaim() {
  const { data, error } = await supabase.rpc('claim_outbound_messages', { p_batch_size: 150, p_per_tenant_cap: 15 });
  console.log('Claimed messages:', data);
  if (error) console.error('Error claiming messages:', error);
}

await checkPending();
await testClaim();
