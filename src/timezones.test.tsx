import { beforeEach, expect, it } from 'vitest';
import {setLanguage} from './i18n';
beforeEach(()=>setLanguage('zh'));
import { renderToStaticMarkup } from 'react-dom/server';
import TimezonePicker from './TimezonePicker';
import { timezoneOffsetLabel } from './domain';

it('explains the current offset for a supported custom timezone including half hours', () => {
  const html = renderToStaticMarkup(<TimezonePicker target="custom" custom="Asia/Kolkata"
    options={[{ id: 'Asia/Kolkata', label: 'Asia/Kolkata', offsetMinutes: -330 }]}
    loading={false} error="" platform="macOS" disabled={false} onTarget={() => {}} onCustom={() => {}} onReload={() => {}} />);
  expect(html).toContain('当前偏移 UTC+5:30');
  expect(html).toContain('aria-invalid="false"');
  expect(timezoneOffsetLabel(210)).toBe('UTC-3:30');
});

it('flags unknown names and explains that they cannot be applied', () => {
  const html = renderToStaticMarkup(<TimezonePicker target="custom" custom="Unknown/Zone"
    options={[{ id: 'GMT', label: 'GMT', offsetMinutes: 0 }]}
    loading={false} error="" platform="macOS" disabled={false} onTarget={() => {}} onCustom={() => {}} onReload={() => {}} />);
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('输入无效时无法应用');
});
