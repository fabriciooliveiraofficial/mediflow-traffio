import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Manually load .env to avoid package issues
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split(/\r?\n/).forEach(line => {
        const [key, val] = line.split('=');
        if (key && val) {
            process.env[key.trim()] = val.trim();
        }
    });
}

// Also try .env.local
const envLocalPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envLocalPath)) {
    const envConfig = fs.readFileSync(envLocalPath, 'utf8');
    envConfig.split(/\r?\n/).forEach(line => {
        const [key, val] = line.split('=');
        if (key && val) {
            process.env[key.trim()] = val.trim();
        }
    });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing credentials in .env or .env.local');
    // Fallback/Hardcode if needed for debug (not recommended but useful if env fails)
} else {
    const supabase = createClient(supabaseUrl, supabaseKey);

    async function check() {
        console.log('--- Flow Schema Check (ESM) ---');
        const { data: flows, error } = await supabase.from('bot_flows').select('*').limit(1);

        if (error) {
            console.error('Error:', error);
        } else {
            if (flows && flows.length > 0) {
                console.log('Columns:', Object.keys(flows[0]));
            } else {
                console.log('Table is empty, cannot infer schema. Trying insert dry-run...');
                // Try inserting a dummy to see if it complains about missing columns or we can check error
            }
        }
    }

    check();
}
