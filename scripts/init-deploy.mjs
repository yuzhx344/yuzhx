import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const domain = process.argv[2];
if (!domain || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) || domain.endsWith('.example') || domain.endsWith('.test')) throw new Error('请提供企业实际可解析的域名，例如：node scripts/init-deploy.mjs fleet.company.com');
if (existsSync('deploy/.env')) throw new Error('deploy/.env 已存在。请直接查看并修改域名；脚本不会覆盖部署配置。');
mkdirSync('deploy/secrets', {recursive:true,mode:0o700}); chmodSync('deploy/secrets',0o700);
// The directory is private on the host; Docker's non-root process must read the mounted secret file.
if (!existsSync('deploy/secrets/setup-token.txt')) writeFileSync('deploy/secrets/setup-token.txt',randomBytes(32).toString('base64url')+'\n',{mode:0o444,flag:'wx'});
chmodSync('deploy/secrets/setup-token.txt',0o444);
writeFileSync('deploy/.env',`APP_DOMAIN=${domain.toLowerCase()}\n`,{mode:0o600,flag:'wx'});
console.log('部署配置已生成。初始化令牌位于 deploy/secrets/setup-token.txt；请仅在首次设置页面输入，不要发送到聊天或提交到版本库。');
