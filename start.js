// 실행 순서: (이미 켜져 있으면 끄기) → 최신 버전 확인·업데이트 → 프로그램 시작 → (--open 이면) 브라우저 열기.
// 업데이트가 끝난 뒤에 server.js 를 불러오므로 새로 받은 코드로 바로 실행됩니다.
// --hidden 이면 창 없이 실행된 것이므로 기록을 data/app.log 에 남깁니다.
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const URL = `http://localhost:${PORT}`;

if (process.argv.includes('--hidden')) {
  const dir = path.join(__dirname, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'app.log');
  try { if (fs.statSync(file).size > 1e6) fs.renameSync(file, file + '.old'); } catch { /* 없음 */ }
  const write = (...args) => fs.appendFileSync(file, `[${new Date().toLocaleString('ko-KR')}] ${args.join(' ')}\n`);
  console.log = write;
  console.error = write;
  process.on('uncaughtException', (err) => { write('오류:', err.stack || err.message); process.exit(1); });
}

const { main: update } = require('./updater');

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// 이미 켜져 있는 프로그램이 있으면 꺼서, 새로 받은 버전으로 다시 켜지게 합니다.
async function stopRunning() {
  const alive = () => fetch(`${URL}/api/settings`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  if (!(await alive())) return;
  console.log('켜져 있던 프로그램을 끄고 다시 켜요.');
  await fetch(`${URL}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1500) }).catch(() => {});
  for (let i = 0; i < 20 && (await alive()); i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 300));
}

stopRunning()
  .then(update)
  .finally(() => require('./server').start(process.argv.includes('--open') ? openBrowser : null));
