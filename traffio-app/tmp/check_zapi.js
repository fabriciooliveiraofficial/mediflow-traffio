
const fetch = require('node-fetch');
async function checkZapi() {
  const instanceId = '3E7A1782ADDED03618F7326225A8F6AC';
  const token = '35939226593437AD6A26E92E'; 
  const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
  
  try {
    const statusRes = await fetch(`${baseUrl}/status`);
    console.log('Z-API STATUS:', await statusRes.json());
    
    const webhookRes = await fetch(`${baseUrl}/webhooks`);
    console.log('WEBHOOKS:', await webhookRes.json());
  } catch (e) {
    console.error('ERROR:', e);
  }
}
checkZapi();
