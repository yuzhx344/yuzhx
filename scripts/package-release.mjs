import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, cpSync, readdirSync, statSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const {version}=JSON.parse(readFileSync('package.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('版本号无效。');
mkdirSync('release',{recursive:true});
const name=`fleetops-${version}.tar.gz`,destination=`release/${name}`;
// Explicit allowlist excludes databases, sessions, deployment secrets, environment files and test traces.
const files=['README.md','Start-Windows.cmd','Start-Mac.command','package.json','package-lock.json','index.html','.gitignore','.dockerignore','Dockerfile','playwright.config.js','src','server','scripts','tests','dist','deploy/compose.yaml','deploy/Caddyfile','deploy/.env.example','deploy/node.env.example','deploy/fleetops.service'];
execFileSync('tar',['-czf',destination,'--owner=0','--group=0','--mode=u+rwX,go+rX','--transform=s,^,fleetops/,',...files]);
const checksum=createHash('sha256').update(readFileSync(destination)).digest('hex');
writeFileSync(destination+'.sha256',`${checksum}  ${name}\n`);
const staging=mkdtempSync(join(tmpdir(),'fleetops-package-'));
try {
  const folder=join(staging,'fleetops');mkdirSync(folder);
  for(const path of files){const target=join(folder,path);mkdirSync(join(target,'..'),{recursive:true});cpSync(path,target,{recursive:true});}
  const normalize=path=>{const info=statSync(path);chmodSync(path,info.isDirectory()||info.mode&0o111?0o755:0o644);if(info.isDirectory())for(const name of readdirSync(path))normalize(join(path,name));};
  normalize(folder);
  const zipName=`fleetops-${version}.zip`,zipPath=resolve('release',zipName);rmSync(zipPath,{force:true});
  execFileSync('zip',['-rq',zipPath,'fleetops'],{cwd:staging});
  writeFileSync(zipPath+'.sha256',createHash('sha256').update(readFileSync(zipPath)).digest('hex')+'  '+zipName+'\n');
  console.log('部署包已生成：'+destination+' 和 release/'+zipName+'；附带 SHA-256 校验文件。');
} finally { rmSync(staging,{recursive:true,force:true}); }
