const fs = require('fs');
const logPath = 'C:\\Users\\User\\.gemini\\antigravity-ide\\brain\\0f439368-557b-4f0b-a46c-91d688339d9d\\.system_generated\\logs\\transcript.jsonl';

function readLog() {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  
  for (const line of lines) {
    const step = JSON.parse(line);
    if (step.step_index === 375) {
      console.log('--- FOUND STEP 375 ---');
      console.log(JSON.stringify(step, null, 2));
      return;
    }
  }
  console.log('Step 375 not found.');
}

readLog();
