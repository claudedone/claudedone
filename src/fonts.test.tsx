import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FontReview, fontResultSummary } from './FontDialogs';
it('does not preselect fonts or enable uninstall without explicit consent',()=>{
  const html=renderToStaticMarkup(<FontReview catalog={{items:[{id:'a',label:'用户字体',fileName:'a.otf',bytes:1}],protected:['simsun.ttc'],note:'范围'}} initialIds={[]} busy={false} onClose={()=>{}} onSubmit={()=>{}}/>);
  expect(html).not.toContain('checked=""'); expect(html).toContain('disabled=""');expect(html).toContain('simsun.ttc');expect(html).toContain('保留');
});
it('retries only fonts that failed rather than successful removals',()=>{
  expect(fontResultSummary([{id:'a',label:'a',success:true,message:''},{id:'b',label:'b',success:false,message:''}])).toEqual({completed:1,failed:['b']});
});
