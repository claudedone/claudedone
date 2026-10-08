// Rasterize the original transparent VI symbols. No background is added.
// Usage: node scripts/generate-windows-icons.mjs
// Requires sharp (available in the bundled workspace runtime).
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const require=createRequire(import.meta.url);
const sharp=require(process.env.NODECLOAK_SHARP_PATH || 'sharp');
const root=fileURLToPath(new URL('../',import.meta.url));
const dest=path.join(root,'src-tauri','icons','windows');
mkdirSync(dest,{recursive:true});
for(const [name,source] of [['on-light','positive'],['on-dark','primary']]) {
  const svg=readFileSync(path.join(root,'public','brand',`symbol-${source}.svg`));
  for(const size of [32,128]) {
    const raster=sharp(svg,{density:384}).resize(size,size).ensureAlpha();
    writeFileSync(path.join(dest,`${name}-${size}.png`),await raster.clone().png().toBuffer());
    writeFileSync(path.join(dest,`${name}-${size}.rgba`),await raster.clone().raw().toBuffer());
  }
  // Windows loads the executable resource for shortcuts and before window setup.
  const sizes=[16,24,32,48,64,128,256];
  const frames=await Promise.all(sizes.map(size=>sharp(svg,{density:384}).resize(size,size).png().toBuffer()));
  const header=Buffer.alloc(6+16*frames.length);
  header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
  let offset=header.length;
  frames.forEach((frame,i)=>{
    const start=6+i*16,size=sizes[i];
    header[start]=size===256?0:size;header[start+1]=header[start];
    header.writeUInt16LE(1,start+4);header.writeUInt16LE(32,start+6);
    header.writeUInt32LE(frame.length,start+8);header.writeUInt32LE(offset,start+12);
    offset+=frame.length;
  });
  const ico=Buffer.concat([header,...frames]);
  writeFileSync(path.join(dest,`${name}.ico`),ico);
  if(name==='on-dark')writeFileSync(path.join(root,'src-tauri','icons','icon.ico'),ico);
}
