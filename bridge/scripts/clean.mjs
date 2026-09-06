import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const target=resolve(root,'dist');
if(target!==root+sep+'dist')throw new Error('Invalid build output directory');
await rm(target,{recursive:true,force:true});
