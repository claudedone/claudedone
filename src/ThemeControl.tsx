import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { native } from './bridge';
type Preference = 'system' | 'light' | 'dark';
export default function ThemeControl() {
  const [preference, setPreference] = useState<Preference>(() => {
    try { const saved = localStorage.getItem('nodecloak.theme'); return saved === 'light' || saved === 'dark' ? saved : 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      if (native) void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTheme(preference === 'system' ? null : preference)).catch(() => {});
    };
    apply(); media.addEventListener('change', apply);
    try { localStorage.setItem('nodecloak.theme', preference); } catch {}
    return () => media.removeEventListener('change', apply);
  }, [preference]);
  return <div className="theme-control" role="group" aria-label="外观主题">{(['light','dark','system'] as const).map(value => {
    const Icon = value === 'light' ? Sun : value === 'dark' ? Moon : Monitor;
    const label = value === 'light' ? '浅色主题' : value === 'dark' ? '深色主题' : '跟随系统主题';
    return <button key={value} aria-label={label} title={label} aria-pressed={preference === value} onClick={() => setPreference(value)}><Icon size={15} /></button>;
  })}</div>;
}
