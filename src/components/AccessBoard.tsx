import {WorkBuddyHandoff} from "./WorkBuddyHandoff";
import {useMemo,useState} from 'react';
import catalog from '../lib/accessCatalog.json';
import {BRIDGE_URL,type DiscoverReport} from '../lib/bridge';
import './access-board.css';
type Entry=(typeof catalog.entries)[number];
type Result={id:string;status:string;missing:string;userAction:string;version?:string;model_count?:number;http_status?:number;chat_verified:false;task_verified:false;checked_at:string};
const labels:Record<string,string>={protocol_ok:'ACP 协议连接通过',timeout:'ACP 握手超时',launch_failed:'ACP 启动失败',exited:'ACP 提前退出',invalid_response:'ACP 协议响应不兼容',protocol_error:'ACP 返回错误',interface_ok:'接口只读检查通过',version_ok:'CLI 版本检查通过',needs_credential:'缺少有效凭据或权限',missing:'缺少本机 CLI',unsupported:'暂不支持此项验证',unverified:'尚未验证',unreachable:'服务无法访问'};
export function AccessBoard({discovery,online}:{discovery:DiscoverReport|null;online:boolean}){
 const [query,setQuery]=useState(''); const [selected,setSelected]=useState('codex');
 const [base,setBase]=useState(''); const [key,setKey]=useState('');
 const [busy,setBusy]=useState(false);const [result,setResult]=useState<Result|null>(null);const [error,setError]=useState('');
 const detected=useMemo(()=>new Set((discovery?.interfaces??[]).filter(i=>i.found).map(i=>i.kind)),[discovery]);
 const entries=useMemo(()=>catalog.entries.filter(e=>`${e.name} ${e.category} ${e.id}`.toLowerCase().includes(query.toLowerCase())),[query]);
 const entry:Entry=catalog.entries.find(e=>e.id===selected)??catalog.entries[0];
 const canProbe=entry.method==='http'||entry.method==='cli';
 const discoveredEndpoint=entry.method==='http'&&entry.category!=='云端模型 API'?(discovery?.interfaces??[]).find(i=>i.kind===entry.id&&i.endpoint&&i.listening)?.endpoint:null;
 const effectiveBase=base||discoveredEndpoint||entry.base;
 function choose(id:string){setSelected(id);setBase('');setKey('');setResult(null);setError('');}
 async function probe(acp=false){
  if(busy)return;setBusy(true);setError('');setResult(null);
  const credential=key;setKey('');
  try{
   const response=await fetch(`${BRIDGE_URL}/bridge/access/${acp?'acp':'probe'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entry.id,base_url:effectiveBase,api_key:credential}),signal:AbortSignal.timeout(15000)});
   const body=await response.json();if(!response.ok)throw Error(body.error||'验证请求失败');setResult(body);
  }catch(e){setError(e instanceof Error?e.message:'桥接未连接，请检查本地服务');}finally{setBusy(false);}
 }
 return <section className="access-board" aria-labelledby="access-heading">
  <h3 id="access-heading">接入方式与验证</h3>
  <p>已整理 {catalog.entries.length} 个接入条目 · 文档核对日期 {catalog.checked}。软件、模型 API 和协议服务分开列出；部分条目仅提供官方接入说明。</p>
  <div className="access-picker">
   <label>搜索软件或服务<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="例如 Claude、Ollama、豆包" /></label>
   <label>选择接入方式<select value={entries.some(e=>e.id===selected)?selected:''} onChange={e=>choose(e.target.value)} disabled={busy}>
    {!entries.some(e=>e.id===selected)?<option value="">请选择搜索结果</option>:null}
    {entries.map(e=><option key={e.id} value={e.id}>{e.name} · {e.category}{detected.has(e.id)?' · 本机已发现':''}</option>)}
   </select></label>
  </div>
  {!entries.length?<p>没有匹配项，可清空搜索查看全部条目。</p>:null}
  <div className="access-details">
   <h4>{entry.name} <small>{entry.category}{detected.has(entry.id)?' · 本机已发现痕迹':''}</small></h4>
   <p><strong>本项目支持：</strong>{entry.verification}</p>
   <p><strong>你需要做：</strong>{entry.userAction}</p>
   <p><strong>项目还需补充：</strong>{entry.method==='guide'?'此项尚未实现专用协议验证；这是项目开发工作，不需要你反复安装或提供登录密码。':entry.method==='existing'?'使用上方实机探测和现有派发入口；任务验证需单独发起。':'目前验证不包含真实生成、工具权限或任务执行，也不自动启用任务派发。'}</p>
   <a href={entry.docs} target="_blank" rel="noreferrer">查看官方文档 / 官方项目 ↗</a>
   {entry.method==='http'?<div className="access-fields">
    <label>服务根地址<input value={effectiveBase||''} readOnly={entry.category==='云端模型 API'} onChange={e=>setBase(e.target.value)} disabled={busy}/></label>
    {discoveredEndpoint&&!base?<p>已采用本机发现的监听地址，可手动修改。</p>:null}
    <p>只读请求：GET {entry.path}。{entry.category==='云端模型 API'?'点击后会连接所示官方域名。':'仅允许本机 127.0.0.1 / localhost；示例端口不代表已发现服务。'}</p>
    <label>该服务的 API Key / Token（{entry.auth==='required'?'必填':'按服务认证设置选填'}）<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} disabled={busy}/></label>
    <p>凭据仅用于这一次验证，提交即清空输入；不保存在浏览器、项目文件或验证结果中。不要填写桌面账号密码。</p>
   </div>:null}
   {entry.method==='cli'?<p>只运行本机命令 <code>{entry.command} --version</code>；不会下载软件、提交提示词或修改工程。</p>:null}
   {entry.id==="workbuddy"?<WorkBuddyHandoff/>:null}
   {entry.id==='codex'?<><button type="button" className="icon-btn" disabled={busy||!online} onClick={()=>void probe(true)}>检查 ACP 协议连接</button><p>使用项目内固定版本适配器，仅协商协议；不会发送任务、自动授权或改变登录。</p></>:null}
   {canProbe?<button type="button" className="icon-btn" onClick={()=>void probe()} disabled={busy||!online}>{busy?'正在验证…':entry.method==='cli'?'检查 CLI 版本':'验证服务接口'}</button>:<p role="status">{entry.method==='existing'?'请使用上方「一键探测」查看现有适配器结果。':'目前仅支持接入说明，尚不能在线验证此项。'}</p>}
   {!online?<p>本机桥接未连接，验证按钮暂不可用。</p>:null}
   {error?<p role="alert">{error}</p>:null}
   {result?<div className="access-result" role="status">
    <strong>{labels[result.status]??'验证未完成'}</strong>
    {result.version?<p>CLI 版本：{result.version}</p>:null}
    {result.model_count!==undefined?<p>模型目录数量：{result.model_count}</p>:null}
    {result.http_status?<p>HTTP 状态：{result.http_status}</p>:null}
    <p>缺少什么：{result.missing}</p><p>你需要做：{result.userAction}</p>
    <p>对话：未验证 · 工具：未验证 · 任务执行：未验证</p>
   </div>:null}
  </div>
 </section>;
}
