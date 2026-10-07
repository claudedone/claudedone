import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, Download, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { checkForUpdates, native, openDownloadPage, type UpdateCheck } from './bridge';
import { version } from '../package.json';

const PREFERENCE = 'claudedone.auto-check-updates';
const SIX_HOURS = 6 * 60 * 60 * 1000;

export default function AppUpdates({ expanded }: { expanded: boolean }) {
  const [automatic, setAutomatic] = useState(() => {
    try { return localStorage.getItem(PREFERENCE) !== 'off'; } catch { return true; }
  });
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState('');
  const inFlight = useRef(false);
  const initialCheck = useRef(false);
  const mounted = useRef(true);

  async function check() {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true); setError('');
    try {
      const next = await checkForUpdates();
      if (mounted.current) setResult(next);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!automatic) return;
    if (!initialCheck.current) { initialCheck.current = true; void check(); }
    const timer = window.setInterval(() => void check(), SIX_HOURS);
    return () => clearInterval(timer);
  }, [automatic]);

  function toggleAutomatic(value: boolean) {
    setAutomatic(value);
    try { localStorage.setItem(PREFERENCE, value ? 'on' : 'off'); } catch { /* Still applies to this session. */ }
    if (value) void check();
  }
  async function download() {
    try { await openDownloadPage(); } catch (failure) { setError(String(failure)); }
  }

  const updateVisible = result?.available && (expanded || dismissed !== result.latestVersion);
  if (!expanded && !updateVisible) return null;
  return <section className={expanded ? 'settings-card app-updates' : 'update-banner'} aria-label="应用更新">
    {expanded && <>
      <div className="update-heading"><div><h3>应用更新</h3><p>当前版本 {version}{!native && ' · 演示模式'}</p></div><span className="settings-tag neutral">稳定版</span></div>
      <div className="settings-line"><div><strong>自动检查更新</strong><p>启动时和每 6 小时检查官网上的新版本。</p></div><label className="pending-toggle"><input type="checkbox" checked={automatic} onChange={event => toggleAutomatic(event.target.checked)} aria-label="自动检查更新" /><span className="switch" /></label></div>
      <div className="update-status" role="status" aria-live="polite">
        {checking ? <><LoaderCircle size={16} className="spin" /><span>正在检查新版本…</span></> : error ? <><CircleAlert size={16} /><span>{error}</span></> : result ? <><Check size={16} /><span>{result.available ? `发现新版本 ${result.latestVersion}` : result.supported ? '当前已是最新版本' : '此平台暂无可下载的官方安装包'}</span></> : <span>尚未检查更新</span>}
      </div>
      {result && <p className="update-last-check">上次检查成功：{new Date(result.checkedAt).toLocaleString('zh-CN')}</p>}
    </>}
    {updateVisible && <div className="update-release" role="status">
      <div><strong><Download size={16} />发现新版本 {result.latestVersion}{!native && '（演示）'}</strong><ul>{result.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>
      <div className="update-release-actions"><button className="button primary" onClick={() => void download()}>前往官网下载<ArrowUpRight size={14} /></button>{!expanded && <button className="icon-button" aria-label="暂时关闭更新提示" onClick={() => setDismissed(result.latestVersion)}><X size={16} /></button>}</div>
    </div>}
    {!expanded && error && <p className="update-open-error" role="alert">{error}</p>}
    {expanded && <div className="update-controls"><p>发现新版后提醒你，由你选择下载和安装。</p><button className="button secondary" disabled={checking} onClick={() => void check()}><RefreshCw size={14} className={checking ? 'spin' : ''} />{checking ? '正在检查' : '检查更新'}</button></div>}
  </section>;
}
