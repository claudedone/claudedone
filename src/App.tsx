import { useEffect, useRef, useState, type ElementType } from 'react';
import { Activity, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, Fingerprint, Globe2, History, Info, Languages, LayoutDashboard, LoaderCircle, LockKeyhole, Monitor, RefreshCw, RotateCcw, Settings2, ShieldCheck, Sparkles, Terminal, Type, Wifi, X, CircleAlert, Send } from 'lucide-react';
import { checkCount, defaultTimezoneTarget, definitions, labels, recommendedChecks, repairIds, timezoneChoices, timeLabel, type BrowserId, type CheckId, type Check as EnvironmentCheck, type Outcome, type RepairRecord, type Scan, type TimezoneTarget, type TimezoneOption } from './domain';
import { parseBrowserReport, withBrowserReport, type BrowserReport } from './browser-report';
import AppUpdates from './AppUpdates';
import {version} from '../package.json';
import TimezonePicker from './TimezonePicker';
import FirefoxSetup from './FirefoxSetup';
import { FontReview, FontResult } from './FontDialogs';
import { getFontCatalog, removeUserFonts, type FontCatalog, type FontOutcome } from './bridge';
import { summarizeOutcomes } from './repair-result';
import { getTimezoneCatalog, checkRepairReadiness, openTimezoneSettings, openTelegramGroup, openFirefoxDownload, native, scanEnvironment, getHistory, repairEnvironment, undoRepair, launchBrowser, launchCli } from './bridge';

