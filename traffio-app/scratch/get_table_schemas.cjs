const fetch = require('node-fetch');
const fs = require('fs');

let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function getSwaggerSpec() {
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    const spec = await response.json();
    console.log('Response content:', spec);
  } catch (error) {
    console.error('Error fetching spec:', error);
  }
}

getSwaggerSpec();
