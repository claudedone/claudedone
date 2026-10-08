import {afterEach,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {resolveLanguage,setLanguage,t,getDateLocale,readLanguagePreference,languageStorageKey} from './i18n';
import {ProfileAdvanced,ProfilePreview} from './ProfileAdvanced';
import {defaults,validateDraft} from './browser-profiles';
import {FontReview} from './FontDialogs';
import ts from 'typescript';
import messages from './locales/en.json';
afterEach(()=>setLanguage('zh'));
it('uses the preferred system language, with explicit preferences taking priority',()=>{
  expect(resolveLanguage('system',['zh-TW','en-US'])).toBe('zh');
  expect(resolveLanguage('system',['en-GB','zh-CN'])).toBe('en');
  expect(resolveLanguage('system',['fr-FR'])).toBe('en');
  expect(resolveLanguage('system',[])).toBe('en');
  expect(resolveLanguage('zh',['en-US'])).toBe('zh');
  expect(resolveLanguage('en',['zh-CN'])).toBe('en');
});
it('reads saved preferences safely and ignores unsupported or unavailable storage',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>key===languageStorageKey?'en':null}});
    expect(readLanguagePreference()).toBe('en');
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'fr'}});
    expect(readLanguagePreference()).toBe('system');
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get:()=>{throw new Error('unavailable');}});
    expect(readLanguagePreference()).toBe('system');
  }finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete (globalThis as {localStorage?:Storage}).localStorage;}
});
it('translates dynamic status messages without rewriting the interpolated user data',()=>{
  setLanguage('en');
  expect(t('终端')).toBe('Terminal');
  expect(t('一键修复 3 项')).toBe('Repair 3 settings');
  expect(t('彻底删除 取消')).toBe('Permanently delete 取消');
  expect(t('默认 Chrome 更多操作')).toBe('More actions for 默认 Chrome');
  expect(t('查看浏览器语言详情')).toBe('View Browser language details');
  expect(t('Error: 请先关闭副本')).toBe('Error: Close the profile first');
  expect(t('D:\\项目\\配置.json')).toBe('D:\\项目\\配置.json');
  expect(getDateLocale()).toBe('en-US');
  setLanguage('zh');expect(t('终端')).toBe('终端');expect(getDateLocale()).toBe('zh-CN');
});
it('renders English settings without changing editable profile configuration',()=>{
  setLanguage('en');const draft=defaults();draft.name='取消';draft.notes='我的中文备注';draft.tags=['工作'];draft.preferences.language='zh-CN,en';
  const before=JSON.stringify(draft);
  const html=renderToStaticMarkup(<><ProfilePreview draft={draft}/><ProfileAdvanced draft={draft} onChange={()=>{}} match={null} matching={false} onMatch={()=>{}}/></>);
  expect(html).toContain('Profile regional settings');expect(html).toContain('Geolocation permission');expect(html).toContain('Camera');
  expect(html).toContain('>取消</h3>');expect(html).toContain('zh-CN,en');expect(JSON.stringify(draft)).toBe(before);
  expect(validateDraft({...draft,name:''})).toBe('请填写 1–60 个字符的副本名称');
});
it('keeps font removal confirmation and disabled controls in English',()=>{
  setLanguage('en');const html=renderToStaticMarkup(<FontReview catalog={{items:[{id:'a',label:'用户字体',fileName:'a.otf',bytes:1}],protected:['simsun.ttc'],note:''}} initialIds={[]} busy={false} onClose={()=>{}} onSubmit={()=>{}}/>);
  expect(html).toContain('I confirm removing');expect(html).toContain('disabled=""');expect(html).not.toContain('checked=""');expect(html).toContain('>用户字体</strong>');
});
it('has an English message for every explicit Chinese UI message',()=>{
  const missing:string[]=[];
  const sources=import.meta.glob('./*.tsx',{eager:true,query:'?raw',import:'default'});
  for(const [file,content] of Object.entries(sources).filter(([file])=>!file.includes('.test.'))){
    const source=ts.createSourceFile(file,content as string,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='t'&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0])){const key=node.arguments[0].text;if(/[\u3400-\u9fff]/.test(key)&&!(key in messages))missing.push(file+': '+key);}ts.forEachChild(node,visit);};visit(source);
  }
  expect(missing).toEqual([]);
});
