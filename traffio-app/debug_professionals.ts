
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!);

async function debugProfessionals() {
    console.log("--- DEBUGGING PROFESSIONALS ---");

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
