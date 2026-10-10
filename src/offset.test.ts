import {afterEach, expect, it, vi} from 'vitest';
import {scanEnvironment, repairEnvironment} from './bridge';

afterEach(() => vi.unstubAllGlobals());

it('keeps the demo UTC+8 offset informational after selecting Singapore', async () => {
  vi.stubGlobal('location', {search:''});
  const initial = await scanEnvironment('edge');
  expect(initial.checks.find(c => c.id === 'offset')).toMatchObject({status:'healthy',fixable:false,value:'UTC+8'});
  await repairEnvironment('edge',['timezone'],true,'singapore');
  const after = await scanEnvironment('edge');
  expect(after.checks.find(c => c.id === 'offset')).toMatchObject({status:'healthy',fixable:false,value:'UTC+8'});
});
