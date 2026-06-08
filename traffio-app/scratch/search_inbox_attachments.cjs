const fs = require('fs');
const content = fs.readFileSync('d:\\1. Clientes\\47. Traffio\\traffio-app\\src\\pages\\HumanInboxPage.tsx', 'utf8');
const lines = content.split('\n');

console.log("Searching for attachments...");
lines.forEach((line, index) => {
  if (line.includes('attachments') || line.includes('Attachment')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
