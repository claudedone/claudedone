import {getDateLocale} from './i18n';
export type BrowserId = 'chrome' | 'edge' | 'firefox';
export type CheckId = 'connection' | 'route' | 'webrtc' | 'dns' | 'language' | 'timezone' | 'offset' | 'clock' | 'locale' | 'cli' | 'fonts' | 'emoji' | 'webgl' | 'screen' | 'networkInfo' | 'plugins' | 'tracking';
export type TimezoneTarget = 'singapore' | 'utc' | 'custom';
export interface TimezoneOption { id: string; label: string; offsetMinutes: number }
export function timezoneOffsetLabel(offsetMinutes: number): string {
  const east = -offsetMinutes;
  const minutes = Math.abs(east) % 60;
  return `UTC${east >= 0 ? '+' : '-'}${Math.floor(Math.abs(east) / 60)}${minutes ? ':' + String(minutes).padStart(2, '0') : ''}`;
}
export const timezoneChoices: Record<TimezoneTarget, { label: string; consequence: string }> = {
  singapore: { label: '新加坡 · UTC+8', consequence: '相对北京时间，钟面数值不变。可改变 Asia/Shanghai 标识，但网站仍可能给 UTC+8 偏移计分。' },
  utc: { label: '协调世界时 · UTC+0', consequence: '相对北京时间，系统显示时间提前 8 小时。所有应用的本地时间显示会受到影响；不会改变真实时间戳。' },
  custom: { label: '自定义时区', consequence: '选择系统支持的时区。系统显示时间及所有应用的本地时间会随之变化；不会改变真实时间戳。' },
};
export const checkCount = 17;
export type CheckStatus = 'healthy' | 'configured' | 'warning' | 'manual' | 'unknown';
export interface Check { id: CheckId; status: CheckStatus; value: string; detail: string; fixable: boolean }
export interface Scan {
  platform: string; browser: BrowserId; browserAvailable: boolean; profilePath: string;
  checkedAt: string; checks: Check[]; ip: string | null; location: string | null;
  latency: number | null; cliInstalled: boolean;
}
export interface Change { target: string; pointer: string; before: unknown; after: unknown }
export interface RepairRecord {
  id: string; profileId?: string; itemId: CheckId; browser: BrowserId; createdAt: string;
  status: 'pending' | 'applied' | 'failed' | 'undone'; message: string; changes: Change[];
}
export interface Outcome { id: CheckId; success: boolean; message: string }
export const labels: Record<CheckStatus, string> = {
  healthy: '检测正常', configured: '已配置 · 待复检', warning: '建议调整', manual: '需手动确认', unknown: '尚未确认',
};
export const definitions: Record<CheckId, { title: string; description: string; group: 'network' | 'privacy' | 'device'; target?: string; advice: string[] }> = {
  clock: {title:'系统时钟',description:'单独检查实际时间，不用时区判断准确性',group:'device',advice:['打开系统日期与时间，启用自动设置时间并立即同步，再重新检测。','修改时区只影响本地时间显示，不会校准电脑时钟；不要根据代理地区手动增减电脑时间。','此检测使用 HTTPS 服务端时间，容许网络延迟和 2 分钟偏差。检测失败表示尚未确认，不代表时钟正常。','若时间同步后网页仍提示 Incorrect device time，请改用自定义浏览器语言、关闭严格指纹保护后重启副本，再分别检查代理连接和浏览器验证结果。']},
  webgl: {title:'WebGL 渲染器',description:'读取浏览器暴露的图形设备特征',group:'device',advice:['ANGLE、Direct3D11、NVIDIA 是 Windows 图形栈的常见组合，不代表国家或账号异常。','本地复检使用 WebGL 扩展读取渲染器；不支持或禁止时明确记录为不可用。','保留硬件加速，不替换渲染器字符串。']},
  screen: {title:'屏幕与缩放',description:'确认网页可见尺寸和像素比例',group:'device',advice:['2560×1440 和 1.5 倍像素比例是常见显示配置。网页像素比例还可能受到浏览器缩放影响。','不修改分辨率或缩放来消除第三方网站的设备特征计分。']},
  networkInfo: {title:'浏览器网络估计',description:'区分网络质量估计与真实网络出口',group:'network',advice:['effectiveType=4g 是浏览器根据连接性能划分的等级，并不表示使用了 4G 蜂窝网络。','downlink 是浏览器估计值，不是测速或出口国家证据。部分浏览器不提供此 API。','实际 Claude 出口仍需要专用浏览器网络实测。']},
  plugins: {title:'插件与逻辑处理器',description:'读取网页可见的插件和并发信息',group:'device',advice:['navigator.plugins 的现代条目常为内置 PDF 查看器，不等于安装了五个浏览器扩展。','hardwareConcurrency 是网页可用逻辑处理器提示，不等于物理核心数。','不删除插件、禁用 PDF 或伪造核心数。']},
  tracking: {title:'隐私偏好 DNT / GPC',description:'检查不跟踪与不出售数据的信号',group:'privacy',target:'Chrome / Edge 使用 DNT · Firefox 使用 GPC',advice:['修复仅写入 Chromium 的 enable_do_not_track=true，表达不希望被跟踪的偏好。','DNT 不是拦截器，网站可能不遵守；它不会关闭 Claude Code 遥测。','GPC 是独立的“不出售或分享数据”信号。浏览器不支持时显示“不支持”，工具不伪造该属性。']},
  connection: { title: 'Claude 连通性', description: '确认能否连接 Claude 服务', group: 'network', advice: ['在专用浏览器中打开 Claude，查看实际访问结果。', 'HTTP 403 或 429 可能来自网站防护或限流，不能据此判断账户状态。', '本机检测不读取浏览器代理，请同时检查你的 VPN 或代理客户端。'] },
  route: { title: '网络出口', description: '了解当前网络的出口位置', group: 'network', advice: ['打开 NodeCloak 官网，进入环境检测页复检浏览器信号。', '在你使用的网络客户端中检查路由、DNS 和 TUN 设置。', '本工具不能更换公共 IP，也不提供网络节点。'] },
  webrtc: { title: 'WebRTC 隐私', description: '减少实时通信暴露额外 IP 的机会', group: 'privacy', target: '限制非代理 UDP 连接', advice: ['修复会限制专用浏览器的非代理 UDP 通信，可能影响视频或语音通话。', '关闭专用浏览器再应用修复，之后在官网检测页按需启用 WebRTC 检测。', '日常浏览器的 WebRTC 设置不受影响。'] },
  dns: { title: 'DNS 隐私', description: '为域名查询启用加密连接', group: 'privacy', target: 'Cloudflare · 严格加密 DNS', advice: ['设置专用浏览器使用 https://cloudflare-dns.com/dns-query。', '严格模式下，DNS 服务不可达时网站可能打不开；可从记录中撤销。', '企业策略、浏览器更新或代理可能影响设置，应用后需网页复检。'] },
  language: { title: '浏览器语言', description: '让专用环境使用一致的语言偏好', group: 'device', target: 'English (United States)', advice: ['将专用浏览器首选网页语言设置为 en-US,en。', '这是网页语言偏好；macOS 浏览器界面语言仍可能跟随系统。', '仅在 NodeCloak 打开的专用浏览器内生效。'] },
  timezone: { title: '系统时区', description: '检查时区标识，与 UTC 偏移分别确认', group: 'device', target: '新加坡、UTC 或自定义系统时区', advice: ['旧版一键修复默认不修改系统时区，因此网页仍可能读取到 Asia/Shanghai。', '新加坡 UTC+8 可改变时区标识，但网站仍可能给 UTC+8 偏移计分。UTC+0 则会将相对北京时间的系统显示时间提前 8 小时。', '这会影响所有应用；自动时区设置可能覆盖修改。macOS 会请求管理员授权。关闭专用浏览器后重新打开复检。', 'Claude Code 启动器的进程时区与浏览器、系统时区分别设置。时区不是账户风险的确定证据。'] },
  offset: { title: 'UTC 时区偏移', description: '检查本地显示时间与 UTC 的差值', group: 'device', advice: ['截图中的 UTC+8 和 Asia/Shanghai 是两个独立信号。切换到新加坡后仍然是 UTC+8。', '可通过系统时区面板选择 UTC+0，同时调整时区标识和偏移；这会影响所有应用的本地时间显示。', '请选择适合实际使用需要的时区，时区偏移不是账户风险的确定证据。'] },
  locale: { title: 'Intl 区域设置', description: '验证网页日期和数字格式化的 locale', group: 'device', advice: ['浏览器语言偏好与 Intl.DateTimeFormat().resolvedOptions().locale 并非同一个检测值。', '请打开本地复检页读取实际结果，再复制报告导入工具。配置文件无法证明这个值已生效。', '如果实测仍是中文 locale，请检查专用浏览器语言并重启浏览器。工具不会替换网页 Intl API 返回值。'] },
  cli: { title: 'Claude Code 环境', description: '为命令行准备独立的启动设置', group: 'device', target: '英文 locale + 进程时区 UTC+8', advice: ['先安装官方 Claude Code，再生成专用启动器。', '由本工具启动时设置 TZ=Asia/Singapore、LANG=en_US.UTF-8、LC_ALL=en_US.UTF-8。', '只对启动器创建的进程生效，保留原有代理、认证和 API 配置。', 'Windows 若限制 PowerShell 脚本执行，请检查组织策略；本工具不会绕过它。'] },
  fonts: { title: '中文字体可见性', description: '按需限制专用环境的字体可见性', target: '仅限专用 Firefox · 保留电脑字体', group: 'device', advice: ['Firefox 可限制专用环境可用的系统字体，保留电脑字体。常见拉丁字体与 Emoji 保留；部分中文显示可能变化，网页下载字体仍可使用。应用后完全退出并重新打开专用 Firefox，可从记录恢复。', 'Chrome / Edge 可点击“管理字体”，查看当前用户目录内识别到的中文字体。逐项选择并确认后，工具备份文件与注册信息，再卸载；可从修复记录恢复。', '此操作影响当前用户的所有应用，可能改变文档和网页的中文显示。字体缓存可能需要注销或重启，工具不会自动重启电脑。', 'Windows 系统字体与字体组件、macOS 系统字体、所有用户安装字体不自动移除。微软雅黑、宋体等系统字体可能继续被检测到；普通 Chrome / Edge 配置不能隐藏它们。', 'Canvas 宽度探测可能误判。字体卸载成功不等于网页检测全部通过；处理后请完全退出浏览器，再打开本地复检。'] },
  emoji: { title: 'Emoji / 系统风格', description: '区分 UA 推断与真实 Emoji 渲染', group: 'device', advice: ['截图中的 Microsoft style 明确注明由 UA 推断操作系统，并不是已经完成 Emoji 像素测试。', 'Windows 用户出现 Microsoft style 是正常平台特征，单凭这一项不能确定使用者所在国家或账户风险。', '本地复检页显示 UA 推断的平台，不替换 UA，也不将它声称为真实 Emoji 渲染结果。此项可能继续被网站计分。'] },
};
export function recommendedChecks(checks: Check[]): Check[] {
  return checks.filter(c => c.fixable && c.status === 'warning' && !['timezone', 'offset', 'fonts'].includes(c.id));
}
export function defaultTimezoneTarget(ids: CheckId[]): TimezoneTarget {
  return ids.includes('offset') ? 'utc' : 'singapore';
}
export function repairIds(ids: CheckId[]): CheckId[] {
  return [...new Set(ids.map(id => id === 'offset' ? 'timezone' as const : id))];
}
export function timeLabel(value: string) {
  return new Intl.DateTimeFormat(getDateLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
