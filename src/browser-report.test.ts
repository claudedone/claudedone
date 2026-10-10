import { describe, expect, it } from 'vitest';
import { offsetLabel, parseBrowserReport, withBrowserReport } from './browser-report';
import type { Scan } from './domain';
const report = () => ({schemaVersion:1,capturedAt:new Date().toISOString(),timezone:'Asia/Shanghai',offsetMinutes:-480,languages:['en-US','en'],locale:'en-US',fonts:['Microsoft YaHei','SimSun'],platform:'Windows'});
describe('actual browser report', () => {
  it('keeps computer timezone and offset separate from imported browser values', () => {
    const scan = {browserAvailable:true,checks:[{id:'timezone',status:'healthy',value:'UTC',detail:'System timezone',fixable:true},{id:'offset',status:'healthy',value:'UTC+0',detail:'System offset',fixable:true}]} as Scan;
    const computer = withBrowserReport(scan, parseBrowserReport(JSON.stringify(report())), 'computer')!;
    expect(computer.checks.map(c => c.value)).toEqual(['UTC','UTC+0']);
    expect(withBrowserReport(scan, parseBrowserReport(JSON.stringify(report())))!.checks.map(c => c.value)).toEqual(['Asia/Shanghai','UTC+8']);
  });
  it('keeps timezone, language, locale, fonts, and UA inference separate', () => {
    const r = parseBrowserReport(JSON.stringify(report()));
    const scan = {browserAvailable:true,checks:['timezone','offset','language','locale','fonts','emoji'].map(id => ({id,status:'unknown',value:'pending',detail:'',fixable:false}))} as Scan;
    const result = withBrowserReport(scan,r)!;
    expect(result.checks.find(c => c.id === 'timezone')?.status).toBe('warning');
    expect(result.checks.find(c => c.id === 'language')?.status).toBe('healthy');
    expect(result.checks.find(c => c.id === 'locale')?.status).toBe('healthy');
    expect(result.checks.find(c => c.id === 'fonts')?.fixable).toBe(false);
    expect(result.checks.find(c => c.id === 'emoji')?.value).toContain('UA 推断');
  });
  it('does not treat Singapore as a change to UTC+8', () => {
    const r = parseBrowserReport(JSON.stringify({...report(),timezone:'Asia/Singapore'}));
    const scan = {checks:[{id:'timezone'},{id:'offset'}]} as Scan;
    expect(withBrowserReport(scan,r)?.checks.map(c => c.status)).toEqual(['healthy','warning']);
  });
  it('rejects malformed, excessive, or unsupported reports', () => {
    for(const text of ['invalid','null',JSON.stringify({...report(),offsetMinutes:2000}),JSON.stringify({...report(),timezone:'invalid'}),JSON.stringify({...report(),languages:[]}),JSON.stringify({...report(),schemaVersion:2}),JSON.stringify({...report(),fonts:Array(65).fill('font')})]) expect(() => parseBrowserReport(text)).toThrow();
    expect(() => parseBrowserReport(' '.repeat(16385))).toThrow();
  });
  it('preserves non-hour offsets and the JavaScript offset sign', () => {
    expect(offsetLabel(-480)).toBe('UTC+8'); expect(offsetLabel(-330)).toBe('UTC+5:30'); expect(offsetLabel(210)).toBe('UTC-3:30'); expect(offsetLabel(0)).toBe('UTC+0');
  });
  const extended = () => ({...report(),schemaVersion:2,browser:'edge',webgl:'ANGLE (NVIDIA, Direct3D11)',screen:{width:2560,height:1440,pixelRatio:1.5},network:{supported:true,effectiveType:'4g',downlink:10,rtt:50,saveData:false},plugins:{count:5,hardwareConcurrency:32,pdfViewerEnabled:true},privacy:{dnt:'1',gpc:null}});
  it('validates profile ownership markers and actual browser exit values',()=>{
    const id='a'.repeat(32);const r=parseBrowserReport(JSON.stringify({...extended(),profileId:id,exit:{ip:'203.0.113.5',country:'SG'}}));
    expect(r.profileId).toBe(id);expect(r.exit?.ip).toBe('203.0.113.5');
    for(const extra of [{profileId:'../../path'},{exit:{ip:'<script>',country:'SG'}},{exit:{ip:'203.0.113.1',country:'unknown'}}])expect(()=>parseBrowserReport(JSON.stringify({...extended(),...extra}))).toThrow();
    const scan={browser:'edge',checks:[{id:'route'}]} as Scan;expect(withBrowserReport(scan,r)?.ip).toBe('203.0.113.5');
  });
  it('distinguishes unsupported GPC from disabled and does not label hardware a fault', () => {
    const scan={browser:'edge',browserAvailable:true,checks:['webgl','screen','networkInfo','plugins','tracking'].map(id=>({id,status:'unknown'}))} as Scan;
    const result=withBrowserReport(scan,parseBrowserReport(JSON.stringify(extended())))!;
    expect(result.checks.every(c=>c.status==='healthy')).toBe(true);
    expect(result.checks.find(c=>c.id==='tracking')?.value).toContain('不支持 / 未提供');
    expect(result.checks.find(c=>c.id==='networkInfo')?.value).toContain('估计');
    expect(result.checks.find(c=>c.id==='plugins')?.value).toContain('逻辑处理器提示');
  });
  it('does not apply another dedicated browser report', () => {
    const scan: Scan={browser:'chrome',browserAvailable:true,checks:[],platform:'Windows',profilePath:'test',checkedAt:new Date().toISOString(),ip:null,location:null,latency:null,cliInstalled:false};
    expect(withBrowserReport(scan,parseBrowserReport(JSON.stringify(extended())))).toBe(scan);
  });
  it('rejects missing or out-of-range extended fields and retains old report compatibility', () => {
    for(const r of [{...extended(),screen:{width:1,height:1,pixelRatio:0}},{...extended(),privacy:{dnt:null,gpc:'off'}},{...extended(),webgl:'x'.repeat(1025)},{...extended(),browser:'unknown'},{...extended(),network:null}]) expect(()=>parseBrowserReport(JSON.stringify(r))).toThrow();
    expect(parseBrowserReport(JSON.stringify(report())).schemaVersion).toBe(1);
  });
  it('accepts Firefox GPC without DNT and retains actual font hits', () => {
    const r = parseBrowserReport(JSON.stringify({...extended(), browser:'firefox', privacy:{dnt:null,gpc:true}}));
    const scan={browser:'firefox', browserAvailable:true, checks:[{id:'tracking',fixable:true},{id:'fonts',fixable:true}]} as Scan;
    const actual=withBrowserReport(scan,r)!;
    expect(actual.checks.find(c=>c.id==='tracking')?.status).toBe('healthy');
    expect(actual.checks.find(c=>c.id==='fonts')?.value).toContain('Microsoft YaHei');
    expect(actual.checks.find(c=>c.id==='fonts')?.status).toBe('manual');
    expect(actual.checks.find(c=>c.id==='fonts')?.fixable).toBe(true);
  });
});
