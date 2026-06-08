const fs = require('fs');

let envText = fs.readFileSync('.env.local', 'utf8');
if (envText.charCodeAt(0) === 0xFEFF) envText = envText.slice(1);

const url = envText.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function testEdge() {
  const endpoint = `${url}/functions/v1/send-human-media`;
  console.log(`Pinging Edge Function with user_id fallback: ${endpoint}`);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        session_id: '11111111-1111-1111-1111-111111111111',
        tenant_id: '22222222-2222-2222-2222-222222222222',
        user_id: '99999999-9999-9999-9999-999999999999',
        media_url: 'https://example.com/image.png',
        media_type: 'image'
      })
    });

    console.log(`Status Code: ${res.status}`);
    const body = await res.text();
    console.log(`Response Body: ${body}`);
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

testEdge();
