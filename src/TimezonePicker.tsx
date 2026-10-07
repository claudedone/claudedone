import { timezoneChoices, timezoneOffsetLabel, type TimezoneTarget, type TimezoneOption } from './domain';

interface Props {
  target: TimezoneTarget; custom: string; options: TimezoneOption[]; loading: boolean;
  error: string; platform: string; disabled: boolean;
  onTarget: (target: TimezoneTarget) => void; onCustom: (zone: string) => void; onReload: () => void;
}

export default function TimezonePicker({ target, custom, options, loading, error, platform, disabled, onTarget, onCustom, onReload }: Props) {
  const chosen = options.find(zone => zone.id === custom);
  return <section className="timezone-picker">
    <label htmlFor="target-timezone">目标系统时区</label>
    <select id="target-timezone" value={target} disabled={disabled} onChange={e => onTarget(e.target.value as TimezoneTarget)}>
      {Object.entries(timezoneChoices).map(([value, choice]) => <option key={value} value={value}>{choice.label}</option>)}
    </select>
    {target === 'custom' && <>
      <label htmlFor="custom-timezone" className="custom-timezone-label">搜索或输入指定时区</label>
      <input id="custom-timezone" list="system-timezones" value={custom} disabled={disabled || loading || !options.length}
        placeholder={platform === 'Windows' ? '例如 Tokyo Standard Time' : '例如 Asia/Tokyo 或 America/New_York'}
        spellCheck={false} autoComplete="off" aria-invalid={!!custom && !chosen} aria-describedby="timezone-input-status"
        onChange={e => onCustom(e.target.value)} />
      <datalist id="system-timezones">{options.map(zone => <option key={zone.id} value={zone.id}>{timezoneOffsetLabel(zone.offsetMinutes)} · {zone.label}</option>)}</datalist>
      <p id="timezone-input-status" role={error ? 'alert' : 'status'}>
        {loading ? '正在读取系统支持的时区…' : error || (chosen ? `已选择 ${chosen.id} · 当前偏移 ${timezoneOffsetLabel(chosen.offsetMinutes)}。支持夏令时的地区会按系统规则自动调整。` : '请从系统支持的清单选择完整时区名称，输入无效时无法应用。')}
      </p>
      {error && <button type="button" className="button secondary small-button" disabled={disabled || loading} onClick={onReload}>重新读取时区</button>}
    </>}
    <p>{timezoneChoices[target].consequence}</p>
  </section>;
}
