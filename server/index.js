import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';

process.umask(0o077);
const production = process.env.NODE_ENV === 'production';
const setupToken = process.env.FLEETOPS_SETUP_TOKEN_FILE ? readFileSync(process.env.FLEETOPS_SETUP_TOKEN_FILE, 'utf8').trim() : process.env.FLEETOPS_SETUP_TOKEN || '';
if (production && !process.env.APP_ORIGIN?.startsWith('https://')) throw new Error('生产部署必须配置 https:// 开头的 APP_ORIGIN，并通过 HTTPS 网关访问。');
const { app, db } = createApp({ filename: process.env.FLEETOPS_DB || resolve('var/fleetops.sqlite'), production, setupToken, origin: process.env.APP_ORIGIN || '', trustProxy: process.env.TRUST_PROXY === '1' });
const server = app.listen(Number(process.env.APP_PORT || 3000), process.env.APP_HOST || '0.0.0.0', () => console.log('FleetOps server is ready.'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); });