type Page = 'overview' | 'browser' | 'code' | 'history' | 'settings';
type RepairRequest = { browser: BrowserId; ids: CheckId[]; consentTimezone: boolean; consentFonts: boolean; timezoneTarget: TimezoneTarget; customTimezone: string };
type Modal = {kind:'fonts';catalog:FontCatalog;initialIds:string[]} | {kind:'font-result';outcomes:FontOutcome[]} | { kind: 'repair'; ids: CheckId[] } | { kind: 'detail'; id: CheckId } | { kind: 'undo'; record: RepairRecord } | { kind: 'help' } | { kind: 'result'; outcomes: Outcome[]; request: RepairRequest } | { kind: 'blocked'; request: RepairRequest; reason: string } | { kind: 'report' };
const icons: Record<CheckId, ElementType> = { connection: Wifi, route: Globe2, webrtc: ShieldCheck, dns: LockKeyhole, language: Languages, timezone: Clock3, offset: Clock3, locale: Languages, cli: Terminal, fonts: Type, emoji: Fingerprint, webgl: Monitor, screen: Monitor, networkInfo: Wifi, plugins: Settings2, tracking: ShieldCheck };
const nav: { id: Page; title: string; icon: ElementType }[] = [
  { id: 'overview', title: '环境概览', icon: LayoutDashboard }, { id: 'browser', title: '浏览器环境', icon: Globe2 }, { id: 'code', title: 'Claude Code', icon: Terminal }, { id: 'history', title: '修复记录', icon: History },
];
const pageText: Record<Page, [string, string]> = {
  overview: ['环境概览', '少一点配置，多一点专注。'], browser: ['浏览器环境', '为 Claude 留一个干净、独立的空间。'], code: ['Claude Code', '在熟悉的终端里，使用独立的环境设置。'], history: ['修复记录', '每一次调整都有记录，也有退路。'], settings: ['偏好设置', '选择适合你的使用环境。'],
};
const browserNames = { chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox' };
function Mark({ small = false }: { small?: boolean }) { return <img className={small ? 'brand-mark small' : 'brand-mark'} src="/mark.svg" alt="" />; }
function Status({ status }: { status: EnvironmentCheck['status'] }) { return <span className={`status status-${status}`}><span />{labels[status]}</span>; }
function BrowserIcon({ browser }: { browser: BrowserId }) {
  return <span className={`browser-icon ${browser}`}><Globe2 size={18} /></span>;
}
function Orbit({ count, total }: { count: number; total: number }) {
  return <div className="orbit" aria-label={`${count} 项建议调整`}>
    <svg viewBox="0 0 190 190" aria-hidden="true"><circle cx="95" cy="95" r="79" className="orbit-track" /><circle cx="95" cy="95" r="79" className="orbit-progress" strokeDasharray={`${(count / total) * 496} 496`} /><circle cx="95" cy="95" r="61" className="orbit-inner" />{Array.from({ length: 36 }, (_, i) => <line key={i} x1="95" y1="41" x2="95" y2="45" transform={`rotate(${i * 10} 95 95)`} />)}</svg>
    <div className="orbit-number">{count}<span>项建议调整</span></div>
    <span className="orbit-star"><Sparkles size={16} /></span>
  </div>;
}

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [browser, setBrowser] = useState<BrowserId>(() => (['edge','firefox'].includes(localStorage.getItem('claude-ready-browser') || '') ? localStorage.getItem('claude-ready-browser') : 'chrome') as BrowserId);
  const [scan, setScan] = useState<Scan | null>(null);
  const [history, setHistory] = useState<RepairRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [selected, setSelected] = useState<CheckId[]>([]);
  const [consentFonts, setConsentFonts] = useState(false);
  const [consentTimezone, setConsentTimezone] = useState(false);
  const [timezoneTarget, setTimezoneTarget] = useState<TimezoneTarget>('singapore');
  const [customTimezone, setCustomTimezone] = useState('');
  const [timezoneCatalog, setTimezoneCatalog] = useState<TimezoneOption[]>([]);
  const [timezoneLoading, setTimezoneLoading] = useState(false);
  const [timezoneError, setTimezoneError] = useState('');
  const timezoneLabel = timezoneTarget === 'custom' ? customTimezone || '自定义时区（尚未选择）' : timezoneChoices[timezoneTarget].label;
  const customTimezoneValid = timezoneTarget !== 'custom' || timezoneCatalog.some(zone => zone.id === customTimezone);
  async function loadTimezoneCatalog() {
    setTimezoneLoading(true); setTimezoneError('');
    try { setTimezoneCatalog(await getTimezoneCatalog()); }
    catch (error) { setTimezoneError(String(error)); }
    finally { setTimezoneLoading(false); }
  }
  useEffect(() => {
    if (timezoneTarget === 'custom' && modal?.kind === 'repair' && !timezoneCatalog.length && !timezoneError) void loadTimezoneCatalog();
  }, [timezoneTarget, modal?.kind]);
  const [reports, setReports] = useState<Record<BrowserId, BrowserReport | null>>({chrome:null, edge:null, firefox:null});
  const [reportInput, setReportInput] = useState('');
  const [group, setGroup] = useState('all');
  const [onlyPending, setOnlyPending] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const initialized = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const checks = withBrowserReport(scan, reports[browser])?.checks || [];
  const warnings = checks.filter(c => c.status === 'warning');
  const configured = checks.filter(c => c.status === 'configured').length;
  const healthy = checks.filter(c => c.status === 'healthy').length;
  const manual = checks.filter(c => ['manual', 'unknown'].includes(c.status)).length;
  const suggested = recommendedChecks(checks);
  const pendingCount = warnings.length + manual;
  const displayed = checks.filter(c => (group === 'all' || definitions[c.id].group === group) && (!onlyPending || ['warning', 'manual', 'unknown'].includes(c.status)));

  function notify(text: string, error = false) { setToast({ text, error }); }
  async function refresh(target = browser) {
    const results = await Promise.allSettled([scanEnvironment(target), getHistory()]);
    if (results[0].status === 'fulfilled') setScan(results[0].value); else notify(String(results[0].reason), true);
    if (results[1].status === 'fulfilled') setHistory(results[1].value); else notify(String(results[1].reason), true);
  }
  async function perform(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try { await action(); } catch (e) { notify(e instanceof Error ? e.message : String(e), true); }
    finally { setBusy(null); }
  }
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; void perform('正在检测环境', () => refresh()); }
    // Initial scan is intentionally invoked once, including under StrictMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 5000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { if (modal) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [modal]);
  function repairDialog(ids: CheckId[], target: TimezoneTarget = defaultTimezoneTarget(ids), custom = '') { const mapped = repairIds(ids); setSelected(mapped); setConsentTimezone(false); setConsentFonts(false); setTimezoneTarget(target); setCustomTimezone(custom); setModal({ kind: 'repair', ids: mapped }); }
  async function fontDialog(initialIds: string[] = []) {
    if(browser === 'firefox') { repairDialog(['fonts']); return; }
    await perform('正在读取用户字体清单', async () => {
      const catalog = await getFontCatalog();
      setModal({kind:'fonts',catalog,initialIds});
    });
  }
  async function applyFonts(ids: string[], consent: boolean) {
    await perform('正在备份并处理用户字体', async () => {
      const outcomes = await removeUserFonts(browser, ids, consent);
      if(outcomes.some(o => o.success)) setReports({chrome:null,edge:null,firefox:null});
      setModal({kind:'font-result',outcomes}); await refresh();
    });
  }
  function importReport() {
    try { const report = parseBrowserReport(reportInput); if (report.browser && report.browser !== browser) throw new Error("这份报告来自另一个专用浏览器，请先切换浏览器再导入。"); setReports(prev => ({...prev, [browser]:report})); setModal(null); notify('已导入网页采集报告，检测项现在显示报告中的实际值。'); }
    catch (e) { notify(e instanceof Error ? e.message : String(e), true); }
  }
  function bulkRepair() {
    if (!suggested.length) { notify('自动修复项目已配置。你可以查看手动确认项，或打开网页复检。'); return; }
    repairDialog(suggested.map(c => c.id));
  }
  async function switchBrowser(next: BrowserId) {
    if (next === browser || busy) return;
    setBrowser(next); localStorage.setItem('claude-ready-browser', next);
    setScan(null); await perform('正在检测浏览器环境', () => refresh(next));
  }
  async function applyRepair(request: RepairRequest = { browser, ids: [...selected], consentTimezone, consentFonts, timezoneTarget, customTimezone }) {
    await perform('正在检查并应用设置', async () => {
      const readiness = await checkRepairReadiness(request.browser, request.ids);
      if (!readiness.ready) { setModal({ kind: 'blocked', request, reason: readiness.message }); return; }
      const outcomes = await repairEnvironment(request.browser, request.ids, request.consentTimezone, request.timezoneTarget, request.consentFonts, request.customTimezone);
      if (outcomes.some(o => o.success)) setReports(prev => outcomes.some(o => o.success && o.id === 'timezone') ? {chrome:null, edge:null, firefox:null} : {...prev, [request.browser]:null});
      setModal({ kind: 'result', outcomes, request });
      await refresh(request.browser);
    });
  }
  const openBrowser = (destination: 'claude' | 'verify' | 'dns' | 'diagnostics' | 'privacyDocs') => perform('正在打开专用浏览器', async () => { await launchBrowser(browser, destination); notify('已打开专用浏览器。请在该窗口内验证设置。'); });
  const openCode = () => perform('正在启动 Claude Code', async () => { await launchCli(); notify('已打开终端，启动器只在该进程内应用环境设置。'); });
  const cliCheck = checks.find(c => c.id === 'cli');

  function checkRow(c: EnvironmentCheck) {
    const Icon = icons[c.id];
    return <div className="check-row" key={c.id}>
      <button className="check-name" onClick={() => setModal({ kind: 'detail', id: c.id })} aria-label={`查看${definitions[c.id].title}详情`}><span className={`check-icon ${definitions[c.id].group}`}><Icon size={19} strokeWidth={1.7} /></span><span><strong>{definitions[c.id].title}</strong><small>{definitions[c.id].description}</small></span></button>
      <span className="check-value" title={c.value}>{c.value}</span><Status status={c.status} />
      {c.id === 'fonts' ? <button className="row-action" disabled={!!busy} onClick={() => void fontDialog()}>{browser === 'firefox' ? '限制字体' : '管理字体'}<ArrowUpRight size={13} /></button> : c.fixable && (c.status === 'warning' || c.id === 'timezone' || c.id === 'offset') ? <button className="row-action" onClick={() => repairDialog([c.id])} disabled={!!busy}>{['timezone','offset'].includes(c.id) ? '设置时区' : '修复'}<ArrowUpRight size={13} /></button> : <button className="row-detail" onClick={() => setModal({ kind: 'detail', id: c.id })}>{c.status === 'configured' ? '复检说明' : c.status === 'healthy' ? '查看详情' : '处理建议'}<ChevronRight size={13} /></button>}
    </div>;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Mark /><span>Claude Done<small>让环境准备就绪</small></span></div>
      <span className="sidebar-label">工作空间</span>
      <nav aria-label="主导航">{nav.map(({ id, title, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}><Icon size={18} strokeWidth={1.7} /><span>{title}</span>{id === 'overview' && warnings.length > 0 && <span className="nav-count">{warnings.length}</span>}{id === 'history' && history.filter(r => r.status === 'applied').length > 0 && <span className="nav-history-dot" />}</button>)}</nav>
      <div className="sidebar-separator" /><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><Settings2 size={18} strokeWidth={1.7} /><span>偏好设置</span></button>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><BookOpen size={21} strokeWidth={1.5} /></span><strong>第一次使用？</strong><p>从检测开始，了解每一项<br />设置的作用。</p><button onClick={() => setModal({ kind: 'help' })}>查看使用指南<ArrowUpRight size={14} /></button></div><div className="sidebar-footer"><span className="local-dot" />本地运行<span>v{version}</span></div></div>
    </aside>
    <main>
      <header className="topbar"><div className="breadcrumb">工作空间<ChevronRight size={12} /><span>{pageText[page][0]}</span></div><div className="topbar-right">{!native && <span className="demo-badge">交互演示 · 不修改电脑</span>}<button className="telegram-group" title="加入 Telegram 群" disabled={!!busy} onClick={() => void perform('正在打开 Telegram 群', openTelegramGroup)}><Send size={14} /><span>Telegram Group</span><ArrowUpRight size={13} /></button><span className="platform-label"><Monitor size={13} />{scan?.platform || '桌面环境'}</span><button className="icon-button" title="使用指南" aria-label="使用指南" onClick={() => setModal({ kind: 'help' })}><CircleHelp size={18} /></button></div></header>
      <div className="main-content">
        <div className="page-heading"><div><h1>{pageText[page][0]}</h1><p>{pageText[page][1]}</p></div><button className="button secondary" disabled={!!busy} onClick={() => perform('正在重新检测', async () => { await refresh(); notify(native ? '检测已更新' : '演示检测已更新'); })}><RefreshCw size={15} className={busy?.includes('检测') ? 'spin' : ''} />{busy?.includes('检测') ? '正在检测' : '重新检测'}</button></div>

        <AppUpdates expanded={page === 'settings'} busy={!!busy} onBusyChange={value=>setBusy(value?'正在更新应用':null)} />
        {browser === 'firefox' && scan && !scan.browserAvailable && <FirefoxSetup busy={!!busy}
          onDownload={() => void perform('正在打开 Firefox 官方下载页', openFirefoxDownload)}
          onRefresh={() => void perform('正在重新检测 Firefox', () => refresh())} />}
        {page === 'overview' && <>
          <div className="hero-grid">
            <section className="hero-panel"><div className="hero-copy"><span className="eyebrow"><span />ENVIRONMENT CHECK</span><h2>{!scan ? '正在了解你的环境' : warnings.length ? <>让 Claude，<br />用起来更顺畅。</> : <>环境已准备好，<br />专注下一件事。</>}</h2><p>{!scan ? '读取本地配置并检查网络连接，请稍候。' : warnings.length ? `${warnings.length} 项设置建议调整。我们帮你一步步处理。` : '已配置的项目可在专用浏览器中继续复检。'}</p><button className="button primary" disabled={!!busy || !scan || !suggested.length} onClick={bulkRepair}><Sparkles size={16} />{suggested.length ? `一键修复 ${suggested.length} 项` : '自动修复项已配置'}<ArrowRight size={15} /></button><span className="hero-note"><History size={12} />自动备份原值，随时可以撤销</span></div><Orbit count={warnings.length} total={checkCount} /></section>
            <section className="environment-card"><div className="card-topline"><span>你的使用环境</span><span className="tiny-label">LOCAL</span></div><div className="environment-os"><span className="os-symbol"><Monitor size={25} strokeWidth={1.4} /></span><div><strong>{scan?.platform || '正在识别系统'}</strong><small>桌面环境 · 本地配置</small></div></div><div className="environment-line"><span>专用浏览器</span><div><BrowserIcon browser={browser} /><select aria-label="选择专用浏览器" value={browser} onChange={e => void switchBrowser(e.target.value as BrowserId)} disabled={!!busy}><option value="chrome">Google Chrome</option><option value="edge">Microsoft Edge</option><option value="firefox">Firefox · 保留电脑字体</option></select><ChevronDown size={12} /></div></div><div className="environment-line"><span>本机网络出口</span><strong className="ip-label">{scan?.ip || '尚未获取'}{scan?.location && <span className="country">{scan.location}</span>}</strong></div><div className="environment-footer"><LockKeyhole size={12} />专用配置与日常浏览器相互独立</div></section>
          </div>
          <div className="summary-bar"><span><span className="summary-dot amber" /><strong>{warnings.length}</strong> 项建议调整</span><span><span className="summary-dot green" /><strong>{healthy}</strong> 项检测正常</span><span><span className="summary-dot blue" /><strong>{configured}</strong> 项已配置</span><span><span className="summary-dot gray" /><strong>{manual}</strong> 项需确认</span><span className="last-check"><Clock3 size={12} />{scan ? `${timeLabel(scan.checkedAt)} 检测` : '等待检测完成'}</span></div>
          <div className="notice signal-explainer"><Info size={17} /><p>第三方网页的加权分数不是 Claude 官方账号风险评分。语言、时区可调整；GPU、屏幕和平台风格是正常设备特征。请通过下方专用窗口复检，日常浏览器不会继承这些设置。</p></div><section className="browser-verification-bar"><div><strong>网页实际结果，单独复检</strong><p>{reports[browser] ? `已导入 ${timeLabel(reports[browser]!.capturedAt)} 报告 · ${reports[browser]!.browser ? '专用页面标记' : '无专用标记，请确认窗口'}；设置变更后请重新采集。` : '11 项网页信号单独采集；网页检测无法验证 Claude Code 进程。'}</p></div><button className="button secondary small-button" disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('diagnostics')}>打开本地复检<ArrowUpRight size={13} /></button><button className="button secondary small-button" disabled={!!busy || !scan} onClick={() => { setReportInput(''); setModal({kind:'report'}); }}>导入浏览器复检</button>{reports[browser] && <button className="row-detail" onClick={() => setReports(prev => ({...prev, [browser]:null}))}>清除报告</button>}</section><section className="checks-section"><div className="section-heading"><h3>检测项目<span>{checks.length.toString().padStart(2, '0')}</span></h3><label className="pending-toggle"><input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} /><span className="switch" />只看待处理{onlyPending && <span className="tiny-label">{pendingCount}</span>}</label></div><div className="filter-tabs" role="tablist" aria-label="检测类别">{[['all', '全部项目'], ['network', '网络连接'], ['privacy', '隐私保护'], ['device', '设备环境']].map(([id, title]) => <button role="tab" aria-selected={group === id} key={id} className={group === id ? 'selected' : ''} onClick={() => setGroup(id)}>{title}{id === 'all' && <span>{checks.length}</span>}</button>)}<span className="scope-note">浏览器项目仅检测专用配置<Info size={12} /></span></div><div className="check-table"><div className="table-head"><span>检测项目</span><span>当前状态</span><span>检测结果</span><span>操作</span></div>{!scan ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><strong>{busy || '尚未完成检测'}</strong><p>网络检测可能需要约 30 秒。检测只读取本地配置。</p>{!busy && <button className="button secondary" onClick={() => perform('正在重新检测', () => refresh())}>重试检测</button>}</div> : displayed.length ? displayed.map(checkRow) : <div className="empty-state"><CheckCheck size={29} /><strong>这个分类没有待处理项目</strong><p>可以查看全部项目，或到浏览器里复检。</p><button onClick={() => { setOnlyPending(false); setGroup('all'); }}>查看全部项目<ArrowRight size={14} /></button></div>}</div></section>
          <div className="bottom-note"><Info size={14} /><span>配置完成后，请从这里打开专用环境继续使用。</span><button disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('verify')}>打开浏览器<ArrowUpRight size={13} /></button></div>
        </>}

        {page === 'browser' && <>
          <section className="workspace-banner"><span className="large-feature-icon"><Globe2 size={37} strokeWidth={1.3} /></span><div><span className="eyebrow">A SPACE FOR CLAUDE</span><h2>一个专用环境，日常设置照旧。</h2><p>使用独立配置目录打开 {browserNames[browser]}，语言与隐私设置仅在这里生效。首次使用需要重新登录 Claude。</p></div></section>
          {browser === 'firefox' && <div className="notice firefox-notice"><Type size={19} /><div><strong>保留电脑字体，为专用 Firefox 单独设置</strong><p>主动选择“限制字体”后应用。设置只影响此专用环境；常见拉丁字体和 Emoji 保留，部分中文显示可能变化。此选项不自动加入一键修复。</p><p>Firefox 完全退出后才能修改或从工具重新打开；已打开时，可在当前专用窗口继续访问网站。{!scan?.browserAvailable && scan && '请先安装 Firefox。'}</p><button className="button secondary small-button" disabled={!!busy || !scan?.browserAvailable} onClick={() => void fontDialog()}>设置字体可见性<ArrowRight size={14} /></button></div></div>}
          <div className="workspace-actions"><button className="button primary" disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('claude')}>打开 Claude<ArrowUpRight size={16} /></button><button className="button secondary" disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('verify')}><Activity size={16} />打开浏览器</button><button className="button secondary" disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('diagnostics')}>本地环境复检</button><button className="button secondary" disabled={!!busy || !suggested.length} onClick={bulkRepair}><Sparkles size={16} />准备专用环境</button></div>
          {!scan?.browserAvailable && scan && browser !== 'firefox' && <div className="notice warning-notice"><Info size={17} /><p>没有找到 {browserNames[browser]}。请先安装，或在偏好设置中切换浏览器，然后重新检测。</p></div>}
          {browser === 'firefox' && <details className="firefox-help"><summary>Firefox 启动或安全连接失败？</summary><p><strong>配置文件缺失：</strong>请正常退出专用 Firefox 后重试。本工具会创建并检查专用目录；若仍失败，请反馈下方的配置保存位置和错误截图，无需删除日常配置。</p><p><strong>访问 home.firefoxchina.cn 失败：</strong>这可能来自中国版主页或安装包自带设置，建议使用上方官方渠道的安装包。专用环境启动主页设为空白，并直接打开指定页面。</p><p><code>PR_END_OF_FILE_ERROR</code> 也可能由代理、VPN、加密 DNS 或安全软件引起，不能仅凭错误码判断安装包版本。先尝试本地环境复检，再打开 Claude；若仅在修复 DNS 后出现问题，可在修复记录中恢复“DNS 隐私”后重试。</p><button className="button secondary small-button" disabled={!!busy} onClick={() => void perform('正在打开 Firefox 官方下载页', openFirefoxDownload)}>Firefox 官方下载<ArrowUpRight size={14} /></button></details>}
          <div className="section-heading"><h3>专用配置</h3><span className="muted">{browserNames[browser]}</span></div><div className="check-table">{checks.filter(c => ['language', 'webrtc', 'dns', 'tracking', ...(browser === 'firefox' ? ['fonts'] : [])].includes(c.id)).map(checkRow)}</div>
          <div className="info-grid"><article className="info-card"><History size={20} /><h3>每一步都可恢复</h3><p>修复前保存原值。恢复时仅修改对应字段，保留后来产生的登录信息和其他偏好。</p><button onClick={() => setPage('history')}>查看修复记录<ArrowRight size={14} /></button></article><article className="info-card"><ShieldCheck size={20} /><h3>配置与实测，分别确认</h3><p>“已配置”表示设置已写入。浏览器策略或网络代理可能影响实际效果，请通过网页复检。</p><button disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('verify')}>在专用浏览器验证<ArrowUpRight size={14} /></button></article></div>
          <div className="path-card"><span>配置保存位置</span><code>{scan?.profilePath || '正在读取'}</code><LockKeyhole size={14} /></div>
        </>}

        {page === 'code' && <>
          <section className="workspace-banner code-banner"><span className="large-feature-icon"><Terminal size={36} strokeWidth={1.3} /></span><div><span className="eyebrow">YOUR TERMINAL, READY</span><h2>准备好环境，再开始写代码。</h2><p>专用启动器设置语言与进程时区，继承你原有的网络与认证配置。</p></div><span className="tiny-label">CLI</span></section>
          <div className="notice"><Info size={17} /><p>网页扫描的是浏览器环境，不能证明这个 Claude Code 进程已被标记。浏览器语言、字体、WebGL、屏幕、插件和 DNT 不等于 CLI 实测。可选遥测控制请参考<button className="row-detail" disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('privacyDocs')}>官方数据使用说明<ArrowUpRight size={13} /></button>；关闭遥测不能改变服务地域或账号规则。</p></div><div className="workspace-actions"><button className="button primary" disabled={!!busy || cliCheck?.status !== 'configured' || !scan?.cliInstalled} onClick={() => void openCode()}>打开 Claude Code<ArrowUpRight size={16} /></button><button className="button secondary" disabled={!!busy || !scan?.cliInstalled || cliCheck?.status === 'configured'} onClick={() => repairDialog(['cli'])}><Sparkles size={16} />准备启动器</button></div>
          {cliCheck && <div className="check-table">{checkRow(cliCheck)}</div>}
          <div className="terminal-card"><div className="terminal-top"><span className="terminal-dots"><i /><i /><i /></span><span>专用启动环境</span><span>只影响当前进程</span></div><div className="terminal-body"><p><span className="terminal-comment"># 由 Claude Done 启动时应用</span></p><p><span>TZ</span><span className="terminal-equals">=</span>Asia/Singapore</p><p><span>LANG</span><span className="terminal-equals">=</span>en_US.UTF-8</p><p><span>LC_ALL</span><span className="terminal-equals">=</span>en_US.UTF-8</p><p className="terminal-command"><span>❯</span> claude<span className="terminal-caret" /></p></div></div>
          <div className="info-grid"><article className="info-card"><Clock3 size={20} /><h3>进程时区与系统时区独立</h3><p>启动器使用新加坡时区（UTC+8），不会改变电脑时钟。直接从其他终端启动 Claude 时，仍使用原有环境。</p></article><article className="info-card"><Wifi size={20} /><h3>沿用你的网络配置</h3><p>启动器不会移除代理、修改 API 地址或读取密钥。需要先安装 Claude Code，并配置可用网络。</p></article></div>
          <div className="notice"><Info size={17} /><p>Windows 使用 PowerShell，macOS 使用 Terminal。首次启动可能出现系统权限提示。Windows 组织策略可能限制脚本运行，请遵循你所在组织的设置。</p></div>
        </>}

        {page === 'history' && <>
          <div className="history-intro"><span className="large-feature-icon"><History size={29} strokeWidth={1.5} /></span><div><h3>改过什么，一目了然。</h3><p>原值保存在本机。撤销时会检查设置是否又被其他程序修改。</p></div><span className="tiny-label">{history.length} 条记录</span></div>
          {!history.length ? <div className="history-empty"><span className="empty-illustration"><History size={43} strokeWidth={1.1} /></span><h2>还没有修复记录</h2><p>完成一次修复后，原值和处理结果会出现在这里。</p><button className="button secondary" onClick={() => setPage('overview')}>返回环境概览<ArrowRight size={15} /></button></div> : <div className="history-list">{[...history].reverse().map(r => <article className={`history-record ${r.status === 'undone' ? 'undone' : ''}`} key={r.id}><span className="check-icon"><History size={18} /></span><div className="record-body"><div><strong>{definitions[r.itemId].title}</strong><span className={`record-status ${r.status}`}>{({ applied: '已应用', undone: '已撤销', failed: '未完成', pending: '待核验' })[r.status]}</span></div><p>{r.message}</p><small>{timeLabel(r.createdAt)}<span>·</span>{(['timezone', 'cli'].includes(r.itemId) || r.changes.some(c => c.target === 'userFont')) ? '本机环境' : browserNames[r.browser]}{!native && ' · 演示记录'}</small><details><summary>查看备份内容<ChevronDown size={12} /></summary>{r.changes.map((c, i) => <div className="backup-detail" key={i}><code>{c.pointer || c.target}</code><span>原值：{formatBackup(c.before)}</span><span>目标：{formatBackup(c.after)}</span></div>)}</details></div>{r.status !== 'undone' && <button className="button secondary small-button" disabled={!!busy} onClick={() => setModal({ kind: 'undo', record: r })}><RotateCcw size={13} />恢复原值</button>}</article>)}</div>}
        </>}

        {page === 'settings' && <>
          <section className="settings-card"><h3>专用浏览器</h3><p>独立环境支持 Chrome、Edge 和 Firefox。Firefox 可单独限制字体可见性，保留电脑字体。切换后，将检测对应浏览器的专用配置。</p><div className="browser-options">{(['chrome', 'edge', 'firefox'] as BrowserId[]).map(id => <button className={`browser-option ${id === browser ? 'chosen' : ''}`} key={id} disabled={!!busy} onClick={() => void switchBrowser(id)}><BrowserIcon browser={id} /><div><strong>{browserNames[id]}</strong><small>独立配置 · 首次使用需重新登录</small></div><span className="radio-dot">{id === browser && <span />}</span></button>)}</div></section>
          <section className="settings-card"><h3>修复方式</h3><div className="settings-line"><div><strong>自动备份与撤销</strong><p>每项修复写入前保存原值，修复记录仅保存在本机。</p></div><span className="settings-tag"><Check size={13} />始终开启</span></div><div className="settings-line"><div><strong>系统时区</strong><p>一键修复默认不修改系统时区，可在修复面板中单独选择。</p></div><span className="settings-tag neutral">手动选择</span></div><div className="settings-line"><div><strong>检测请求</strong><p>检测时请求 claude.ai、claude.com 与 Cloudflare，获取 HTTPS 状态和本机出口 IP。</p></div><span className="settings-tag neutral">应用启动或检测时运行</span></div></section>
          <section className="settings-card about-card"><div className="brand"><Mark small /><span>Claude Done<small>版本 {version} · Tauri 2</small></span></div><p>独立开发的环境助手，非 Anthropic 官方产品。检测与配置结果不能预测账户风控或保证服务可用。</p><button onClick={() => setModal({ kind: 'help' })}>使用指南<ArrowUpRight size={14} /></button></section>
        </>}
        <footer className="content-footer"><span><LockKeyhole size={11} />备份存储在本机</span><span>Made for a calmer workflow.</span><button onClick={() => setModal({ kind: 'help' })}>帮助与说明<ArrowUpRight size={11} /></button></footer>
      </div>
    </main>
    {busy && scan && <div className="operation-indicator" role="status"><LoaderCircle size={14} className="spin" />{busy}</div>}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <Info size={18} /> : <Check size={18} />}<span>{toast.text}</span><button aria-label="关闭通知" onClick={() => setToast(null)}><X size={15} /></button></div>}
    <dialog ref={dialogRef} className="modal" onCancel={e => { if (busy) e.preventDefault(); else setModal(null); }} onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }} aria-labelledby="modal-title"><div className="modal-content"><button className="modal-close icon-button" aria-label="关闭面板" disabled={!!busy} onClick={() => setModal(null)}><X size={19} /></button>
      {modal?.kind === 'fonts' && <FontReview key="font-review" catalog={modal.catalog} initialIds={modal.initialIds} busy={!!busy} onClose={() => setModal(null)} onSubmit={(ids,consent) => void applyFonts(ids,consent)}/>}
      {modal?.kind === 'font-result' && <FontResult outcomes={modal.outcomes} busy={!!busy} onHistory={() => {setModal(null);setPage('history');}} onRetry={ids => void fontDialog(ids)}/>}
      {modal?.kind === 'repair' && <><span className="modal-feature"><Sparkles size={24} /></span><span className="eyebrow">A LITTLE TUNE-UP</span><h2 id="modal-title">准备修复这些设置</h2><p className="modal-subtitle">应用前自动保存原值。请选择要处理的项目。</p>{!native && <div className="notice demo-notice"><Info size={15} /><p>当前为交互演示，以下操作只更新演示数据。</p></div>}<div className="repair-options">{[...new Set([...modal.ids, ...(browser === 'firefox' ? ['fonts' as CheckId] : []), ...(!modal.ids.includes('fonts') && checks.some(c => ['timezone','offset'].includes(c.id) && c.status === 'warning') ? ['timezone' as CheckId] : [])])].map(id => <label key={id} className={`repair-option ${selected.includes(id) ? 'checked' : ''}`}><input type="checkbox" checked={selected.includes(id)} disabled={!!busy} onChange={e => { setSelected(prev => e.target.checked ? [...prev, id] : prev.filter(x => x !== id)); if (id === 'timezone') setConsentTimezone(false); if(id === 'fonts') setConsentFonts(false); }} /><span className="custom-checkbox">{selected.includes(id) && <Check size={12} />}</span><span><strong>{definitions[id].title}{id === 'timezone' && <em>影响整个系统</em>}</strong><small>{id === 'timezone' ? timezoneLabel : id === 'webrtc' && browser === 'firefox' ? '关闭专用 Firefox 的 WebRTC · 可能影响通话' : definitions[id].target}</small></span></label>)}</div>{selected.includes('fonts') && <label className="timezone-consent"><input type="checkbox" checked={consentFonts} onChange={e => setConsentFonts(e.target.checked)} disabled={!!busy} /><span>我确认只限制专用 Firefox 的系统字体可见性，保留电脑中文字体。部分中文显示和网页排版可能变化；网页下载字体仍可使用。需要退出并重新打开专用 Firefox 复检，可从修复记录恢复。</span></label>}{selected.includes('timezone') && <TimezonePicker target={timezoneTarget} custom={customTimezone} options={timezoneCatalog} loading={timezoneLoading} error={timezoneError} platform={scan?.platform || ''} disabled={!!busy} onTarget={target => { setTimezoneTarget(target); setConsentTimezone(false); }} onCustom={zone => { setCustomTimezone(zone); setConsentTimezone(false); }} onReload={() => void loadTimezoneCatalog()} />}{selected.includes('timezone') && <label className="timezone-consent"><input type="checkbox" checked={consentTimezone} onChange={e => setConsentTimezone(e.target.checked)} disabled={!!busy} /><span>我确认将整个系统时区改为 {timezoneLabel}，已了解上述时间变化。这会影响所有应用；Windows 或 macOS 可能请求系统管理员授权。</span></label>}<div className="notice"><History size={16} /><p>修复浏览器设置前，请关闭本工具打开的专用窗口。WebRTC 限制可能影响音视频通话；严格加密 DNS 不可达时网站可能无法访问。</p></div><div className="modal-actions"><button className="button secondary" disabled={!!busy} onClick={() => setModal(null)}>暂不修复</button><button className="button primary" disabled={!!busy || !selected.length || (selected.includes('timezone') && (!consentTimezone || !customTimezoneValid)) || (selected.includes('fonts') && !consentFonts)} onClick={() => void applyRepair()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{busy ? '正在备份与修复' : `${native ? '应用' : '演示'} ${selected.length} 项修复`}</button></div></>}
      {modal?.kind === 'detail' && (() => { const c = checks.find(c => c.id === modal.id); const def = definitions[modal.id]; const Icon = icons[modal.id]; return <><span className="modal-feature"><Icon size={25} /></span><h2 id="modal-title">{def.title}</h2><p className="modal-subtitle">{def.description}</p>{c && <div className="detail-result"><Status status={c.status} /><strong>{c.value}</strong><p>{c.detail}</p></div>}<h3 className="detail-heading">你可以这样处理</h3><ol className="advice-list">{(modal.id === 'fonts' && browser === 'firefox' ? def.advice.slice(0,1) : def.advice).map(text => <li key={text}>{text}</li>)}</ol><div className="modal-actions"><button className="button secondary" onClick={() => setModal(null)}>知道了</button>{modal.id === 'fonts' ? <button className="button primary" disabled={!!busy} onClick={() => void fontDialog()}>{browser === 'firefox' ? '设置字体可见性' : '管理可卸载字体'}<ArrowRight size={14} /></button> : c?.fixable && (c.status === 'warning' || c.id === 'timezone' || c.id === 'offset') ? <button className="button primary" disabled={!!busy} onClick={() => repairDialog([c.id])}>{['timezone','offset'].includes(c.id) ? '设置时区' : '修复这一项'}<ArrowRight size={14} /></button> : <button className="button primary" disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('verify')}>打开网页复检<ArrowUpRight size={14} /></button>}</div></>; })()}
      {modal?.kind === 'undo' && <><span className="modal-feature"><RotateCcw size={25} /></span><h2 id="modal-title">恢复修复前的设置？</h2><p className="modal-subtitle">将恢复「{definitions[modal.record.itemId].title}」在 {timeLabel(modal.record.createdAt)} 修复前的原值。</p><div className="notice"><Info size={17} /><p>关闭专用浏览器后再恢复。如果这个设置后来被其他程序修改，工具会保留新设置并提示你。登录信息和其他偏好会保留。</p></div><div className="modal-actions"><button className="button secondary" disabled={!!busy} onClick={() => setModal(null)}>取消</button><button className="button primary" disabled={!!busy} onClick={() => perform('正在恢复原值', async () => { await undoRepair(modal.record.id); setReports({chrome:null,edge:null,firefox:null}); setModal(null); await refresh(); notify('原值已恢复，可在修复记录中查看结果。'); })}>{busy ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}恢复原值</button></div></>}
      {modal?.kind === 'blocked' && <><span className="modal-feature partial"><Info size={26} /></span><span className="eyebrow">BEFORE WE CONTINUE</span><h2 id="modal-title">先退出专用浏览器</h2><p className="modal-subtitle">本次修复尚未开始，选择的 {modal.request.ids.length} 项设置已保留。</p><div className="notice warning-notice"><Info size={17} /><p>{modal.reason}</p></div><ol className="advice-list repair-preparation"><li>保存专用窗口中未完成的输入。</li><li>从该窗口的浏览器菜单选择“退出”。仅关掉标签页可能保留后台进程。</li><li>日常浏览器可以继续使用。退出后，点击下方按钮重新检查。</li></ol><div className="modal-actions"><button className="button secondary" disabled={!!busy} onClick={() => setModal(null)}>稍后处理</button><button className="button primary" disabled={!!busy} onClick={() => void applyRepair(modal.request)}><RefreshCw size={15} className={busy ? 'spin' : ''} />我已退出，检查并继续</button></div></>}
      {modal?.kind === 'result' && (() => { const summary = summarizeOutcomes(modal.outcomes); return <><span className={'modal-feature ' + summary.state}>{summary.state === 'success' ? <CheckCheck size={26} /> : <CircleAlert size={26} />}</span><span className="eyebrow">{summary.state === 'success' ? 'SETTINGS UPDATED' : 'NEEDS ATTENTION'}</span><h2 id="modal-title">{summary.title}</h2><p className="modal-subtitle">{native ? '完成表示设置已写入并验证；实际浏览器效果仍需复检。' : '以下为交互演示结果，电脑设置没有改变。'}{summary.failedIds.length > 0 && ' 请先处理未完成项目，再打开浏览器复检。'}</p><div className="result-list">{modal.outcomes.map(o => <div key={o.id} className={o.success ? 'completed' : 'incomplete'}>{o.success ? <Check className="success-icon" size={18} /> : <Info className="warning-icon" size={18} />}<span><strong>{definitions[o.id].title}<em className="result-item-status">{o.success ? '已完成' : '未完成'}</em></strong><small>{o.message}</small></span></div>)}</div>{summary.failedIds.includes('timezone') && scan?.platform === 'Windows' && <button className="timezone-settings-link" disabled={!!busy} onClick={() => void perform('正在打开系统设置', openTimezoneSettings)}>打开系统日期与时间<ArrowUpRight size={14} /></button>}<div className="modal-actions result-actions"><button className="button secondary" disabled={!!busy} onClick={() => { setModal(null); setPage('history'); }}>查看修复记录</button>{summary.failedIds.length > 0 ? <button className="button primary" disabled={!!busy} onClick={() => repairDialog(summary.failedIds, modal.request.timezoneTarget, modal.request.customTimezone)}><RefreshCw size={15} />重试 {summary.failedIds.length} 个未完成项目</button> : <button className="button primary" disabled={!!busy || !scan?.browserAvailable} onClick={() => void openBrowser('verify')}>打开浏览器<ArrowUpRight size={15} /></button>}</div></>; })()}
      {modal?.kind === 'report' && <><span className="modal-feature"><Activity size={25} /></span><h2 id="modal-title">导入浏览器复检</h2><p className="modal-subtitle">请在本工具打开的 {browserNames[browser]} 专用窗口中打开本地复检页，复制完整 JSON 报告后粘贴到这里。</p><textarea className="report-input" aria-label="浏览器复检 JSON 报告" placeholder="粘贴本地复检页的完整报告" value={reportInput} onChange={e => setReportInput(e.target.value)} spellCheck={false} /><div className="notice"><Info size={16} /><p>报告保存在当前应用会话，不上传服务器。这里只显示采集时的 11 项浏览器信号，不给账户安全评分。导入旧版报告时，新增项目保持未确认；字体宽度和 UA 推断都有限制。</p></div><div className="modal-actions"><button className="button secondary" onClick={() => setModal(null)}>取消</button><button className="button primary" disabled={!reportInput.trim()} onClick={importReport}>导入结果<ArrowRight size={14} /></button></div></>}{modal?.kind === 'help' && <><span className="modal-feature"><BookOpen size={25} /></span><h2 id="modal-title">三步，准备你的环境。</h2><p className="modal-subtitle">第一次使用，从这里开始。</p><div className="guide-steps">{[['01', '先检测，看清现状', '本机检测读取专用浏览器设置，并请求 Claude 和 Cloudflare 检查连接。网页端项目仍需在实际浏览器中复检。'], ['02', '按需修复，自动备份', '一键修复默认调整专用浏览器与 Claude Code 启动器。系统时区与 Firefox 字体限制需要单独确认。所有调整都可以从记录恢复。'], ['03', '打开专用环境，继续使用', '网页版请从浏览器环境页启动；Claude Code 请从对应页面启动。在其他浏览器或终端中使用时，独立设置不会自动生效。']].map(([number, title, text]) => <div key={number}><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div><div className="modal-actions"><button className="button primary" onClick={() => setModal(null)}>了解了<ArrowRight size={15} /></button></div></>}
    </div></dialog>
  </div>;
}
function formatBackup(value: unknown) {
  if (value === null || value === undefined) return '未设置（恢复时移除此字段）';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}


