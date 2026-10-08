import messages from './locales/en.json';

export type Language = 'zh' | 'en';
export type LanguagePreference = Language | 'system';
export const languageStorageKey = 'nodecloak.language';
export function resolveLanguage(preference: LanguagePreference, languages: readonly string[]): Language {
  if (preference !== 'system') return preference;
  return /^zh(?:-|$)/i.test(languages[0] || '') ? 'zh' : 'en';
}
export function readLanguagePreference(): LanguagePreference {
  try { const saved = localStorage.getItem(languageStorageKey); return saved === 'zh' || saved === 'en' ? saved : 'system'; } catch { return 'system'; }
}
let language: Language = resolveLanguage(readLanguagePreference(), typeof navigator === 'undefined' ? ['zh'] : navigator.languages?.length ? navigator.languages : [navigator.language]);
export function setLanguage(value: Language) { language = value; }
export function getLanguage(): Language { return language; }
export function getDateLocale(): string { return language === 'zh' ? 'zh-CN' : 'en-US'; }
const dictionary: Record<string, string> = messages;
const userInterpolations = new Set(['默认 {0}', '{0} 副本', '彻底删除 {0}', '{0} 更多操作']);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.entries(dictionary).filter(([key]) => /\{\d+\}/.test(key)).sort(([a],[b]) => b.replace(/\{\d+\}/g,'').length-a.replace(/\{\d+\}/g,'').length).map(([key, value]) => {
  const indexes: string[] = [];
  const parts = key.split(/(\{\d+\})/g).map(part => {
    if (/^\{\d+\}$/.test(part)) { indexes.push(part.slice(1, -1)); return '(.*?)'; }
    return escape(part);
  });
  return {pattern: new RegExp('^' + parts.join('') + '$', 's'), indexes, value, preserve: userInterpolations.has(key)};
});

/** Source messages stay Chinese; translation happens only at presentation boundaries. */
export function t<T>(value: T): T {
  if (language === 'zh' || typeof value !== 'string' || !/[\u3400-\u9fff]/.test(value)) return value;
  const text = value.replace(/\s+/g, ' ').trim();
  if (Object.prototype.hasOwnProperty.call(dictionary, text)) return dictionary[text] as T;
  for (const template of templates) {
    const match = template.pattern.exec(text);
    if (match) return template.value.replace(/\{(\d+)\}/g, (_, index: string) => {
      const part = match[template.indexes.indexOf(index) + 1] || '';
      return template.preserve ? part : t(part);
    }) as T;
  }
  if (text.startsWith('Error: ')) return ('Error: ' + t(text.slice(7))) as T;
  if (text.includes(' · ')) return text.split(' · ').map(part => t(part)).join(' · ') as T;
  const diagnostic = /^(claude\.(?:ai|com) |HTTP \d+ |DNT: |GPC: )(.+)$/.exec(text);
  if (diagnostic) return (diagnostic[1] + t(diagnostic[2])) as T;
  return value;
}
