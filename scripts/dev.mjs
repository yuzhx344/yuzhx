import { createServer } from 'vite';
import { createApp } from '../server/app.js';
const { app, db } = createApp();
const backend = app.listen(3001, '127.0.0.1');
const vite = await createServer({ server: { host: '0.0.0.0', port: 3000, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } } } });
await vite.listen(); vite.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await vite.close(); backend.close(() => { db.close(); process.exit(0); }); });
