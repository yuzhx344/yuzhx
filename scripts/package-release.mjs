import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const {version}=JSON.parse(readFileSync('package.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('版本号无效。');
mkdirSync('release',{recursive:true});
const name=`fleetops-${version}.tar.gz`,destination=`release/${name}`;
// Explicit allowlist excludes databases, sessions, deployment secrets, environment files and test traces.
execFileSync('tar',['-czf',destination,'--owner=0','--group=0','--mode=u+rwX,go+rX','--transform=s,^,fleetops/,','README.md','package.json','package-lock.json','index.html','.gitignore','.dockerignore','Dockerfile','playwright.config.js','src','server','scripts','tests','dist','deploy/compose.yaml','deploy/Caddyfile','deploy/.env.example','deploy/node.env.example','deploy/fleetops.service']);
const checksum=createHash('sha256').update(readFileSync(destination)).digest('hex');
writeFileSync(destination+'.sha256',`${checksum}  ${name}\n`);
console.log('部署包已生成：'+destination+'；附带 SHA-256 校验文件。');
