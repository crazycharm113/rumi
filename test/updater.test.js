const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { untar, safeRelative, KEEP } = require('../updater');

test('업데이트: GitHub 형식 tar.gz 풀기 (긴 경로 pax 헤더 포함)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const top = path.join(dir, 'crazycharm113-rumi-abc1234');
  const longDir = path.join(top, 'public', 'js', 'a'.repeat(60), 'b'.repeat(60));
  fs.mkdirSync(longDir, { recursive: true });
  fs.writeFileSync(path.join(top, 'server.js'), '// 서버');
  fs.writeFileSync(path.join(longDir, '긴파일.js'), 'x');
  execSync(`tar --format=pax -czf ${dir}/a.tgz -C ${dir} crazycharm113-rumi-abc1234`);
  const files = untar(zlib.gunzipSync(fs.readFileSync(`${dir}/a.tgz`)));
  const names = files.map((f) => safeRelative(f.name)).sort();
  assert.ok(names.includes('server.js'));
  assert.ok(names.includes(`public/js/${'a'.repeat(60)}/${'b'.repeat(60)}/긴파일.js`));
  assert.strictEqual(files.find((f) => f.name.endsWith('server.js')).data.toString(), '// 서버');
});

test('업데이트: 위험한 경로 거부, 내 데이터·실행 파일은 건드리지 않음', () => {
  assert.strictEqual(safeRelative('top/../etc/passwd'), null);
  assert.strictEqual(safeRelative('top/'), null);
  for (const rel of ['data/db.json', '.env', '실행하기.bat', '실행하기.command']) assert.ok(KEEP.some((re) => re.test(rel)), rel);
  assert.ok(!KEEP.some((re) => re.test('server.js')));
});
