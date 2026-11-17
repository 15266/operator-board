import accessCatalog from "./accessCatalog.json";
export function interfaceGuidance(iface: {kind?: string | null; found?: boolean | null; listening?: boolean | null; auth_needed?: boolean; auth_ref?: string | null}) {
 const kind=iface.kind ?? '';
 if(kind==='workbuddy'&&!iface.auth_needed&&!iface.listening)return {missing:'仅发现桌面客户端，未识别公开 Gateway；桌面投递与回复回读尚未验证',user:'无需重复登录、查找 Token 或更改设备连接设置。只有决定使用独立 CodeBuddy Code HTTP Gateway 时，才按官方说明配置其服务密码。',development:'项目需分别适配桌面投递、公开 Gateway 和回复回读，不能把内部端口当成认证接口'};
 if (kind === 'proxy') return {missing:'不适用：网络代理不是 AI 执行器',user:'无需为代理配置 AI 接口',development:'无需 AI 适配器'};
 const profile=accessCatalog.entries.find(entry=>entry.id===kind);
 if(profile && ['cli','http'].includes(profile.method) && !['codex','ollama'].includes(kind)) return {
  missing:'尚未验证该软件的接口或命令行入口；发现桌面软件不代表对应 CLI / API 服务已开启',
  user:profile.userAction+' 在下方「接入方式与验证」选择该软件执行检查。',
  development:'已接入只读/版本检查；实际任务与工具能力需要专门适配，尚未自动开放派发',
 };
 if(profile && profile.method==='guide') return {missing:profile.verification,user:profile.userAction,development:'当前仅提供官方接入说明；专用协议验证属于项目开发工作'};
 if (!['workbuddy','codex','doubao','ollama'].includes(kind)) return {
  missing:'项目尚未实现此软件的专用接口适配器；未核实它是否开放可调用接口',
  user:'目前无需填写密钥或反复重装。若软件提供 API/CLI/MCP 服务，请在添加通道时登记官方接入地址；不要填写桌面登录密码',
  development:'需要补充官方协议适配和接口验证；这属于项目开发工作',
 };
 if (!iface.found) return {missing:'本轮未发现安装或服务证据',user:'若已安装，请启动软件或开启其官方本地服务，再刷新发现；不要仅为扫描结果重复安装',development:'特殊安装位置可能需要补充定位规则'};
 if (iface.auth_needed) return {missing:`服务要求凭据${iface.auth_ref ? '（'+iface.auth_ref+'）' : ''}`,user:'按该服务官方说明生成凭据，在本机凭据输入框保存，再重新验证；不要提供账号密码',development:'凭据齐备后仍需实际验证登录与调用'};
 if (kind==='codex') return {missing:'CLI 已发现；登录与实际任务调用尚未验证',user:'在本机 Codex 完成登录；需要时主动派发一个小任务验证，可能消耗额度',development:'版本检查不能代替实际任务测试'};
 if (kind==='doubao' && !iface.listening) return {missing:'未发现当前适配器需要的桌面 CDP 调试接口',user:'普通桌面登录不等于接口已开启；无需填写 API Key 来解决 CDP 缺失',development:'需要核实当前豆包版本是否提供受支持接入方式；不自动开启远程调试'};
 if (!iface.listening) return {missing:'尚未发现可访问的服务端口',user:kind==='ollama'?'启动 Ollama 本地服务；需要生成回复时先下载模型，再刷新探测':'启动软件并按其官方说明开启服务，再刷新探测',development:'自定义端口需要补充接口地址配置'};
 return {missing:'服务可访问；对话、工具与任务执行仍未验证',user:'先完成软件登录；确认模型可用后主动测试一个小任务，可能消耗额度',development:'分别验证对话与工具能力，不能用端口成功代替'};
}
