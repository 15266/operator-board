import type {ExternalChannel,ChannelLayerKind,ChannelLayerStatus} from './types';
const kinds:ChannelLayerKind[]=['chat_bridge','tool_inventory','tool_verify','quota'];
const statuses:ChannelLayerStatus[]=['ok','partial','fail','unverified','na'];
const text=(value:unknown,fallback='')=>typeof value==='string'?value:fallback;
const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.floor(value)):0;
export function normalizeRegisteredChannel(raw:unknown):ExternalChannel|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const r=raw as Record<string,unknown>;
 if(typeof r.id!=='string'||!r.id.trim()||typeof r.title!=='string'||!r.title.trim()||typeof r.kind!=='string'||!r.kind.trim())return null;
 const layers=Array.isArray(r.layers)?r.layers.filter(x=>x&&typeof x==='object'):[];
 const tools=Array.isArray(r.tools)?r.tools.filter(x=>x&&typeof x==='object'&&typeof x.id==='string'&&typeof x.name==='string').map(x=>({id:x.id,name:x.name,api_name:text(x.api_name)||undefined,claimed:x.claimed===true,verified:x.verified===true,note:text(x.note)})):[];
 const claimed=count(r.inventory_claimed);
 const shot=r.screenshot_verify as Record<string,unknown>|null;
 const screenshot_verify=shot&&['ok','fail','skipped'].includes(String(shot.status))?{status:shot.status as 'ok'|'fail'|'skipped',label:text(shot.label),detail:text(shot.detail)}:null;
 return {id:r.id,title:r.title,title_en:text(r.title_en,'REGISTERED CHANNEL'),kind:r.kind,endpoint:typeof r.endpoint==='string'?r.endpoint:null,optional:r.optional===true,source:'registered',product:text(r.product)||undefined,
  layers:kinds.map(kind=>{const entry=layers.find(x=>x.kind===kind);return {kind,status:statuses.includes(entry?.status)?entry.status:'unverified',summary:text(entry?.summary,'尚未验证')};}),
  tools,inventory_claimed:claimed,inventory_verified:Math.min(count(r.inventory_verified),claimed),notes:text(r.notes),last_probe_at:typeof r.last_probe_at==='string'?r.last_probe_at:null,
  screenshot_verify, test_session:text(r.test_session)||null,test_reply:text(r.test_reply)||null};
}
