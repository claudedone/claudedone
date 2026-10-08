import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {Languages} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
import {native} from './bridge';
import {languageStorageKey,readLanguagePreference,resolveLanguage,setLanguage,t,type Language,type LanguagePreference} from './i18n';

const LanguageContext=createContext<{language:Language;preference:LanguagePreference;choose:(value:LanguagePreference)=>void}|null>(null);
export function LanguageProvider({children}:{children:ReactNode}) {
  const [preference,choose]=useState(readLanguagePreference);
  const [systemLanguages,setSystemLanguages]=useState(()=>Array.from(navigator.languages?.length?navigator.languages:[navigator.language]));
  const language=resolveLanguage(preference,systemLanguages);
  setLanguage(language);
  useEffect(()=>{
    let disposed=false;
    const changed=()=>{
      const fallback=Array.from(navigator.languages?.length?navigator.languages:[navigator.language]);
      if(native)void invoke<string[]>('get_system_languages').then(values=>{if(!disposed)setSystemLanguages(values.length?values:fallback);}).catch(()=>{if(!disposed)setSystemLanguages(fallback);});
      else setSystemLanguages(fallback);
    };
    changed();window.addEventListener('languagechange',changed);
    return()=>{disposed=true;window.removeEventListener('languagechange',changed);};
  },[]);
  useEffect(()=>{
    document.documentElement.lang=language==='zh'?'zh-CN':'en';
    document.title=language==='zh'?'NodeCloak · 浏览器工作空间':'NodeCloak · Browser workspace';
    try{localStorage.setItem(languageStorageKey,preference);}catch{}
    if(native)void invoke('set_interface_language',{language}).catch(()=>{});
  },[language,preference]);
  return <LanguageContext.Provider value={{language,preference,choose}}>{children}</LanguageContext.Provider>;
}
export function useLanguage(){const context=useContext(LanguageContext);if(!context)throw new Error('LanguageProvider is required');return context;}
export default function LanguageControl(){const {preference,choose}=useLanguage();return <label className="language-control"><Languages size={15}/><span>{t('界面语言')}</span><select aria-label={t('界面语言')} value={preference} onChange={e=>choose(e.target.value as LanguagePreference)}><option value="system">{t('跟随系统语言')}</option><option value="zh">简体中文</option><option value="en">English</option></select></label>;}
