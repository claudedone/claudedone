import type { BrowserId } from './domain';

export default function BrowserIcon({ browser }: { browser: BrowserId }) {
  return <span className={`browser-icon ${browser}`} aria-hidden="true">
    <img src={`/browsers/${browser}.svg`} alt="" width="20" height="20" draggable={false} />
  </span>;
}
