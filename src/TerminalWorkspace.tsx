import {t} from './i18n';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Check,Clock3,FolderOpen,Info,LoaderCircle,RefreshCw,Terminal,Wifi} from 'lucide-react';
import {native} from './bridge';
import {getTerminalCatalog,launchTerminal,openTerminalGuide,terminalTools,type TerminalCatalog,type TerminalTool} from './terminal';

export default function TerminalWorkspace({busy,onBusyChange,onNotify}:{busy:boolean;onBusyChange:(message:string|null)=>void;onNotify:(message:string)=>void}) {
  const [selected,setSelected]=useState<TerminalTool>('claude');
  const [catalog,setCatalog]=useState<TerminalCatalog|null>(null);
  const [directory,setDirectory]=useState(()=>localStorage.getItem('nodecloak-terminal-directory')||'');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{let cancelled=false;getTerminalCatalog().then(result=>{if(!cancelled)setCatalog(result);}).catch(error=>{if(!cancelled)setError(String(error));}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[]);
  const tool=terminalTools.find(t=>t.id===selected)!;
  const installed=catalog?.tools.find(t=>t.id===selected)?.installed;
  async function refresh(){setLoading(true);setError('');try{setCatalog(await getTerminalCatalog());}catch(error){setError(String(error));}finally{setLoading(false);}}
  async function launch(){
    setError('');onBusyChange(`正在打开 ${tool.name}`);
    try{await launchTerminal(selected,directory);localStorage.setItem('nodecloak-terminal-directory',directory);onNotify(`已打开 ${tool.name} 终端。`);}catch(error){setError(String(error));}finally{onBusyChange(null);}
  }
  async function guide(){try{await openTerminalGuide(selected);}catch(error){setError(String(error));}}
  return <div className="terminal-workspace">
    <section className="workspace-banner code-banner"><span className="large-feature-icon"><Terminal size={36} strokeWidth={1.3}/></span><div><span className="eyebrow">YOUR TERMINAL, READY</span><h2>{t("选一个助手，开始工作。")}</h2><p>{t("Claude、ChatGPT、Gemini，或你喜欢的其他 CLI。沿用已有的登录与网络配置。")}</p></div><span className="tiny-label">TERMINAL</span></section>
    <section className="terminal-tools-section"><div className="section-heading"><h3>{t("终端工具")}</h3><button className="button secondary small-button" disabled={busy||loading} onClick={()=>void refresh()}><RefreshCw size={14} className={loading?'spin':''}/>{t("重新检测")}</button></div>
      <div className="terminal-tools" aria-label={t("选择终端工具")}>{terminalTools.map(item=>{
        const available=catalog?.tools.find(t=>t.id===item.id)?.installed;
        return <button key={item.id} type="button" className={`terminal-tool ${selected===item.id?'selected':''}`} aria-pressed={selected===item.id} disabled={busy} onClick={()=>{setSelected(item.id);setError('');}}><span className="terminal-tool-brand">{t(item.brand)}</span><strong>{t(item.name)}</strong><code>{t(item.command||'PowerShell / zsh')}</code><span className={`terminal-tool-status ${available?'available':''}`}>{loading?<LoaderCircle size={12} className="spin"/>:available?<Check size={12}/>:<Info size={12}/>} {t(loading?'正在检测':!native?available?'可启动（演示）':'未安装（演示）':available?item.id==='shell'?'系统自带':'已安装':'未安装')}</span></button>;
      })}</div>
    </section>
    <section className="terminal-launch-panel settings-card"><div className="terminal-launch-heading"><div><h3>{t(tool.name)}</h3><p>{t(tool.description)}</p></div><span className="tiny-label">LOCAL</span></div>
      <label className="terminal-directory"><span><FolderOpen size={15}/>{t("工作目录")}</span><input aria-label={t("终端工作目录")} value={directory} onChange={e=>setDirectory(e.target.value)} placeholder={t(catalog?.homeDirectory||'留空使用用户主目录')} disabled={busy}/><small>{t("填写项目文件夹的完整路径；留空使用用户主目录。")}{t(catalog?.homeDirectory&&` 默认：${catalog.homeDirectory}`)}</small></label>
      {t(error&&<div className="notice warning-notice" role="alert"><Info size={16}/><p>{t(error)}</p></div>)}
      {!loading&&catalog&&!installed&&<div className="notice"><Info size={16}/><p>{t("未找到")}{t(tool.name)}{t("。请先按官方指南安装，再点击“重新检测”。首次运行时，请在终端中完成登录。")}</p></div>}
      <div className="workspace-actions"><button className="button primary" disabled={busy||loading||!installed} onClick={()=>void launch()}>{busy?<LoaderCircle size={15} className="spin"/>:<Terminal size={15}/>}{t("打开")}{t(tool.name)}<ArrowUpRight size={15}/></button>{t(tool.guide&&<button className="button secondary" disabled={busy} onClick={()=>void guide()}>{t("官方安装指南")}<ArrowUpRight size={14}/></button>)}</div>
    </section>
    <div className="terminal-card"><div className="terminal-top"><span className="terminal-dots"><i/><i/><i/></span><span>{t("NodeCloak 启动环境")}</span><span>{t("只影响当前进程")}</span></div><div className="terminal-body"><p><span className="terminal-comment">{t("# 从所选工作目录启动")}</span></p><p><span>TZ</span><span className="terminal-equals">=</span>Asia/Singapore</p><p><span>LANG</span><span className="terminal-equals">=</span>en_US.UTF-8</p><p><span>LC_ALL</span><span className="terminal-equals">=</span>en_US.UTF-8</p><p className="terminal-command"><span>❯</span> {t(tool.command||'你的 CLI 命令')}<span className="terminal-caret"/></p></div></div>
    <div className="info-grid"><article className="info-card"><Clock3 size={20}/><h3>{t("独立的进程环境")}</h3><p>{t("终端使用新加坡时区与英文 locale。设置仅作用于这个终端及其启动的进程。")}</p></article><article className="info-card"><Wifi size={20}/><h3>{t("沿用已有连接")}</h3><p>{t("继承电脑当前的代理、网关与 CLI 配置。浏览器副本的独立代理不会自动应用到终端。")}</p></article></div>
    <div className="notice"><Info size={17}/><p>{t("Windows 使用 PowerShell，macOS 使用 Terminal。工具的安装、登录和权限由各 CLI 自身管理。")}{t(!native&&'当前为界面演示，安装状态是示例数据。')}</p></div>
  </div>;
}
