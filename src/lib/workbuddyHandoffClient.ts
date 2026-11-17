type Options={fetchImpl?:typeof fetch;delay?:(ms:number)=>Promise<void>;attempts?:number};
export async function requestWorkBuddyHandoff(base:string,prompt:string,{fetchImpl=fetch,delay=ms=>new Promise(r=>setTimeout(r,ms)),attempts=10}:Options={}) {
 if(!prompt.trim())throw new Error('请输入任务内容');
 const r=await fetchImpl(`${base}/bridge/dispatch`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({executor:'workbuddy',prompt:prompt.trim(),title:'WorkBuddy 桌面手动交接'}),signal:AbortSignal.timeout(10000)});
 const body=await r.json();if(!r.ok)throw new Error(body.error||'本机桥接无法发起交接');
 const id=body.dispatch?.id;if(typeof id!=='string'||!id)throw new Error('桥接没有返回有效交接记录');
 for(let attempt=0;attempt<attempts;attempt++){
  const response=await fetchImpl(`${base}/bridge/dispatches`,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('无法读取交接状态');
  const data=await response.json();if(!Array.isArray(data.dispatches))throw new Error('桥接返回的交接状态格式无效');
  const record=data.dispatches.find((item:{id:string})=>item.id===id);
  if(record?.state==='failed')throw new Error(record.error||'WorkBuddy 启动请求失败');
  if(record?.state==='awaiting_user')return {id,confirmed:true};
  await delay(400);
 }
 return {id,confirmed:false};
}
