import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('./bridge',()=>({native:false}));
const storage=new Map<string,string>();
beforeEach(()=>{vi.resetModules();storage.clear();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});});
describe('browser profiles',()=>{
  it('parses encoded credentials, IPv6 and protocol defaults',async()=>{
    const {parseProxyUri}=await import('./browser-profiles');
    expect(parseProxyUri('socks5://user:p%40ss@[::1]:1081')).toEqual({proxy:{mode:'socks5',host:'::1',port:1081,username:'user'},password:'p@ss'});
    expect(parseProxyUri('https://proxy.example').proxy.port).toBe(443);
    for(const uri of ['file:///tmp','http://host/path','socks5://host:70000','http://host?x=1'])expect(()=>parseProxyUri(uri)).toThrow();
  });
  it('keeps credentials out of persistent demo data and copies settings into a new identity',async()=>{
    const api=await import('./browser-profiles');const draft=api.defaults();draft.name='one';draft.proxy={mode:'http',host:'localhost',port:8080,username:'u'};draft.password='TEST-SECRET-DO-NOT-SAVE';
    const one=await api.saveProfile(draft);const two=await api.saveProfile({...draft,name:'two',password:''},undefined,one.id);
    expect(two.id).not.toBe(one.id);expect(two.hasPassword).toBe(true);expect([...storage.values()].join('')).not.toContain(draft.password);
    await api.startProfile(one.id);await api.saveProfile({...draft,preferences:{...draft.preferences,language:'en-GB,en'}},one.id);
    expect((await api.listProfiles()).find(p=>p.id===one.id)?.pendingRestart).toBe(true);
    expect((await api.listProfiles()).find(p=>p.id===two.id)?.running).toBe(false);
  });
  it('requires closing and trashing before purge, supports restore, and preserves empty registry',async()=>{
    const api=await import('./browser-profiles');const p=(await api.listProfiles())[0];await api.startProfile(p.id);
    await expect(api.deleteProfile(p.id)).rejects.toThrow();await api.closeProfile(p.id);await expect(api.deleteProfile(p.id,true)).rejects.toThrow();
    await api.deleteProfile(p.id);await api.restoreProfile(p.id);expect((await api.listProfiles())[0].deletedAt).toBeNull();
    for(const p of await api.listProfiles()){await api.deleteProfile(p.id);await api.deleteProfile(p.id,true);}vi.resetModules();
    expect(await (await import('./browser-profiles')).listProfiles()).toEqual([]);
  });
  it('rejects malformed ports, startup URLs and control characters in credentials',async()=>{
    const {defaults,validateDraft}=await import('./browser-profiles');const d=defaults();d.name='valid';expect(validateDraft(d)).toBeNull();
    d.preferences.startupUrl='javascript:alert(1)';expect(validateDraft(d)).toBeTruthy();d.preferences.startupUrl='about:blank';d.password='x\nheader';expect(validateDraft(d)).toBeTruthy();
  });
});
