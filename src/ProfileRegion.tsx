import {t} from './i18n';
import {Globe2,LoaderCircle,MapPin} from 'lucide-react';
import {needsRegionalControl,type ProfileDraft,type IpRegion} from './browser-profiles';
import {native} from './bridge';
function Choices<T extends string>({label,value,options,onChange}:{label:string;value:T;options:readonly (readonly [T,string])[];onChange:(value:T)=>void}){return <div className="region-setting"><strong>{t(label)}</strong><div className="proxy-modes" role="group" aria-label={t(label)}>{options.map(([id,text])=><button type="button" key={id} aria-pressed={value===id} className={value===id?'selected':''} onClick={()=>onChange(id)}>{t(text)}</button>)}</div></div>;}
export default function ProfileRegion({draft,onChange,match,matching,onMatch}:{draft:ProfileDraft;onChange:(draft:ProfileDraft)=>void;match:IpRegion|null;matching:boolean;onMatch:()=>void}){
  const p=draft.preferences,r=p.regional;
  const ip=r.languageMode==='ip';
  return <section className="advanced-card"><h3><Globe2 size={17}/>{t("副本区域设置")}</h3><p>{t("设置浏览器语言与定位权限。时区跟随电脑，地理位置由浏览器处理。")}</p>
    <Choices label="语言" value={r.languageMode} options={[["ip","跟随 IP 匹配"],["custom","自定义"]]} onChange={languageMode=>{const next={...p,regional:{...r,languageMode}};if(languageMode==='ip')next.advanced={...next.advanced,resistFingerprinting:false};onChange({...draft,preferences:next});}}/>
    {r.languageMode==='custom'&&<div className="profile-form region-single"><label>{t("浏览器语言")}<input aria-label={t("浏览器语言")} value={p.language} placeholder="en-US,en" onChange={e=>onChange({...draft,preferences:{...p,language:e.target.value}})}/><small className="profile-field-hint">{t("多个语言用英文逗号分隔，第一个为首选语言。")}{t(draft.browser==='firefox'&&'独立区域模式的 Firefox 使用首选语言。')}</small></label></div>}
    <Choices label="地理位置权限" value={p.advanced.location} options={[["ask","询问"],["allow","允许"],["block","禁用"]]} onChange={location=>onChange({...draft,preferences:{...p,advanced:{...p.advanced,location}}})}/>
    {p.advanced.location==='allow'&&<p className="profile-field-hint">{t("允许定位时，网站可使用浏览器提供的实际位置。")}</p>}
    {p.advanced.location==='block'&&<p className="profile-field-hint">{t("启动后将禁用定位。Chrome / Edge 已保存的定位授权也会清除，改回询问后需重新授权。")}</p>}
    {ip&&<div className="region-match"><button type="button" className="button secondary compact" onClick={onMatch} disabled={matching}>{matching?<LoaderCircle size={14} className="spin"/>:<MapPin size={14}/>}{t("匹配当前 IP")}</button>{match&&<div role="status"><strong>{t(match.country)} · {t(match.city)} · {t(match.ip)}{t(!native&&'（演示）')}</strong><small>{t(match.language)}</small></div>}<p className="profile-field-hint">{t("按代理出口国家匹配常用语言；启动时会在浏览器内再次确认。按域名分流时，检测服务与目标网站可能使用不同出口。")}</p></div>}
    {needsRegionalControl(p)&&<div className="advanced-caution">{t("独立区域设置会启用浏览器原生自动化接口，网页可读取到自动化模式标记。")}{t("若网页验证反复失败，请改为自定义语言后重启副本。")}</div>}
    {needsRegionalControl(p)&&<p className="profile-field-hint">{t("区域设置由此副本的本地浏览器接口应用。请保持 NodeCloak 后台运行。")}{t(draft.browser==='firefox'&&'Firefox 需更新至支持区域接口的版本；严格指纹保护已关闭。')}</p>}
  </section>;
}
