
const fetch = require('node-fetch');
async function testWebhook() {
  const url = 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/whatsapp-bot';
  const payload = {
    instanceId: '3E7A1782ADDED03618F7326225A8F6AC',
    phone: '5541999999999',
    text: { message: 'Teste v29 Antigravity (JS Script)' }
  };
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('STATUS:', res.status);
    console.log('RESPONSE:', await res.json());
  } catch (e) {
    console.error('ERROR:', e);
  }
}
testWebhook();
