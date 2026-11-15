/** Parse NVIDIA/OpenAI SSE even when network reads split JSON or UTF-8. */
export async function readChatStream(response: Response, onText: (text: string) => void) {
  if (!response.body) throw new Error('Chat stream unavailable.');
  const reader=response.body.getReader();const decoder=new TextDecoder();
  let pending='';let complete=false;let truncated=false;
  const line=(value:string)=>{
    if(!value.startsWith('data:'))return;
    const data=value.slice(5).trim();if(!data)return;
    if(data==='[DONE]'){complete=true;return;}
    const event=JSON.parse(data);
    if(event.error)throw new Error(event.error.message || 'Chat generation failed.');
    const choice=event.choices?.[0];
    if(typeof choice?.delta?.content==='string')onText(choice.delta.content);
    if(choice?.finish_reason){complete=true;truncated=choice.finish_reason==='length';}
  };
  try {
    while(true){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});let end;
      while((end=pending.indexOf('\n'))>=0){line(pending.slice(0,end).trimEnd());pending=pending.slice(end+1);}
      if(done){if(pending.trim())line(pending.trimEnd());break;}
    }
    if(!complete)throw new Error('Connection ended before the answer finished. Please try again.');
    return {truncated};
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
