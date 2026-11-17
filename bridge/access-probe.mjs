import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export const accessCatalog=JSON.parse(fs.readFileSync(new URL('../src/lib/accessCatalog.json',import.meta.url),'utf8'));
const byId=new Map(accessCatalog.entries.map(entry=>[entry.id,entry]));
const loopback=new Set(['127.0.0.1','localhost','[::1]']);
export function probeUrl(entry,input){
 const raw=input||entry.base;
 if(typeof raw!=="string"||/%|\\|[\r\n]/.test(raw))throw Error("地址格式无效");
 const base=new URL(raw);
 if(base.username||base.password||base.search||base.hash)throw Error('地址不能包含账号、密码、查询参数或片段');
 if(!['http:','https:'].includes(base.protocol))throw Error('仅支持 HTTP/HTTPS');
 if(entry.category==='云端模型 API'){
  const expected=new URL(entry.base);
  if(base.origin!==expected.origin||base.pathname.replace(/\/$/,'')!==expected.pathname.replace(/\/$/,''))throw Error('云端验证仅允许所选服务的官方固定地址，不能修改到其他域名或路径');
 }else if(!loopback.has(base.hostname))throw Error('本地服务仅允许本机环回地址');
 if(/%|\.\./.test(base.pathname))throw Error('不支持编码或相对路径');
 const root=base.href.replace(/\/$/,'');
 // Accept root, API-prefix and complete read-only endpoint without repeating /v1.
 const suffix=entry.path;
 if(base.pathname.replace(/\/$/,'').endsWith(suffix))return root;
 const parts=suffix.split('/').filter(Boolean);
 for(let n=parts.length-1;n>0;n--){const prefix='/'+parts.slice(0,n).join('/');if(base.pathname.replace(/\/$/,'').endsWith(prefix))return root+'/'+parts.slice(n).join('/');}
 return root+suffix;
}
export function responseMatches(shape,body){
 if(!body||typeof body!=='object')return false;
 switch(shape){
 case 'models':return Array.isArray(body.data)&&body.data.every(x=>x&&typeof x.id==='string');
 case 'ollama':return Array.isArray(body.models)&&body.models.every(x=>x&&typeof x.name==='string');
 case 'comfy':return !!body.system&&Array.isArray(body.devices);
 case 'opencode':return body.healthy===true;
 case 'llama':return body.status==='ok';
 case 'anything':return body.authenticated===true;
 default:return false;
 }
}
const baseResult=(id,status,missing,userAction,detail={})=>({id,status,missing,userAction,chat_verified:false,task_verified:false,checked_at:new Date().toISOString(),...detail});
async function cliVersion(entry){
 let hits=[];
 try{const {stdout}=await run(process.platform==='win32'?'where.exe':'which',[entry.command],{timeout:3000,windowsHide:true,maxBuffer:128*1024});hits=stdout.trim().split(/\r?\n/).filter(Boolean);}catch{}
 if(entry.id==='codex'&&!hits.length&&process.platform==='win32'){
  const dir=path.join(process.env.LOCALAPPDATA||'', 'OpenAI','Codex','bin');
  try{for(const version of fs.readdirSync(dir)){const file=path.join(dir,version,'codex.exe');if(fs.existsSync(file))hits.push(file);}}catch{}
 }
 if(!hits.length)return baseResult(entry.id,'missing','未找到该 CLI 的可执行命令',entry.userAction);
 const file=hits[0];
 if(!path.isAbsolute(file)||/[&|<>^%!\r\n]/.test(file))return baseResult(entry.id,'unsupported','CLI 路径含不支持的字符，未执行', '使用官方标准安装路径，或等待补充路径适配');
 try{
  const isCmd=process.platform==='win32'&&/\.(cmd|bat)$/i.test(file);
  const command=isCmd?(process.env.ComSpec||'cmd.exe'):file;
  const args=isCmd?['/d','/s','/c',`""${file}" --version"`]:entry.args;
  const {stdout,stderr}=await run(command,args,{timeout:8000,windowsHide:true,cwd:os.tmpdir(),maxBuffer:128*1024});
  // Only return a version token; never reflect arbitrary CLI output or credentials.
  if(entry.id==='cursor'&&!/cursor/i.test(stdout+' '+stderr))return baseResult(entry.id,'unverified','agent 命令没有返回 Cursor 身份，不能确定属于 Cursor CLI',entry.userAction);
  const version=(stdout+' '+stderr).match(/\b\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/)?.[0];
  if(!version)return baseResult(entry.id,'unverified','命令退出但没有可识别版本，未确认为有效 CLI',entry.userAction);
  return baseResult(entry.id,'version_ok','登录与任务执行尚未验证','CLI 可启动；按官方步骤完成登录，再主动派发小任务验证。',{version});
 }catch{return baseResult(entry.id,'unverified','CLI 版本检查失败或超时',entry.userAction);}
}
export async function probeAccess(input,{fetchImpl=fetch,cliImpl=cliVersion}={}){
 const entry=byId.get(input?.id);
 if(!entry)throw Error('未知接入项');
 if(entry.method==='guide'||entry.method==='existing')return baseResult(entry.id,'unsupported',entry.verification,entry.userAction);
 if(entry.method==='cli')return cliImpl(entry);
 const url=probeUrl(entry,input.base_url);
 const key=typeof input.api_key==='string'?input.api_key.trim():'';
 if(key.length>4096||/[\r\n]/.test(key))throw Error('凭据格式无效');
 if(entry.auth==='required'&&!key)return baseResult(entry.id,'needs_credential','缺少该开放平台的 API Key',entry.userAction);
 const headers={Accept:'application/json'};
 if(key)headers.Authorization=`Bearer ${key}`;
 try{
  const response=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(5000)});
  if([401,403].includes(response.status))return baseResult(entry.id,'needs_credential','服务拒绝认证或当前 Key 无权访问此接口',entry.userAction,{http_status:response.status});
  if([404,405].includes(response.status))return baseResult(entry.id,'unsupported','当前服务或版本未提供预期的只读接口；不能据此判定账号无效','检查地址、软件版本与官方接口文档。不要因目录接口缺失重复购买服务。',{http_status:response.status});
  if(!response.ok)return baseResult(entry.id,'unverified','服务返回错误，尚未验证成功',entry.userAction,{http_status:response.status});
  if(!response.body)return baseResult(entry.id,'unverified','服务没有返回可验证的内容',entry.userAction);
  const reader=response.body.getReader();let length=0;const chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>2*1024*1024){await reader.cancel();return baseResult(entry.id,'unverified','服务响应过大，停止读取',entry.userAction);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return baseResult(entry.id,'unverified','地址有响应，但不是预期的 JSON 接口；可能是网页或错误服务',entry.userAction);}
  if(!responseMatches(entry.shape,body))return baseResult(entry.id,'unverified','JSON 格式与该软件官方接口不匹配，未判定成功',entry.userAction);
  const modelCount=entry.shape==='models'?body.data.length:entry.shape==='ollama'?body.models.length:undefined;
  return baseResult(entry.id,'interface_ok',modelCount===0?'模型目录为空，尚不能生成回复':'实际生成、工具和任务执行尚未验证',modelCount===0?'先在软件中下载/配置模型，再重新检查。':'接口只读验证通过；实际任务需用户另行发起，可能消耗额度。',{http_status:response.status,model_count:modelCount});
 }catch(error){
  const code=error?.cause?.code??error?.code;
  const reason=error?.name==='TimeoutError'||code==='ETIMEDOUT'?'连接超时：服务没有及时回应':code==='ECONNREFUSED'?'连接被拒绝：目标端口没有服务监听':code==='ENOTFOUND'?'本机地址解析失败':code==='DEPTH_ZERO_SELF_SIGNED_CERT'||code==='CERT_HAS_EXPIRED'?'HTTPS 证书无效或已过期':'连接失败或服务重定向';
  return baseResult(entry.id,'unreachable',reason+'，未验证成功',entry.userAction);
 }

}
