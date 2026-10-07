import {useEffect,useState} from 'react';
import {Globe2,LoaderCircle,MapPin} from 'lucide-react';
import {needsRegionalControl,type ProfileDraft,type RegionalSettings,type IpRegion} from './browser-profiles';
import {native} from './bridge';
function Coordinate({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){
  const [text,setText]=useState(String(value));
  useEffect(()=>{if(Number.isFinite(value)&&Number(text)!==value)setText(String(value));},[value]);
  return <label>{label}<input inputMode="decimal" value={text} onChange={e=>{setText(e.target.value);onChange(e.target.value.trim()?Number(e.target.value):NaN);}}/></label>;
}
function Choices<T extends string>({label,value,options,onChange}:{label:string;value:T;options:readonly (readonly [T,string])[];onChange:(value:T)=>void}){return <div className="region-setting"><strong>{label}</strong><div className="proxy-modes" role="group" aria-label={label}>{options.map(([id,text])=><button type="button" key={id} aria-pressed={value===id} className={value===id?'selected':''} onClick={()=>onChange(id)}>{text}</button>)}</div></div>;}
export default function ProfileRegion({draft,onChange,match,matching,onMatch}:{draft:ProfileDraft;onChange:(draft:ProfileDraft)=>void;match:IpRegion|null;matching:boolean;onMatch:()=>void}){
  const p=draft.preferences,r=p.regional;
  function setRegion(patch:Partial<RegionalSettings>){const next={...p,regional:{...r,...patch}};if(needsRegionalControl(next))next.advanced={...next.advanced,resistFingerprinting:false};onChange({...draft,preferences:next});}
  const ip=r.languageMode==='ip'||r.timezoneMode==='ip'||r.locationMode==='ip';
  return <section className="advanced-card"><h3><Globe2 size={17}/>副本区域设置</h3><p>为这个副本单独设置语言、时区与定位，不改变电脑的区域设置。</p>
    <Choices label="语言" value={r.languageMode} options={[["ip","跟随 IP 匹配"],["custom","自定义"]]} onChange={languageMode=>setRegion({languageMode})}/>
    {r.languageMode==='custom'&&<div className="profile-form region-single"><label>浏览器语言<input aria-label="浏览器语言" value={p.language} placeholder="en-US,en" onChange={e=>onChange({...draft,preferences:{...p,language:e.target.value}})}/><small className="profile-field-hint">多个语言用英文逗号分隔，第一个为首选语言。{draft.browser==='firefox'&&'独立区域模式的 Firefox 使用首选语言。'}</small></label></div>}
    <Choices label="时区" value={r.timezoneMode} options={[["ip","跟随 IP 匹配"],["custom","自定义"],["system","跟随电脑"]]} onChange={timezoneMode=>setRegion({timezoneMode})}/>
    {r.timezoneMode==='custom'&&<div className="profile-form region-single"><label>自定义时区<input aria-label="自定义时区" list="profile-timezones" value={r.timezone} onChange={e=>setRegion({timezone:e.target.value})} placeholder="America/Los_Angeles"/><datalist id="profile-timezones">{['UTC','America/Los_Angeles','America/New_York','America/Chicago','Europe/London','Europe/Berlin','Europe/Paris','Asia/Tokyo','Asia/Seoul','Asia/Singapore','Asia/Hong_Kong','Australia/Sydney'].map(zone=><option key={zone} value={zone}/>)}</datalist><small className="profile-field-hint">使用 IANA 名称；UTC 偏移会按这个时区和夏令时自动计算。</small></label></div>}
    <Choices label="地理位置权限" value={p.advanced.location} options={[["ask","询问"],["allow","允许"],["block","禁用"]]} onChange={location=>{const regional=location==='allow'&&r.locationMode==='system'?{...r,locationMode:'ip' as const}:r;const next={...p,regional,advanced:{...p.advanced,location}};if(needsRegionalControl(next))next.advanced.resistFingerprinting=false;onChange({...draft,preferences:next});}}/>
    <Choices label="地理位置来源" value={r.locationMode} options={[["ip","跟随 IP 匹配"],["custom","自定义"],["system","浏览器默认"]]} onChange={locationMode=>{const next={...p,regional:{...r,locationMode},advanced:{...p.advanced,location:locationMode==='system'&&p.advanced.location==='allow'?'ask' as const:p.advanced.location}};if(needsRegionalControl(next))next.advanced.resistFingerprinting=false;onChange({...draft,preferences:next});}}/>
    {r.locationMode==='custom'&&<div className="profile-form region-coordinates"><Coordinate label="纬度（−90 至 90）" value={r.latitude} onChange={latitude=>setRegion({latitude})}/><Coordinate label="经度（−180 至 180）" value={r.longitude} onChange={longitude=>setRegion({longitude})}/><Coordinate label="定位精度（米）" value={r.accuracy} onChange={accuracy=>setRegion({accuracy})}/></div>}
    {p.advanced.location==='block'&&<p className="profile-field-hint">启动后将禁用定位。Chrome / Edge 已保存的定位授权也会清除，改回询问后需重新授权。</p>}
    {ip&&<div className="region-match"><button type="button" className="button secondary compact" onClick={onMatch} disabled={matching}>{matching?<LoaderCircle size={14} className="spin"/>:<MapPin size={14}/>}匹配当前 IP</button>{match&&<div role="status"><strong>{match.country} · {match.city} · {match.ip}{!native&&'（演示）'}</strong><small>{match.language} · {match.timezone}<br/>约 {match.latitude.toFixed(4)}, {match.longitude.toFixed(4)}</small></div>}<p className="profile-field-hint">这里通过代理路径预览，启动时会在实际浏览器内再次匹配。IP 定位是大致位置；语言采用国家的常用语言模板，多语言地区可自行调整。</p></div>}
    {needsRegionalControl(p)&&<div className="advanced-caution">独立区域设置会启用浏览器原生自动化接口，网页可读取到自动化模式标记。</div>}
    {needsRegionalControl(p)&&<p className="profile-field-hint">区域设置由此副本的本地浏览器接口应用。请保持 NodeCloak 后台运行。{draft.browser==='firefox'&&'Firefox 需更新至支持区域接口的版本；严格指纹保护已关闭。'}</p>}
  </section>;
}
