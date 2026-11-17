import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
const require=createRequire(import.meta.url);

// No session/prompt/authenticate is issued by this diagnostic client.
export function initializeAcp(command,args,{timeoutMs=10000,maxBytes=1024*1024,env=process.env}={}){
 return new Promise(resolve=>{
  let child,buffer='',bytes=0,settled=false,timer;
  const finish=(status,detail={})=>{if(settled)return;settled=true;clearTimeout(timer);child?.stdin.end();
   // Let the adapter close its owned App Server on stdin EOF before forcing exit.
   if(child?.pid){const cleanup=setTimeout(()=>child.kill(),1000);cleanup.unref();child.once('exit',()=>clearTimeout(cleanup));}
   resolve({status,...detail,chat_verified:false,task_verified:false});};
  try{child=spawn(command,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,env});}catch{return finish('launch_failed');}
  timer=setTimeout(()=>finish('timeout'),timeoutMs);
  child.on('error',()=>finish('launch_failed'));child.stdin.on('error',()=>finish('launch_failed'));
  child.on('exit',()=>finish('exited'));
  child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)finish('invalid_response');});
  child.stdout.on('data',chunk=>{
   bytes+=chunk.length;if(bytes>maxBytes)return finish('invalid_response');buffer+=chunk.toString();
   let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
    let msg;try{msg=JSON.parse(line);}catch{return finish('invalid_response');}
    if(msg.jsonrpc!=='2.0')return finish('invalid_response');
    if(msg.method&&msg.id!==undefined){child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Diagnostic client does not grant capabilities'}})+'\n');continue;}
    if(msg.id!==1)continue;
    if(msg.error)return finish('protocol_error');
    const r=msg.result;if(r?.protocolVersion!==1||!r.agentCapabilities||typeof r.agentCapabilities!=='object'||Array.isArray(r.agentCapabilities))return finish('invalid_response');
    // Return only bounded structured facts, never arbitrary output, paths or tokens.
    return finish('protocol_ok',{protocol_version:1,load_session:r.agentCapabilities.loadSession===true,auth_method_count:Array.isArray(r.authMethods)?r.authMethods.length:0});
   }
  });
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'operator-board-diagnostic',version:'1.0.0'}}})+'\n');
 });
}

export async function probeAcp(input){
 if(input?.id!=='codex')throw Error('当前仅启用已核对的 Codex ACP 适配器');
 let entry;
 try{const pkg=require.resolve('@agentclientprotocol/codex-acp/package.json');const meta=JSON.parse(fs.readFileSync(pkg,'utf8'));const bin=typeof meta.bin==='string'?meta.bin:Object.values(meta.bin)[0];entry=path.resolve(path.dirname(pkg),bin);}catch{
  // Packages with exports may hide package.json; the pinned local package has a known entry.
  entry=fileURLToPath(new URL('../node_modules/@agentclientprotocol/codex-acp/dist/index.js',import.meta.url));
 }
 if(!fs.existsSync(entry))return {id:'codex',status:'missing',missing:'项目中的 ACP 适配器未安装完整',userAction:'修复项目依赖安装；不需要提供账号密码',chat_verified:false,task_verified:false};
 const env={...process.env};
 if(!env.CODEX_PATH&&process.platform==='win32'){
  const root=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'OpenAI','Codex','bin');
  try{const files=fs.readdirSync(root).map(v=>path.join(root,v,'codex.exe')).filter(f=>fs.existsSync(f)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);if(files[0])env.CODEX_PATH=files[0];}catch{}
 }
 const result=await initializeAcp(process.execPath,[entry],{timeoutMs:12000,env});
 return {id:'codex',...result,checked_at:new Date().toISOString(),missing:result.status==='protocol_ok'?'协议握手成功；认证状态、模型生成和任务执行尚未验证':'ACP 适配器未能完成协议握手（'+result.status+'）',userAction:result.status==='protocol_ok'?'协议连接可用；后续真实任务仍须满足原有登录、权限和网络条件。':'检查适配器安装与 Codex 运行环境；无需反复填写 API Key。'};
}
