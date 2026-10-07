import { ArrowUpRight, Info, RefreshCw } from 'lucide-react';

export default function FirefoxSetup({ busy, onDownload, onRefresh }: {
  busy: boolean; onDownload: () => void; onRefresh: () => void;
}) {
  return <section className="notice firefox-setup" aria-label="安装 Firefox">
    <Info size={20} />
    <div><strong>还没有找到 Firefox</strong>
      <p>从 Firefox 官方下载页选择 Windows 或 macOS 版本。macOS 下载后请将 Firefox 拖到“应用程序”文件夹；安装完成后回来重新检测。</p>
      <div className="firefox-setup-actions">
        <button className="button primary small-button" disabled={busy} onClick={onDownload}>下载官方 Firefox<ArrowUpRight size={14} /></button>
        <button className="button secondary small-button" disabled={busy} onClick={onRefresh}><RefreshCw size={14} />已安装，重新检测</button>
      </div>
      <small>firefox.com · 可选择语言和系统版本</small>
    </div>
  </section>;
}
