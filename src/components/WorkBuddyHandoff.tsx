import {requestWorkBuddyHandoff} from "../lib/workbuddyHandoffClient";
import {useState} from 'react';
import {BRIDGE_URL} from '../lib/bridge';
function taskUrl(prompt:string) {const params=new URLSearchParams({action:'start',prompt});return `workbuddy://task?${params.toString()}`;}
export function WorkBuddyHandoff(){
 const [prompt,setPrompt]=useState('只回复：OPERATOR_BOARD_TEST_OK。不要读取、修改文件或调用其他工具。');
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
 const url=taskUrl(prompt.trim());const valid=prompt.trim().length>0&&prompt.length<=8000&&url.length<=24000;
 async function openViaBridge(){
  if(!valid||busy)return;setBusy(true);setMessage('');setError('');
  try{
   const result=await requestWorkBuddyHandoff(BRIDGE_URL,prompt);
   setMessage(result.confirmed?'已通过本机桥接请求 WorkBuddy 打开任务。请到 WorkBuddy 检查输入内容并手动发送；尚未收到模型回复。':'已建立交接记录，客户端是否接收尚未确认。请检查 WorkBuddy，避免重复打开。');
  }catch(e){setError(e instanceof Error?e.message:'无法连接本机桥接；请检查桥接服务');}finally{setBusy(false);}
 }
 return <section className="access-result" aria-label="WorkBuddy 桌面连接测试">
  <h4>WorkBuddy 桌面任务入口</h4>
  <p>无需 API Key 或 WB_TOKEN。主按钮通过本机桥接调用已安装的 WorkBuddy，不依赖内置浏览器处理外部协议，也不使用屏幕控制。</p>
  <label>准备交给 WorkBuddy 的内容<textarea value={prompt} onChange={e=>{setPrompt(e.target.value);setMessage('');setError('');}} rows={4} disabled={busy} style={{width:'100%',boxSizing:'border-box'}}/></label>
  {valid?<p><button className="icon-btn" type="button" onClick={()=>void openViaBridge()} disabled={busy}>{busy?'正在请求打开…':'通过本机桥接打开 WorkBuddy'}</button></p>:<p role="alert">请输入任务内容；内容过长时请缩短后再打开。</p>}
  {message?<p role="status">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
  <p>打开后检查输入内容，再在 WorkBuddy 手动发送。只有你发送后才会执行模型任务，可能使用模型额度。操作台不会自动读取回复。</p>
  {valid?<p><a href={url}>备用：使用系统注册的 WorkBuddy 链接</a>（内置预览可能不支持）</p>:null}
  <p>若没有自动填入，请复制上面的任务文字到 WorkBuddy 新建任务。操作台不会把启动请求当成任务成功。</p>
 </section>;
}
