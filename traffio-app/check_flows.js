const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    console.log('--- Flow Schema Check ---');
    const { data: flows, error } = await supabase.from('bot_flows').select('*').limit(1);

    if (error) {
        console.error('Error:', error);
    } else {
        if (flows && flows.length > 0) {
            console.log('Columns:', Object.keys(flows[0]));
        } else {
            console.log('Table is empty, cannot infer schema from data.');
        }
    }
}

check();
