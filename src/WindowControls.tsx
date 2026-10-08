import {t} from './i18n';
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { native } from './bridge';

export default function WindowControls({ onError }: { onError: (message: string) => void }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!native) return;
    const window = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => void window.isMaximized().then(value => {
      if (!disposed) setMaximized(value);
    }).catch(() => {});
    sync();
    void window.onResized(sync).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  async function perform(action: 'minimize' | 'toggleMaximize' | 'close') {
    if (!native) return;
    try {
      const window = getCurrentWindow();
      await window[action]();
      if (action === 'toggleMaximize') setMaximized(await window.isMaximized());
    } catch {
      onError('窗口操作未完成，请重试。');
    }
  }

  return <div className="window-controls" data-tauri-drag-region="false" role="group" aria-label={t("窗口操作")}>
    <button title={t("最小化")} aria-label={t("最小化")} disabled={!native} onClick={() => void perform('minimize')}><Minus size={15} /></button>
    <button title={t(maximized ? '还原窗口' : '最大化')} aria-label={t(maximized ? '还原窗口' : '最大化')} disabled={!native} onClick={() => void perform('toggleMaximize')}>{maximized ? <Copy size={14} /> : <Square size={14} />}</button>
    <button className="window-close" title={t("关闭窗口并收起到托盘")} aria-label={t("关闭窗口并收起到托盘")} disabled={!native} onClick={() => void perform('close')}><X size={16} /></button>
  </div>;
}
