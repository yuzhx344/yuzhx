import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
const address=process.argv[2],filename=process.env.FLEETOPS_DB||resolve('var/fleetops.sqlite');
if(!address||!existsSync(filename)||!process.stdin.isTTY) throw new Error('在服务器终端运行：node scripts/reset-password.mjs 成员邮箱；密码通过隐藏输入读取。');
const db=new DatabaseSync(filename),user=db.prepare('SELECT id FROM users WHERE email=? AND active=1').get(address);
if(!user) throw new Error('有效成员不存在。');
process.stdout.write('输入新的密码（至少 12 字符，输入隐藏）：');
const muted=new Writable({write(chunk,encoding,callback){callback();}});
const input=createInterface({input:process.stdin,output:muted,terminal:true});
const password=await new Promise(resolve=>input.question('',resolve));input.close();process.stdout.write('\n');
if(password.length<12||password.length>128)throw new Error('密码长度必须为 12–128 字符。');
const salt=randomBytes(16).toString('hex'),key=await promisify(scrypt)(password,salt,64);
db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(`${salt}:${key.toString('hex')}`,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),null,user.id,'服务器管理员','服务器恢复账号密码','已重置密码并撤销全部登录会话','admin',Date.now());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
console.log('密码已更新，全部会话已退出。');
