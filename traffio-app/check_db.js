
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    console.log('--- DB Check ---');
    const { data: tenants } = await supabase.from('tenants').select('id, name, zapi_instance_id');
    console.log('Tenants:', tenants);

    const { data: doctors } = await supabase.from('doctors').select('id, specialty, profiles(full_name)');
    console.log('Doctors:', doctors);
}

check();
