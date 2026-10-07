import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
process.umask(0o077);
const source=process.env.FLEETOPS_DB||resolve('var/fleetops.sqlite');
if(!existsSync(source)) throw new Error('数据库不存在，备份未执行。');
const destination=resolve(process.argv[2]||`var/backups/fleetops-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
if(existsSync(destination)) throw new Error('目标文件已存在，备份不会覆盖文件。');
mkdirSync(dirname(destination),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});db.exec('PRAGMA busy_timeout=10000');
try { db.prepare('VACUUM INTO ?').run(destination);chmodSync(destination,0o600);console.log('一致性备份已创建：'+destination); } finally { db.close(); }
