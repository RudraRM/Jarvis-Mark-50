import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readChatStream} from '../lib/chat-stream';
test('stream emits text before completion and handles split UTF-8',async()=>{
 let controller:ReadableStreamDefaultController<Uint8Array>;
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;}});
 const output:string[]=[];const reading=readChatStream(new Response(stream),t=>output.push(t));
 const bytes=new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello 🌌"}}]}\n\n');
 for(const byte of bytes)controller!.enqueue(new Uint8Array([byte]));
 await new Promise(r=>setTimeout(r,20));assert.deepEqual(output,['Hello 🌌']);
 controller!.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'));controller!.close();
 assert.deepEqual(await reading,{truncated:true});
});
test('incomplete streams and upstream error events are failures',async()=>{
 for(const body of ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n','data: {"error":{"message":"overloaded"}}\n\n']){
 await assert.rejects(readChatStream(new Response(body),()=>{}));
 }
});
