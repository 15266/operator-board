import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import path from 'node:path';
const dir=fileURLToPath(new URL('.',import.meta.url));const files=fs.readdirSync(dir).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>path.join(dir,n));
const result=spawnSync(process.execPath,['--experimental-strip-types','--test',...files],{stdio:'inherit'});process.exit(result.status??1);
