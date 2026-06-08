const fs = require('fs');
const content = fs.readFileSync('d:\\1. Clientes\\47. Traffio\\traffio-app\\src\\pages\\Settings.tsx', 'utf8');
const lines = content.split('\n');

console.log("Searching for telnyx fields in Settings.tsx...");
lines.forEach((line, index) => {
  if (line.includes('telnyx_') || line.includes('api_key') || line.includes('app_id') || line.includes('communication') || line.includes('Comunicação') || line.includes('showBuyNumber')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
