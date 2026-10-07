import { DatabaseSync } from 'node:sqlite';
import { existsSync, copyFileSync, renameSync, unlinkSync, chmodSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
process.umask(0o077);
if(process.argv[2]!=='--service-stopped')throw new Error('先停止应用，再运行：node scripts/restore.mjs --service-stopped 备份文件路径');
const source=resolve(process.argv[3]||''),target=resolve(process.env.FLEETOPS_DB||'var/fleetops.sqlite');
if(!existsSync(source)||source===target)throw new Error('备份文件不存在，或与目标数据库相同。');
const verify=new DatabaseSync(source,{readOnly:true});
try{if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||verify.prepare('PRAGMA user_version').get().user_version!==1)throw new Error('备份完整性或版本校验未通过。');verify.prepare('SELECT id FROM workspace').get();}finally{verify.close();}
mkdirSync(dirname(target),{recursive:true,mode:0o700});
if(existsSync(target)){const before=new DatabaseSync(target);try{before.prepare('VACUUM INTO ?').run(target+'.before-restore-'+Date.now());}finally{before.close();}}
const temporary=target+'.restore-'+Date.now();copyFileSync(source,temporary);chmodSync(temporary,0o600);
const clean=new DatabaseSync(temporary);clean.exec('DELETE FROM sessions');clean.close();
for(const suffix of ['-wal','-shm'])if(existsSync(target+suffix))unlinkSync(target+suffix);
renameSync(temporary,target);console.log('备份已恢复，恢复前数据库已另存；所有成员需重新登录。现在可以启动应用。');
