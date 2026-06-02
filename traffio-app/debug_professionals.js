
import { createClient } from '@supabase/supabase-js';

// Hardcoded for debug purposes based on .env.local view
const supabaseUrl = 'https://fyyhxmugxcfqhvoevuwf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5eWh4bXVneGNmcWh2b2V2dXdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NTk0MDIsImV4cCI6MjA4NjMzNTQwMn0.4P_7_DpEFS51QcsyWk0s0DLUqPZEXA7NJf4sAy6jqrg';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugProfessionals() {
    console.log("--- DEBUGGING PROFESSIONALS (CommonJS) ---");

    // 1. Get a sample Tenant
    const { data: tenant } = await supabase.from('tenants').select('id, name').limit(1).single();
    if (!tenant) return console.log("No tenants found.");
    console.log(`Tenant: ${tenant.name} (${tenant.id})`);

    // 2. Check Members
    const { data: members, error: memError } = await supabase
        .from('members')
        .select('*')
        .eq('tenant_id', tenant.id);

    if (memError) console.error("Members Error:", memError);
    console.log(`Members found: ${members?.length || 0}`);
    if (members) console.table(members);

    if (!members || members.length === 0) return;

    const userIds = members.map(m => m.user_id);
    console.log("User IDs from Members:", userIds);

    // 3. Check Doctors with IN filter
    const { data: doctors, error: docError } = await supabase
        .from('doctors')
        .select('*')
        .in('id', userIds);

    if (docError) console.error("Doctors Error:", docError);
    console.log(`Doctors found matching Members: ${doctors?.length || 0}`);
    if (doctors) console.table(doctors);

    // 4. Check ALL Doctors (to see if IDs mismatch)
    const { data: allDocs } = await supabase.from('doctors').select('id, full_name, email');
    console.log(`Total Doctors in DB: ${allDocs?.length || 0}`);
    if (allDocs) console.table(allDocs);
}

debugProfessionals();
