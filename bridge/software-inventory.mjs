import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Declarative identities: no arbitrary commands or credential-file reads.
export const signatures=[
 ['codex','Codex','codex'],['workbuddy','WorkBuddy','workbuddy|codebuddy'],['doubao','豆包','doubao|豆包'],
 ['claude','Claude','claude'],['cursor','Cursor','^cursor(?:$|[ ._-]|\\.exe$)'],['windsurf','Windsurf','windsurf|codeium'],
 ['trae','Trae','\\btrae\\b'],['ollama','Ollama','ollama'],['lmstudio','LM Studio','lm[ ._-]?studio'],
 ['cherry-studio','Cherry Studio','cherry[ ._-]?studio'],['chatgpt','ChatGPT','chatgpt'],
 ['jan','Jan','^jan(?:\\.exe)?$'],['gpt4all','GPT4All','gpt4all'],['anythingllm','AnythingLLM','anythingllm'],
 ['open-webui','Open WebUI','open[ ._-]?webui'],['comfyui','ComfyUI','comfyui'],['a1111','Stable Diffusion WebUI','automatic1111|stable.diffusion.webui'],
 ['invokeai','InvokeAI','invokeai'],['fooocus','Fooocus','fooocus'],['pinokio','Pinokio','pinokio'],
 ['opencode','OpenCode','opencode'],['aider','Aider','^aider(?:\\.exe|\\.cmd)?$'],['gemini','Gemini CLI','gemini'],
 ['qwen','Qwen Code','qwen'],['goose','Goose','^goose(?:\\.exe)?$'],['continue','Continue','continue\\.continue'],
 ['cline','Cline','saoudrizwan\\.claude-dev|^cline'],['roo-code','Roo Code','rooveterinaryinc\\.roo-cline'],
 ['copilot','GitHub Copilot','github[ ._-]?copilot'],['augment','Augment Code','augmentcode'],
 ['tabnine','Tabnine','tabnine'],['tongyi','通义灵码','tongyi|lingma|通义'],['kimi','Kimi','^kimi|月之暗面'],
 ['deepseek','DeepSeek','deepseek'],['dify','Dify','^dify'],['n8n','n8n','^n8n'],['openclaw','OpenClaw','openclaw'],
 ['msty','Msty','^msty'],['boltai','BoltAI','boltai'],['chatbox','Chatbox','chatbox'],['librechat','LibreChat','librechat']
].map(([id,name,pattern])=>({id,name,pattern}));
export function classify(name){return signatures.find(s=>new RegExp(s.pattern,'i').test(name));}
export function combine(items){
 const result=new Map();
 for(const item of items){
  const match= /[\\/]OpenAI\.Codex_[^\\/]+[\\/]/i.test(item.path||'') && /^chatgpt/i.test(item.name||'') ? signatures.find(s=>s.id==='codex') : classify(item.name||'');
  if(!match) continue;
  let row=result.get(match.id);
  if(!row){row={id:match.id,name:match.name,sources:[],paths:[],pids:[],versions:[]};result.set(match.id,row);}
  if(item.source&&!row.sources.includes(item.source))row.sources.push(item.source);
  if(item.path&&!row.paths.includes(item.path))row.paths.push(item.path);
  if(item.pid&&!row.pids.includes(item.pid))row.pids.push(item.pid);
  if(item.version&&!row.versions.includes(item.version))row.versions.push(item.version);
 }
 return [...result.values()];
}
let cached=null,inflight=null;
export async function inventory({refresh=false}={}){
 if(cached&&!refresh&&Date.now()-cached.at<30000)return cached.value;
 if(inflight)return inflight;
 inflight=collect().then(value=>{cached={at:Date.now(),value};return value;}).finally(()=>{inflight=null;});return inflight;
}
async function collect(){
 const items=[],warnings=[];
 if(process.platform==='win32'){
  const script=`$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $items=@();
  foreach($key in @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) { Get-ItemProperty $key | ForEach-Object { if($_.DisplayName) { $items+=@{name=$_.DisplayName;path=$_.InstallLocation;version=$_.DisplayVersion;source='uninstall_registry'} } } }
  Get-AppxPackage | ForEach-Object { $items+=@{name=$_.Name;path=$_.InstallLocation;source='appx'} }
  Get-CimInstance Win32_Process | ForEach-Object { $items+=@{name=$_.Name;path=$_.ExecutablePath;pid=$_.ProcessId;source='process'} }
  ConvertTo-Json -InputObject @($items) -Depth 4 -Compress`;
  try{const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:25000,maxBuffer:8*1024*1024,encoding:'utf8'});items.push(...JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch(e){warnings.push('Windows 安装/进程清单读取失败或超时：'+(e.code||'unknown'));}
 }
 const home=os.homedir();
 const dirs=[process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Programs'),process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'OpenAI'),process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.APPDATA&&path.join(process.env.APPDATA,'npm'),path.join(home,'.local','bin'),path.join(home,'.vscode','extensions'),path.join(home,'.cursor','extensions'),path.join(home,'.windsurf','extensions'),...(process.env.PATH||'').split(path.delimiter)].filter(Boolean);
 for(const dir of new Set(dirs))try{for(const file of fs.readdirSync(dir)){items.push({name:file,path:path.join(dir,file),source:dir.endsWith('extensions')?'ide_extension':'install_dir_or_path'});}}catch{}
 // Inspect only names in known per-user configuration directories; never file contents.
 for(const [dir,name] of [['.codex','Codex'],['.claude','Claude'],['.ollama','Ollama'],['.aider','aider'],['.gemini','Gemini'],['.continue','continue.continue'],['.openclaw','OpenClaw']])if(fs.existsSync(path.join(home,dir)))items.push({name,path:path.join(home,dir),source:'config_trace'});
 return {scanned_at:new Date().toISOString(),software:combine(items),warnings,scope:['Windows 安装注册表','当前用户商店应用','运行进程','PATH 与常见安装目录','IDE 扩展目录','已知配置目录名'],catalog_size:signatures.length};
}
export function asInterfaces(report){return report.software.map(item=>({id:'inventory-'+item.id,kind:item.id,display_name:item.name,transport:'desktop_bridge',found:true,source:item.sources,exe_path:item.paths.find(p=>/\.exe$/i.test(p))||item.paths[0]||null,cli_path:null,endpoint:null,port:null,pid:item.pids[0]||null,listening:false,auth_status:'unverified',auth_ref:null,auth_needed:false,layers:{found:true,listening:false,authenticated:false,chat_ok:false},notes:[item.sources.every(s=>s==='config_trace')?'仅发现配置痕迹，软件可能已经卸载。':'已发现本机软件痕迹；尚未验证登录、接口或任务执行。',...item.sources.map(s=>'来源：'+s)],inventory:item}));}
