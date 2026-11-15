import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/chat/route';

test('chat defaults to Nemotron with thinking disabled and returns its final answer', async () => {
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.NVIDIA_API_KEY;
  const oldModel = process.env.NVIDIA_CHAT_MODEL;
  process.env.NVIDIA_API_KEY = 'test-key';
  delete process.env.NVIDIA_CHAT_MODEL;
  const payloads: Record<string, any>[] = [];
  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(init!.body as string));
    return Response.json({choices:[{message:{content:'Hello.'},finish_reason:'stop'}]});
  };
  try {
    for (const content of ['Hello', 'Give me a detailed explanation']) {
      const result = await POST(new Request('http://localhost:3000/api/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({messages:[{role:'user',content}]})
      }));
      assert.equal(result.status,200);
      assert.equal((await result.json()).text,'Hello.');
    }
    assert.equal(payloads[0].model,'nvidia/nemotron-3.5-lightning-30b-a3b');
    assert.equal(payloads[0].reasoning_effort,undefined);
    assert.deepEqual(payloads[0].chat_template_kwargs,{enable_thinking:false});
    assert.ok(payloads[1].max_tokens > payloads[0].max_tokens);
  } finally {
    globalThis.fetch=originalFetch;
    if(oldKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY=oldKey;
    if(oldModel === undefined) delete process.env.NVIDIA_CHAT_MODEL; else process.env.NVIDIA_CHAT_MODEL=oldModel;
  }
});
