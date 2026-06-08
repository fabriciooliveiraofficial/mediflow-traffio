const fs = require('fs');
const content = fs.readFileSync('d:\\1. Clientes\\47. Traffio\\traffio-app\\src\\pages\\HumanInboxPage.tsx', 'utf8');
const lines = content.split('\n');

console.log("Searching for handleSelectScript...");
lines.forEach((line, index) => {
  if (line.includes('handleSelectScript')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
