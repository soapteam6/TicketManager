import { spawn } from 'node:child_process';
// Environment is supplied explicitly. No setup/reset/seed script touches data/app.db or .env.
const child = spawn(process.env.REVIEW_NODE_BINARY || process.execPath, ['packages/server/dist/review-demo.js'], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', LOCAL_MOCK_MODE: 'true', DATABASE_URL: ':memory:', DIRECTORY_PROVIDER: 'mock', JWT_SECRET: 'synthetic-review-no-auth-secret', JWT_REFRESH_SECRET: 'synthetic-review-no-refresh-secret' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1)));
child.on('error', (error) => { console.error('Could not start the isolated review API:', error.message); process.exit(1); });
