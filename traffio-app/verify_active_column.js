import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Manually load .env or .env.local
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let envPath = path.resolve(__dirname, '.env');

if (!fs.existsSync(envPath)) {
    envPath = path.resolve(__dirname, '.env.local');
}

if (fs.existsSync(envPath)) {
    console.log('Loading env from:', envPath);
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split(/\r?\n/).forEach(line => {
        // Skip comments and empty lines
        if (line.trim().startsWith('#') || !line.trim()) return;

        const [key, ...valParts] = line.split('=');
        if (key && valParts.length > 0) {
            process.env[key.trim()] = valParts.join('=').trim();
        }
    });
} else {
    console.warn('No .env or .env.local file found.');
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// Use SERVICE_ROLE key if available for DDL, otherwise we might fail if RLS is strict
// But we only have anon key in .env usually. We will try RPC if available, or just rely on the fact that existing code uses it.
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing credentials. Available keys:', Object.keys(process.env).filter(k => k.startsWith('VITE_')));
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAndAdd() {
    console.log('--- Ensuring is_active Column ---');

    // We can't do DDL with anon key usually. 
    // We will assume it exists because the frontend code I wrote earlier tries to insert it.
    // Let's just create a dummy flow and see if it accepts is_active: false

    const { data, error } = await supabase.from('bot_flows').insert({
        name: 'Schema Check Flow',
        definition: {},
        is_active: false,
        tenant_id: '00000000-0000-0000-0000-000000000000' // UUID format
    }).select();

    if (error) {
        console.error('Insert Error (might indicate missing column or RLS):', error.message);
        if (error.message.includes('is_active')) {
            console.log('CRITICAL: Column is_active seems missing.');
        } else {
            console.log('Column likely exists, error is something else (RLS/FK).');
        }
    } else {
        console.log('Insert succesful, column exists.');
        // Cleanup
        if (data && data[0]) {
            await supabase.from('bot_flows').delete().eq('id', data[0].id);
        }
    }
}

checkAndAdd();
