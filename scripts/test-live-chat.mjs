// Start Jarvis first with npm run dev. This uses the real configured model.
const started = performance.now();
try {
  const response = await fetch('http://127.0.0.1:3000/api/chat', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({messages:[{role:'user',content:'What is 17 times 23? Answer in one sentence.'}]}),
    signal: AbortSignal.timeout(185000),
  });
  const body = await response.json();
  const elapsed = ((performance.now()-started)/1000).toFixed(2);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error || 'Chat failed'}`);
  if (typeof body.text !== 'string' || !/\b391\b/.test(body.text)) throw new Error('The model did not return the expected answer (391).');
  console.log(`PASS (${elapsed}s): ${body.text}`);
} catch (error) {
  console.error(`FAIL after ${((performance.now()-started)/1000).toFixed(2)}s: ${error.message}`);
  process.exitCode = 1;
}
