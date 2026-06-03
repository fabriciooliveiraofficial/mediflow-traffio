const fetch = require('node-fetch');
const fs = require('fs');

let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function getSwaggerSpec() {
  console.log('Fetching OpenAPI spec from:', url);
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    const spec = await response.json();
    console.log('Spec top-level keys:', Object.keys(spec));
    if (spec.definitions) {
      console.log('Definitions keys:', Object.keys(spec.definitions));
    } else if (spec.components && spec.components.schemas) {
      console.log('Components.schemas keys:', Object.keys(spec.components.schemas));
      console.log('ad_integrations schema:', JSON.stringify(spec.components.schemas.ad_integrations, null, 2));
      console.log('ad_performance_daily schema:', JSON.stringify(spec.components.schemas.ad_performance_daily, null, 2));
    } else {
      console.log('No definitions or schemas key found. Spec snippet:', JSON.stringify(spec).slice(0, 1000));
    }
  } catch (error) {
    console.error('Error fetching spec:', error);
  }
}

getSwaggerSpec();


