import {Globe2,ShieldCheck,SlidersHorizontal} from 'lucide-react';
import {needsRegionalControl,type IpRegion,type AdvancedSettings,type ProfileDraft} from './browser-profiles';
import ProfileRegion from './ProfileRegion';

export function ProfileAdvanced({draft,onChange,match,matching,onMatch}:{draft:ProfileDraft;onChange:(draft:ProfileDraft)=>void;match:IpRegion|null;matching:boolean;onMatch:()=>void}) {
  const prefs=draft.preferences,advanced=prefs.advanced,firefox=draft.browser==='firefox';
  const set=(patch:Partial<AdvancedSettings>)=>onChange({...draft,preferences:{...prefs,advanced:{...advanced,...patch}}});
  return <div className="advanced-sections">
    <ProfileRegion draft={draft} onChange={onChange} match={match} matching={matching} onMatch={onMatch}/>
    <section className="advanced-card"><h3><Globe2 size={17}/>启动页面</h3><div className="profile-form region-single"><label>启动页面<input value={prefs.startupUrl} onChange={e=>onChange({...draft,preferences:{...prefs,startupUrl:e.target.value}})} placeholder="https://claude.ai"/><small className="profile-field-hint">支持完整网址或 about:blank。</small></label></div></section>
    <section className="advanced-card"><h3><ShieldCheck size={17}/>隐私与指纹</h3><p>优先使用浏览器自身提供的保护能力。</p>
      <label className="advanced-toggle"><span><strong>隐私偏好与 WebRTC 保护</strong><small>{firefox?'开启 GPC，并禁用此副本的 WebRTC。':'开启 DNT，并限制未经过代理的 WebRTC UDP 请求。'} 使用独立代理时仍保留 WebRTC 保护。</small></span><input type="checkbox" checked={prefs.privacy} onChange={e=>onChange({...draft,preferences:{...prefs,privacy:e.target.checked}})}/></label>
      <label className="advanced-toggle"><span><strong>限制字体可见性 <em>Firefox</em></strong><small>保留电脑的中文字体，仅限制网页可读取的字体；部分中文显示可能变化。</small></span><input type="checkbox" disabled={!firefox} checked={prefs.fontRestriction} onChange={e=>onChange({...draft,preferences:{...prefs,fontRestriction:e.target.checked}})}/></label>
      <label className="advanced-toggle"><span><strong>严格指纹保护 <em>Firefox</em></strong><small>使用 Firefox 原生统一保护，覆盖时区、Canvas、屏幕及部分硬件信号。与独立区域设置互斥；使用 IP 匹配或自定义区域时关闭。</small></span><input type="checkbox" disabled={!firefox||needsRegionalControl(prefs)} checked={advanced.resistFingerprinting} onChange={e=>set({resistFingerprinting:e.target.checked})}/></label>
      {advanced.resistFingerprinting&&<div className="advanced-caution" role="status">网页时区会统一为 UTC。网页语言和硬件信息可能与填写值不同，图像读取、视频会议或部分网站可能受影响；遇到问题可关闭后重启副本。</div>}
      <label className="advanced-toggle"><span><strong>禁用 WebGL <em>Firefox</em></strong><small>减少网页读取图形硬件信息；3D 内容和依赖 WebGL 的页面可能无法使用。</small></span><input type="checkbox" disabled={!firefox} checked={advanced.blockWebgl} onChange={e=>set({blockWebgl:e.target.checked})}/></label>
      {!firefox&&<p className="profile-field-hint">字体限制、严格指纹保护和 WebGL 禁用需要 Firefox。Chrome / Edge 保留浏览器实际指纹。</p>}
    </section>
    <section className="advanced-card"><h3><SlidersHorizontal size={17}/>网站权限与内容</h3><p>设置新网站的默认权限。已在浏览器内保存的网站例外仍然保留。</p>
      <div className="profile-form">{([['notifications','网页通知'],['camera','摄像头'],['microphone','麦克风']] as const).map(([key,label])=><label key={key}>{label}<select aria-label={label} value={advanced[key]} onChange={e=>set({[key]:e.target.value})}><option value="ask">使用前询问</option><option value="block">默认禁止</option></select></label>)}</div>
      <label className="advanced-toggle"><span><strong>默认不加载图片</strong><small>减少图片流量，也会影响头像、验证码和网页内容。已允许的网站可使用自己的设置。</small></span><input type="checkbox" checked={advanced.blockImages} onChange={e=>set({blockImages:e.target.checked})}/></label>
    </section>
  </div>;
}

export function ProfilePreview({draft,running,match}:{draft:ProfileDraft;running?:boolean;match?:IpRegion|null}) {
  const {preferences:p,proxy}=draft,a=p.advanced,strict=draft.browser==='firefox'&&a.resistFingerprinting;
  const permission=(value:string)=>value==='block'?'默认禁止':value==='allow'?'允许':'使用前询问';
  const r=p.regional,language=r.languageMode==='ip'?match?.language||'启动时匹配 IP':p.language;
  const timezone=strict?'UTC · 严格保护':r.timezoneMode==='system'?'跟随电脑系统':r.timezoneMode==='custom'?r.timezone:match?.timezone||'启动时匹配 IP';
  const location=a.location==='block'?'已禁用':r.locationMode==='system'?'浏览器默认':r.locationMode==='custom'?`${r.latitude}, ${r.longitude}`:match?`约 ${match.latitude.toFixed(4)}, ${match.longitude.toFixed(4)}`:'启动时匹配 IP';
  const rows=[['浏览器',({chrome:'Chrome',edge:'Edge',firefox:'Firefox'} as const)[draft.browser]],['网络',proxy.mode==='system'?'系统代理':proxy.mode==='direct'?'直连':`${proxy.mode.toUpperCase()} · ${proxy.host||'待填写'}:${proxy.port}`],['语言',strict?`${language}（严格保护可能覆盖）`:language],['网页时区',timezone],['字体',p.fontRestriction?'限制可见性':strict?'Firefox 统一保护':'真实字体'],['WebRTC',p.privacy||['http','https','socks5'].includes(proxy.mode)?draft.browser==='firefox'?'已禁用':'限制非代理 UDP':'浏览器默认'],['指纹保护',strict?'Firefox 严格保护':'浏览器标准行为'],['WebGL',a.blockWebgl?'禁用':strict?'Firefox 统一保护':'真实'],['屏幕 / 硬件',strict?'Firefox 统一保护':'真实'],['通知',permission(a.notifications)],['定位权限',permission(a.location)],['定位坐标',location],['摄像头 / 麦克风',`${permission(a.camera)} / ${permission(a.microphone)}`],['图片',a.blockImages?'默认不加载':'允许加载'],['Cookie / 登录','此副本独立保存'],['启动页面',p.startupUrl]];
  return <aside className="profile-preview" aria-label="环境配置预览"><span className="eyebrow">ENVIRONMENT PREVIEW</span><h3>{draft.name||'新的浏览器空间'}</h3><p>配置预览 · {running?'下次启动生效':'保存后启动生效'}</p><dl>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="preview-note"><ShieldCheck size={16}/><span>这里展示计划配置。网页实际读取结果，请启动副本后进行环境复检。</span></div></aside>;
}
