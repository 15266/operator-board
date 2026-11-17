export class HttpInputError extends Error {constructor(message,status=400){super(message);this.status=status;}}
export function validateDispatch(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpInputError('请求必须是 JSON 对象');
 if(!['workbuddy','codex','doubao','akili'].includes(body.executor))throw new HttpInputError('不支持的执行器');
 if(typeof body.prompt!=='string'||!body.prompt.trim())throw new HttpInputError('prompt 必须是非空文本');
 if(body.prompt.length>128000)throw new HttpInputError('任务内容过长',413);
 for(const key of ['task_id','project_id','title','model'])if(body[key]!=null&&(typeof body[key]!=='string'||body[key].length>(key==='title'?1000:200)))throw new HttpInputError(key+' 格式无效');
 if(body.force)throw new HttpInputError('此入口不允许跳过派发保护');
 return {...body,prompt:body.prompt.trim()};
}
export const isPendingDispatch=state=>['queued','running','awaiting_user','sent_awaiting_result'].includes(state);
export function closeHandoff(record,at){
 if(record.state!=='awaiting_user')throw new HttpInputError('只有待手动发送的交接记录可以结束',409);
 return {state:'handoff_closed',finished_at:at,reply:null,evidence:{...record.evidence,handoff_closed_by_user:true,user_action:'交接记录已结束；这不表示模型任务完成，也不会停止 WorkBuddy 中的任务。'}};
}
export async function readObjectBody(req,limit=512*1024){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>limit)throw new HttpInputError('请求体过大',413);chunks.push(Buffer.from(chunk));}
 let body;try{body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}catch{throw new HttpInputError('JSON 格式无效');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpInputError('请求必须是 JSON 对象');return body;
}
