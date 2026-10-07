import type { BrowserId, Check, Scan } from './domain';

export interface BrowserReport {
  schemaVersion: 1 | 2; capturedAt: string; timezone: string; offsetMinutes: number;
  languages: string[]; locale: string; fonts: string[]; platform: 'Windows' | 'macOS' | 'Linux' | 'Other';
  browser?: BrowserId;
  profileId?:string;
  exit?:{ip:string;country:string|null};
  webgl?: string | null;
  screen?: {width:number;height:number;pixelRatio:number};
  network?: {supported:boolean;effectiveType:string|null;downlink:number|null;rtt:number|null;saveData:boolean|null};
  plugins?: {count:number;hardwareConcurrency:number|null;pdfViewerEnabled:boolean|null};
  privacy?: {dnt:string|null;gpc:boolean|null};
}
function object(x: unknown): Record<string, unknown> { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('报告对象格式无效'); return x as Record<string, unknown>; }
function bounded(x: unknown, min:number, max:number, integer=false): x is number { return typeof x === 'number' && Number.isFinite(x) && x>=min && x<=max && (!integer || Number.isInteger(x)); }
const optionalNumber = (x:unknown, max:number, integer=false): x is number|null => x===null || bounded(x,0,max,integer);
const optionalBoolean = (x:unknown): x is boolean|null => x===null || typeof x==='boolean';
const optionalText = (x:unknown,max:number): x is string|null => x===null || (typeof x==='string' && x.length<=max);
function extraFields(v: Record<string,unknown>): Partial<BrowserReport> {
  if(v.schemaVersion!==2) return {};
  if(v.browser!==null && !['chrome','edge','firefox'].includes(v.browser as string)) throw new Error('报告浏览器标识无效');
  const s=object(v.screen), n=object(v.network), p=object(v.plugins), privacy=object(v.privacy);
  if(!optionalText(v.webgl,1024) || !bounded(s.width,0,100000,true) || !bounded(s.height,0,100000,true) || !bounded(s.pixelRatio,0.01,100) || typeof n.supported!=='boolean' || !optionalText(n.effectiveType,50) || !optionalNumber(n.downlink,1000000) || !optionalNumber(n.rtt,1000000) || !optionalBoolean(n.saveData) || !bounded(p.count,0,1000,true) || !optionalNumber(p.hardwareConcurrency,100000,true) || !optionalBoolean(p.pdfViewerEnabled) || !optionalText(privacy.dnt,32) || !optionalBoolean(privacy.gpc)) throw new Error('新增网页信号缺失或超出合理范围');
  if(v.profileId!==undefined && (typeof v.profileId!=='string'||!/^(?:[a-f0-9]{32}|legacy-(?:chrome|edge|firefox))$/.test(v.profileId)))throw new Error('报告副本标识无效');
  let exit:BrowserReport['exit'];if(v.exit!==undefined){const e=object(v.exit);if(typeof e.ip!=='string'||!/^[a-f0-9:.]{3,64}$/i.test(e.ip)||!(e.country===null||typeof e.country==='string'&&/^[A-Z]{2}$/.test(e.country)))throw new Error('报告出口信息格式无效');exit={ip:e.ip,country:e.country as string|null};}
  return {exit,profileId:v.profileId as string|undefined,browser:v.browser===null?undefined:v.browser as BrowserId,webgl:v.webgl,screen:{width:s.width,height:s.height,pixelRatio:s.pixelRatio},network:{supported:n.supported,effectiveType:n.effectiveType,downlink:n.downlink,rtt:n.rtt,saveData:n.saveData},plugins:{count:p.count,hardwareConcurrency:p.hardwareConcurrency,pdfViewerEnabled:p.pdfViewerEnabled},privacy:{dnt:privacy.dnt,gpc:privacy.gpc}};
}
export function parseBrowserReport(text: string): BrowserReport {
  if (text.length > 16384) throw new Error('报告超出大小限制');
  let r: unknown;
  try { r = JSON.parse(text); } catch { throw new Error('请粘贴本地复检页生成的完整 JSON 报告'); }
  if (!r || typeof r !== 'object') throw new Error('报告格式无效');
  const v = r as Record<string, unknown>;
  const texts = (x: unknown, max: number): x is string[] => Array.isArray(x) && x.length <= max && x.every(s => typeof s === 'string' && s.length > 0 && s.length <= 100);
  if (![1,2].includes(v.schemaVersion as number) || typeof v.capturedAt !== 'string' || !Number.isFinite(Date.parse(v.capturedAt)) || typeof v.timezone !== 'string' || v.timezone.length > 100 || !Number.isInteger(v.offsetMinutes) || Math.abs(v.offsetMinutes as number) > 840 || !texts(v.languages, 32) || !v.languages.length || typeof v.locale !== 'string' || v.locale.length > 100 || !texts(v.fonts, 64) || !['Windows', 'macOS', 'Linux', 'Other'].includes(v.platform as string)) throw new Error('报告字段缺失或格式无效，请重新复制');
  try { new Intl.DateTimeFormat('en', { timeZone: v.timezone }).format(); new Intl.Locale(v.locale); v.languages.forEach(s => new Intl.Locale(s)); } catch { throw new Error('报告包含无效的时区或语言标识'); }
  if (Date.parse(v.capturedAt) > Date.now() + 300000) throw new Error('报告时间在未来，请检查系统时间后重新检测');
  return { ...extraFields(v), schemaVersion: v.schemaVersion as 1|2, capturedAt: v.capturedAt, timezone: v.timezone, offsetMinutes: v.offsetMinutes as number, languages: v.languages, locale: v.locale, fonts: v.fonts, platform: v.platform as BrowserReport['platform'] };
}
export function offsetLabel(minutes: number) {
  const east = -minutes;
  const hours = Math.floor(Math.abs(east) / 60);
  const remainder = Math.abs(east) % 60;
  return `UTC${east >= 0 ? '+' : '-'}${hours}${remainder ? `:${String(remainder).padStart(2, '0')}` : ''}`;
}
export function withBrowserReport(scan: Scan | null, report: BrowserReport | null): Scan | null {
  if (!scan || !report || (report.browser && report.browser!==scan.browser)) return scan;
  const actual = (id: Check['id'], status: Check['status'], value: string, detail: string): Check => ({ id, status, value, detail: `本地复检页报告（用户导入）：${detail}`, fixable: ['timezone', 'offset'].includes(id) || ((['language','tracking'].includes(id) || (id === 'fonts' && scan.browser === 'firefox')) && scan.browserAvailable && scan.checks.find(c => c.id === id)?.fixable !== false) });
  const overrides: Partial<Record<Check['id'], Check>> = {
    timezone: actual('timezone', ['Asia/Shanghai', 'Asia/Urumqi'].includes(report.timezone) ? 'warning' : 'healthy', report.timezone, '这是报告采集时网页读取的时区。配置或系统发生变化后需重新采集。'),
    offset: actual('offset', report.offsetMinutes === -480 ? 'warning' : 'healthy', offsetLabel(report.offsetMinutes), '网页 Date.getTimezoneOffset() 的采集结果；UTC+8 会被截图中的网站单独计分。'),
    language: actual('language', report.languages.some(s => /^zh(?:-|$)/i.test(s)) ? 'warning' : 'healthy', report.languages.join(', '), '实际 navigator.languages 列表。'),
    locale: actual('locale', /^zh(?:-|$)/i.test(report.locale) ? 'manual' : 'healthy', report.locale, '实际 Intl.DateTimeFormat().resolvedOptions().locale。'),
    fonts: actual('fonts', 'manual', report.fonts.length ? report.fonts.join(', ') : '候选字体宽度探测未命中', 'Canvas 宽度差异探测存在误判可能；未命中也不能证明系统没有中文字体。'),
    emoji: actual('emoji', 'manual', `${report.platform === 'Windows' ? 'Microsoft' : report.platform === 'macOS' ? 'Apple' : report.platform} style · UA 推断`, '这里只识别 UA 平台，不是真实 Emoji 像素测试，也不能断定第三方网站使用同一算法。'),
  };
  if(report.schemaVersion===2) {
    const s=report.screen!, n=report.network!, p=report.plugins!, privacy=report.privacy!;
    overrides.webgl=actual('webgl',report.webgl?'healthy':'manual',report.webgl || '扩展不可用或被浏览器限制','图形设备信息，仅作观察；不根据型号判断国家或账号风险。');
    overrides.screen=actual('screen','healthy',`${s.width}×${s.height} @${s.pixelRatio}x`,'网页 screen 尺寸和 devicePixelRatio；像素比例受缩放影响。');
    overrides.networkInfo=actual('networkInfo',n.supported?'healthy':'manual',n.supported?`${n.effectiveType || '未知等级'} / ${n.downlink===null?'未提供速率':n.downlink+' Mbps（估计）'}`:'浏览器不支持 Network Information','4g 是性能等级，不等于蜂窝网络。此值不是网络出口检测或测速。');
    overrides.plugins=actual('plugins','healthy',`${p.count} 个网页插件 · ${p.hardwareConcurrency===null?'并发信息不可用':p.hardwareConcurrency+' 个逻辑处理器提示'}`,'网页插件通常是内置 PDF 兼容条目，不等于浏览器扩展清单或物理核心数。');
    const dntOn=['1','yes'].includes(privacy.dnt || '');
    overrides.tracking=actual('tracking',(scan.browser === 'firefox' ? privacy.gpc === true : dntOn)?'healthy':'warning',`DNT: ${dntOn?'开启':privacy.dnt===null?'未提供':'未开启'} · GPC: ${privacy.gpc===null?'不支持 / 未提供':privacy.gpc?'开启':'未开启'}`,'DNT 仅表达偏好，不保证网站遵守。GPC 不可用与关闭不同；这里不测试 HTTP 请求头或 CLI 遥测。');
  }
  if(report.exit){overrides.route=actual('route','manual',`${report.exit.ip} · ${report.exit.country||'地区未知'}`,'此浏览器访问官网 Cloudflare 出口接口的实际值，不代表所有目的地址的出口相同。');}
  return { ...scan, ...(report.exit?{ip:report.exit.ip,location:report.exit.country}:{}), checks: scan.checks.map(c => overrides[c.id] || c) };
}


