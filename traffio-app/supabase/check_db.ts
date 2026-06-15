import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import * as dotenv from "https://deno.land/std@0.168.0/dotenv/mod.ts";

const env = await dotenv.load({ envPath: "../../.env" });
const supabaseUrl = env["VITE_SUPABASE_URL"];
const supabaseKey = env["SUPABASE_SERVICE_ROLE_KEY"] || env["VITE_SUPABASE_ANON_KEY"];

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Checking master_config...");
  const { data: configData, error: configError } = await supabase
    .from("master_config")
    .select("*")
    .in("key", ["GOOGLE_DEVELOPER_TOKEN", "GOOGLE_CLIENT_ID"]);
  
  if (configError) console.error("Config Error:", configError);
  console.log("master_config Google variables:");
  configData?.forEach(row => {
    console.log(`- ${row.key}: ${row.value ? 'SET (length: ' + row.value.length + ')' : 'EMPTY'}`);
  });

  console.log("\nChecking ad_integrations...");
  const { data: adData, error: adError } = await supabase
    .from("ad_integrations")
    .select("tenant_id, platform, settings")
    .eq("platform", "google");
  
  if (adError) console.error("Ad Integration Error:", adError);
  console.log("Google ad_integrations:");
  adData?.forEach(row => {
    console.log(`- Tenant: ${row.tenant_id}`);
    console.log(`  customer_id: ${row.settings?.customer_id || 'MISSING'}`);
    console.log(`  developer_token: ${row.settings?.developer_token ? 'SET' : 'MISSING'}`);
    console.log(`  available_customers: ${row.settings?.available_customers?.length || 0}`);
  });
}

main();
