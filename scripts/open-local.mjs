import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.umask(0o077);
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('请先安装 Node.js 24 或以上版本：https://nodejs.org/zh-cn/download');
  process.exit(1);
}
const runNpm = args => new Promise((resolve, reject) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('依赖安装或构建失败，请检查网络后重新启动。')));
});
const built = existsSync('dist/index.html');
if (!existsSync('node_modules/express/package.json') || (!built && !existsSync('node_modules/vite/package.json'))) {
  console.log('首次启动，正在安装运行组件，请稍候…');
  await runNpm(['ci', ...(built ? ['--omit=dev'] : []), '--no-audit', '--no-fund']);
}
if (!built) await runNpm(['run', 'build']);

const { createApp } = await import('../server/app.js');
mkdirSync('var', { recursive: true, mode: 0o700 });
const { app, db } = createApp({ filename: process.env.FLEETOPS_DB || resolve('var/fleetops.sqlite'), dist: resolve('dist') });
const firstPort = Number(process.env.FLEETOPS_LOCAL_PORT || 3000);
if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort > 65525) throw new Error('本机端口需为 1024–65525。');
let server;
for (let port = firstPort; port < firstPort + 10; port++) {
  try {
    server = await new Promise((resolve, reject) => {
      const candidate = app.listen(port, '127.0.0.1');
      candidate.once('listening', () => resolve(candidate));
      candidate.once('error', reject);
    });
    break;
  } catch (error) { if (error.code !== 'EADDRINUSE' || port === firstPort + 9) { db.close(); throw error; } }
}
const url = `http://localhost:${server.address().port}`;
console.log(`\n网站已启动：${url}\n浏览器会自动打开。请保持此窗口运行，关闭窗口后服务会停止。\n首次进入请创建工作空间和管理员账号。\n`);
if (process.env.FLEETOPS_NO_BROWSER !== '1') {
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'start', '""', url] : [url];
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const browser = spawn(command, args, { detached: true, stdio: 'ignore' });
  browser.once('error', () => console.log(`请手动在浏览器打开 ${url}`));
  browser.unref();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
