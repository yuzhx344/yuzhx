import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';

const secret = () => randomBytes(20).toString('base64url');
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fleetops-api-'));
  const filename = join(dir, 'db.sqlite');
  let service, server, base;
  const start = async () => { service = createApp({ filename, ...options }); server = service.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; };
  const stop = async () => { await new Promise(resolve => server.close(resolve)); service.db.close(); };
  await start(); t.after(async () => { await stop(); rmSync(dir, {recursive:true,force:true}); });
  const client = () => {
    let cookie = '', csrf = '';
    return async (path, body, method = body ? 'POST' : 'GET', headers = {}) => {
      const response = await fetch(base + '/api' + path, {method,headers:{...(body ? {'Content-Type':'application/json'} : {}), Cookie:cookie,'X-CSRF-Token':csrf,...headers},...(body ? {body:JSON.stringify(body)} : {})});
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const data = await response.json(); if (data.csrf) csrf = data.csrf;
      return {status:response.status,data};
    };
  };
  const admin = client(), password = secret();
  const setup = await admin('/auth/setup',{workspace:'测试工作空间',name:'测试管理员',email:'admin@example.test',password,setupToken:options.setupToken});
  assert.equal(setup.status,201);
  const vehicle = await admin('/vehicles',{number:'TEST-001',group:'测试运营组',model:'测试车型',energy:'纯电',mileage:200});
  assert.equal(vehicle.status,201);
  const event = (extra = {}) => ({vehicleId:vehicle.data.id,category:'temperature',level:'高风险',description:'检查发现电池温度偏高，请安排诊断。',metric:'电池温度',observedValue:62,unit:'°C',normalRange:'20–45',...extra});
  return {admin,password,client,event,get db(){return service.db;},restart:async()=>{await stop();await start();}};
}
test('首次初始化、认证、CSRF 与来源检查',async t=>{
  const f=await fixture(t), anonymous=f.client();
  assert.equal((await anonymous('/bootstrap')).status,401);
  assert.equal((await anonymous('/auth/setup',{workspace:'另一空间'})).status,409);
  assert.equal((await f.admin('/vehicles',{number:'BAD-001'},'POST',{'X-CSRF-Token':'invalid'})).status,403);
  assert.equal((await f.admin('/vehicles',{number:'BAD-001'},'POST',{Origin:'https://external.example.test'})).status,403);
  const data=(await f.admin('/bootstrap')).data;
  assert.equal(data.incidents.length,0); assert.equal(data.vehicles.length,1);
  assert.ok(!JSON.stringify(data).includes('password_hash')); assert.ok(!JSON.stringify(data).includes('token_hash'));
});
test('真实四步处理、诊断字段、审核确认与不可变审计',async t=>{
  const f=await fixture(t); let d=(await f.admin('/incidents',f.event())).data;
  const user=(await f.admin('/bootstrap')).data.user;
  assert.equal((await f.admin(`/incidents/${d.id}/advance`,{version:d.version,note:'太短'})).status,422);
  d=(await f.admin(`/incidents/${d.id}/advance`,{version:d.version,note:'确认问题并安排负责人开始诊断。',ownerId:user.id})).data;
  assert.equal(d.step,1);
  assert.equal((await f.admin(`/incidents/${d.id}/advance`,{version:d.version,note:'原因尚未确认不能推进。'})).status,422);
  d=(await f.admin(`/incidents/${d.id}/advance`,{version:d.version,note:'完成现场核验，诊断信息已确认。',cause:'冷却回路存在堵塞情况。',diagnosis:'检查确认冷却循环不畅导致升温。',solution:'清理冷却回路并复测。'})).data;
  assert.equal(d.step,2);assert.equal(d.cause,'冷却回路存在堵塞情况。');
  d=(await f.admin(`/incidents/${d.id}/advance`,{version:d.version,note:'已清理回路，复测温度保持正常。',resolvedValue:38})).data;
  assert.equal(d.step,3);assert.equal(d.resolvedValue,38);
  assert.equal((await f.admin(`/incidents/${d.id}/advance`,{version:d.version,note:'确认所有处理结果符合要求。',verified:false})).status,422);
  d=(await f.admin(`/incidents/${d.id}/advance`,{version:d.version,note:'确认所有处理结果符合要求。',verified:true})).data;
  assert.equal(d.step,4);assert.ok(d.closedAt);assert.equal(d.history.length,5);
  assert.ok(d.history.every(e=>e.actor==='测试管理员'));
  assert.throws(()=>f.db.prepare('UPDATE audit SET text=?').run('篡改'),/audit is immutable/);
  assert.throws(()=>f.db.prepare('DELETE FROM audit').run(),/audit is immutable/);
  assert.equal((await f.admin(`/incidents/${d.id}/advance`,{version:d.version,note:'归档后不能继续修改。'})).status,409);
});
test('两个会话的版本冲突与重启后持久化',async t=>{
  const f=await fixture(t), other=f.client();
  assert.equal((await other('/auth/login',{email:'admin@example.test',password:f.password})).status,200);
  const original=(await f.admin('/incidents',f.event())).data,user=(await f.admin('/bootstrap')).data.user;
  const advanced=await f.admin(`/incidents/${original.id}/advance`,{version:original.version,note:'已受理并安排后续检查。',ownerId:user.id});
  assert.equal(advanced.status,200);
  assert.equal((await other(`/incidents/${original.id}/advance`,{version:original.version,note:'旧记录不能覆盖最新处理结果。',ownerId:user.id})).status,409);
  await f.restart();const restored=(await other(`/incidents/${original.id}`)).data;
  assert.equal(restored.step,1);assert.equal(restored.history.length,2);
});
test('管理员、处理人员、只读人员权限在服务端生效',async t=>{
  const f=await fixture(t), opPassword=secret(), viewerPassword=secret();
  const opId=(await f.admin('/users',{name:'测试处理人员',email:'operator@example.test',password:opPassword,role:'operator'})).data.id;
  await f.admin('/users',{name:'测试只读人员',email:'viewer@example.test',password:viewerPassword,role:'viewer'});
  const op=f.client(), viewer=f.client();await op('/auth/login',{email:'operator@example.test',password:opPassword});await viewer('/auth/login',{email:'viewer@example.test',password:viewerPassword});
  assert.equal((await viewer('/bootstrap')).status,200);assert.equal((await viewer('/incidents',f.event())).status,403);
  assert.equal((await op('/users',{name:'越权创建'})).status,403);
  const d=(await f.admin('/incidents',f.event())).data,adminId=(await f.admin('/bootstrap')).data.user.id;
  assert.equal((await op(`/incidents/${d.id}/advance`,{version:d.version,note:'只能为自己认领任务。',ownerId:adminId})).status,403);
  assert.equal((await op(`/incidents/${d.id}/advance`,{version:d.version,note:'本人认领并安排检查。',ownerId:opId})).status,200);
  assert.equal((await f.admin(`/users/${opId}`,{active:false},'PATCH')).status,409);
  assert.equal((await f.admin(`/users/${adminId}`,{role:'viewer'},'PATCH')).status,409);
});
test('导入原子性与请求重试去重',async t=>{
  const f=await fixture(t), key=secret();
  assert.equal((await f.admin('/incidents/import',{items:[f.event(),f.event({vehicleId:'missing'})]},'POST',{'Idempotency-Key':key})).status,422);
  assert.equal((await f.admin('/bootstrap')).data.incidents.length,0);
  const first=await f.admin('/incidents/import',{items:[f.event(),f.event()]},'POST',{'Idempotency-Key':key});assert.equal(first.status,201);
  const repeated=await f.admin('/incidents/import',{items:[f.event(),f.event()]},'POST',{'Idempotency-Key':key});assert.deepEqual(repeated.data,first.data);
  assert.equal((await f.admin('/bootstrap')).data.incidents.length,2);
  assert.equal((await f.admin('/incidents/import',{items:[f.event()]},'POST',{'Idempotency-Key':key})).status,409);
  const singleKey=secret(), singleBody=f.event();
  const original=await f.admin('/incidents',singleBody,'POST',{'Idempotency-Key':singleKey});
  const retry=await f.admin('/incidents',singleBody,'POST',{'Idempotency-Key':singleKey});
  assert.equal(original.data.id,retry.data.id);assert.equal((await f.admin('/bootstrap')).data.incidents.length,3);
});
test('一致性备份与离线恢复脚本保留记录并撤销会话',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'fleetops-backup-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const filename=join(dir,'live.sqlite'),backup=join(dir,'backup.sqlite'),restored=join(dir,'restored.sqlite');
  const {db}=createApp({filename});
  db.prepare('INSERT INTO workspace(id,name,created_at) VALUES(1,?,?)').run('备份测试空间',Date.now());
  db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run('u1','backup@example.test','备份测试人员','hash','admin',Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('token','u1','csrf',Date.now()+3600000);
  const run=(file,args,target)=>spawnSync(process.execPath,[file,...args],{env:{...process.env,FLEETOPS_DB:target},encoding:'utf8'});
  const result=run('scripts/backup.mjs',[backup],filename);assert.equal(result.status,0,result.stderr);db.close();
  assert.equal(run('scripts/backup.mjs',[backup],filename).status,1);
  assert.equal(run('scripts/restore.mjs',[backup],restored).status,1);
  const restore=run('scripts/restore.mjs',['--service-stopped',backup],restored);assert.equal(restore.status,0,restore.stderr);
  const check=new DatabaseSync(restored,{readOnly:true});assert.equal(check.prepare('SELECT name FROM workspace').get().name,'备份测试空间');assert.equal(check.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);check.close();
});
test('账号草稿隔离、偏好保存、密码变更与会话注销',async t=>{
  const f=await fixture(t), d=(await f.admin('/incidents',f.event())).data;
  await f.admin(`/incidents/${d.id}/draft`,{version:d.version,note:'尚未提交的本人处理说明。'},'PUT');
  await f.admin('/preferences',{compact:true},'PATCH');
  const data=(await f.admin('/bootstrap')).data;assert.ok(data.incidents[0].draft);assert.equal(data.settings.compact,true);
  const other=f.client();await other('/auth/login',{email:'admin@example.test',password:f.password});
  const newPassword=secret();assert.equal((await f.admin('/auth/password',{currentPassword:f.password,password:newPassword})).status,200);
  assert.equal((await other('/bootstrap')).status,401);
  assert.equal((await f.admin('/auth/logout',{})).status,200);assert.equal((await f.admin('/bootstrap')).status,401);
});
test('生产首次初始化需要部署令牌',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'fleetops-prod-')),token=secret();
  const {app,db}=createApp({filename:join(dir,'db.sqlite'),production:true,setupToken:token,origin:'https://fleet.example.test'});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});});
  const request=async setupToken=>fetch(`http://127.0.0.1:${server.address().port}/api/auth/setup`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://fleet.example.test'},body:JSON.stringify({workspace:'测试企业',name:'测试管理员',email:'admin@example.test',password:secret(),setupToken})});
  assert.equal((await request('invalid')).status,403);const result=await request(token);assert.equal(result.status,201);assert.match(result.headers.get('set-cookie'),/Secure/);assert.match(result.headers.get('set-cookie'),/HttpOnly/);
});
