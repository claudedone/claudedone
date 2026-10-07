import {invoke} from '@tauri-apps/api/core';
import {native} from './bridge';
import type {BrowserId} from './domain';
export type ProxyMode='direct'|'system'|'http'|'https'|'socks5';
export interface ProxyConfig {mode:ProxyMode;host:string;port:number;username:string;credentialRef?:string|null}
export interface Preferences {language:string;privacy:boolean;fontRestriction:boolean;startupUrl:string}
export interface ProxyTest {ip:string|null;country:string|null;latency:number;checkedAt:string;connection:string;target:string}
export interface BrowserProfile {id:string;name:string;browser:BrowserId;notes:string;tags:string[];proxy:ProxyConfig;preferences:Preferences;createdAt:string;updatedAt:string;deletedAt:string|null;lastTest:ProxyTest|null;legacy:boolean;running:boolean;pendingRestart:boolean;browserAvailable:boolean;hasPassword:boolean;proxyReady:boolean}
export interface ProfileDraft {name:string;browser:BrowserId;notes:string;tags:string[];proxy:ProxyConfig;password?:string;clearPassword:boolean;preferences:Preferences}
export const defaults=():ProfileDraft=>({name:'',browser:'firefox',notes:'',tags:[],proxy:{mode:'system',host:'',port:8080,username:''},password:'',clearPassword:false,preferences:{language:'en-US,en',privacy:true,fontRestriction:false,startupUrl:'https://claude.ai'}});
export function parseProxyUri(input:string):{proxy:ProxyConfig;password:string} {
  let url:URL;try{url=new URL(input.trim());}catch{throw new Error('请粘贴 http://、https:// 或 socks5:// 代理地址');}
  const mode=url.protocol.slice(0,-1);if(!['http','https','socks5'].includes(mode)||!url.hostname||url.pathname!=='/'&&url.pathname!==''||url.search||url.hash)throw new Error('代理链接协议或格式无效');
  const port=Number(url.port||({http:80,https:443,socks5:1080}[mode]));
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('代理端口必须在 1–65535 之间');
  return {proxy:{mode:mode as ProxyMode,host:url.hostname.replace(/^\[|\]$/g,''),port,username:decodeURIComponent(url.username)},password:decodeURIComponent(url.password)};
}
export function validateDraft(draft:ProfileDraft):string|null {
  if(!draft.name.trim()||draft.name.length>60)return '请填写 1–60 个字符的副本名称';
  if(draft.tags.length>10||draft.tags.some(tag=>!tag.trim()||tag.length>24))return '最多 10 个标签，每个标签不超过 24 个字符';
  if(draft.notes.length>1000)return '备注最多 1000 个字符';
  if(!/^[a-zA-Z0-9-]+(?:,[a-zA-Z0-9-]+)*$/.test(draft.preferences.language))return '语言格式示例：en-US,en';
  if(draft.preferences.startupUrl.length>4096)return '启动页面地址过长';
  try {if(draft.preferences.startupUrl!=='about:blank'){const url=new URL(draft.preferences.startupUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return '启动页面只支持 HTTP、HTTPS 或 about:blank';}}catch{return '请填写完整的启动页面地址';}
  if(['http','https','socks5'].includes(draft.proxy.mode)) {if(!draft.proxy.host.trim()||/[\s/@?#\\]/.test(draft.proxy.host))return '请填写 IP 或域名，协议和端口分别填写';if(!Number.isInteger(draft.proxy.port)||draft.proxy.port<1||draft.proxy.port>65535)return '端口必须在 1–65535 之间';if(new TextEncoder().encode(draft.proxy.username).length>255||/[:\x00-\x1f\x7f]/.test(draft.proxy.username))return '代理用户名不能包含冒号或换行';}
  if(new TextEncoder().encode(draft.password||'').length>255||/[\x00-\x1f\x7f]/.test(draft.password||''))return '密码不能包含控制字符，且最多 255 字节';
  return null;
}
const KEY='claudedone.profiles-demo.v1';
let demo:BrowserProfile[]|null=null;
const name={chrome:'Chrome',edge:'Edge',firefox:'Firefox'};
function data():BrowserProfile[] {
  if(demo)return demo;
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(Array.isArray(saved)){demo=saved.map(p=>({...p,running:false}));return demo!;}}catch{ /* recover demo data */ }
  demo=(['chrome','edge','firefox'] as BrowserId[]).map(browser=>({...defaults(),id:`legacy-${browser}`,name:`默认 ${name[browser]}`,browser,tags:['默认'],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deletedAt:null,lastTest:null,legacy:true,running:false,pendingRestart:false,browserAvailable:true,hasPassword:false,proxyReady:true}));return demo;
}
function saveDemo(){try{localStorage.setItem(KEY,JSON.stringify(data().map(({...p})=>p)));}catch{throw new Error('演示存储已满，无法保存');}}
function get(id:string){const p=data().find(p=>p.id===id);if(!p)throw new Error('副本不存在');return p;}
export async function listProfiles():Promise<BrowserProfile[]> {if(native)return invoke('list_profiles');return structuredClone(data());}
export async function saveProfile(draft:ProfileDraft,id?:string,copyId?:string):Promise<BrowserProfile> {
  const failure=validateDraft(draft);if(failure)throw new Error(failure);
  if(native)return invoke('save_profile',{id:id??null,draft,copyId:copyId??null});
  const clean=structuredClone(draft);delete clean.password;delete clean.proxy.credentialRef;
  const p=id?get(id):{...clean,id:crypto.randomUUID().replaceAll('-',''),createdAt:new Date().toISOString(),deletedAt:null,lastTest:null,legacy:false,running:false,pendingRestart:false,browserAvailable:true,hasPassword:false,proxyReady:true,updatedAt:''};
  const running=p.running;const changed=JSON.stringify(p.proxy)!==JSON.stringify(clean.proxy)||JSON.stringify(p.preferences)!==JSON.stringify(clean.preferences);
  const savedPassword=p.hasPassword;
  Object.assign(p,clean,{updatedAt:new Date().toISOString(),lastTest:null,pendingRestart:running&&changed,hasPassword:!draft.clearPassword&&(Boolean(draft.password)||savedPassword||Boolean(copyId&&get(copyId).hasPassword))});
  if(!id)data().push(p);saveDemo();return structuredClone(p);
}
export async function testProxy(draft?:ProfileDraft,id?:string):Promise<ProxyTest> {if(native)return invoke('test_profile_proxy',{draft:draft??null,id:id??null});await new Promise(r=>setTimeout(r,400));const result={ip:'203.0.113.24',country:'SG',latency:328,checkedAt:new Date().toISOString(),connection:'演示结果，未连接真实代理',target:'claude.ai HTTP 200（演示）'};if(id&&!draft){get(id).lastTest=result;saveDemo();}return result;}
export async function startProfile(id:string){if(native)return invoke<void>('start_profile',{id});get(id).running=true;get(id).pendingRestart=false;saveDemo();}
export async function closeProfile(id:string){if(native)return invoke<void>('close_profile',{id});get(id).running=false;saveDemo();}
export async function restartProfile(id:string){if(native)return invoke<void>('restart_profile',{id});get(id).running=true;get(id).pendingRestart=false;saveDemo();}
export async function deleteProfile(id:string,purge=false){if(native)return invoke<void>('delete_profile',{id,purge});const p=get(id);if(p.running)throw new Error('请先关闭副本');if(purge){if(!p.deletedAt)throw new Error('请先移至最近删除');demo=data().filter(p=>p.id!==id);}else{p.deletedAt=new Date().toISOString();}saveDemo();}
export async function restoreProfile(id:string){if(native)return invoke<void>('restore_profile',{id});get(id).deletedAt=null;saveDemo();}
export async function quitApplication(closeProfiles:boolean){if(native)return invoke<void>('quit_application',{closeProfiles});if(!closeProfiles&&data().some(p=>p.running))throw new Error('仍有运行中的副本');for(const p of data())p.running=false;saveDemo();}

export async function prepareApplicationUpdate(){if(native)return invoke<void>('prepare_application_update');for(const p of data())p.running=false;saveDemo();}
