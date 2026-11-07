// 실행 순서: (이미 켜져 있으면 끄기) → 최신 버전 확인·업데이트 → 프로그램 시작 → (--open 이면) 브라우저 열기.
// 업데이트가 끝난 뒤에 server.js 를 불러오므로 새로 받은 코드로 바로 실행됩니다.
// --hidden 이면 창 없이 실행된 것이므로 기록을 data/app.log 에 남깁니다.
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const URL = `http://localhost:${PORT}`;

if (process.argv.includes('--hidden')) {
  // 창 없이 실행했을 때는 웹 페이지를 모두 닫으면 프로그램도 꺼집니다.
  process.env.AUTO_EXIT = '1';
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
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// 필요한 라이브러리(package.json 의 dependencies)가 바뀌었거나 없으면 npm 으로 한 번 설치합니다.
// 설치에 실패해도 프로그램은 켜지고, 그 라이브러리를 쓰는 기능(셀럽 착장)만 안내 문구를 보여줍니다.
function ensureDependencies() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const want = crypto.createHash('sha1').update(JSON.stringify(pkg.dependencies || {})).digest('hex');
  const marker = path.join(__dirname, 'node_modules', '.deps-hash');
  let have = '';
  try { have = fs.readFileSync(marker, 'utf8').trim(); } catch { /* 처음 */ }
  if (have === want) return;
  console.log('필요한 라이브러리를 설치하는 중이에요(처음 한 번, 1분 정도)…');
  const r = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: __dirname, shell: process.platform === 'win32', windowsHide: true, encoding: 'utf8', timeout: 5 * 60e3,
  });
  if (r.status === 0) {
    fs.writeFileSync(marker, want);
    console.log('라이브러리 설치 완료');
  } else {
    console.log(`라이브러리 설치 실패: ${(r.stderr || r.error?.message || '').slice(-500)}`);
  }
}

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
  .then(ensureDependencies, ensureDependencies)
  .finally(() => require('./server').start(process.argv.includes('--open') ? openBrowser : null));
