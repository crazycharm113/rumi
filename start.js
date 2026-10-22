// 실행 순서: 최신 버전 확인·업데이트 → 프로그램 시작 → (--open 이면) 브라우저 열기.
// 업데이트가 끝난 뒤에 server.js 를 불러오므로 새로 받은 코드로 바로 실행됩니다.
const { exec } = require('child_process');
const { main: update } = require('./updater');

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

update().finally(() => require('./server').start(process.argv.includes('--open') ? openBrowser : null));
