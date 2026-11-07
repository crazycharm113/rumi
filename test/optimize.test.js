const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opt-'));
const store = require('../lib/store');
const { pool } = require('../lib/util');
const celeb = require('../lib/celeb');

test('pool: 입력 순서대로 결과, 동시에 size 개까지만', async () => {
  let running = 0, peak = 0;
  const out = await pool([5, 1, 4, 2, 3, 6], 2, async (n) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  assert.deepStrictEqual(out, [50, 10, 40, 20, 30, 60]);
  assert.strictEqual(peak, 2);
  assert.deepStrictEqual(await pool([], 3, async () => 1), []);
});

test('saveSoon: 여러 번 불러도 한 번에 저장하고, save()가 바로 저장', async () => {
  const db = store.load();
  db.alerts = [{ id: 'a' }];
  store.saveSoon(20); store.saveSoon(20);
  const file = path.join(store.DATA_DIR, 'db.json');
  assert.ok(!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes('"a"'));
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(fs.readFileSync(file, 'utf8').includes('"id":"a"'));
  assert.ok(!fs.readFileSync(file, 'utf8').includes('\n  ')); // 들여쓰기 없이 저장
  db.alerts = [];
  store.saveSoon(5000);
  store.save(); // 바로 저장하면 예약은 취소
  assert.ok(!fs.readFileSync(file, 'utf8').includes('"a"'));
});

test('셀럽 화면: 착장이 수천 건이어도 빠르게 계산', () => {
  const db = store.load();
  db.settings.anthropicApiKey = 'x'; db.settings.naverClientId = 'a'; db.settings.naverClientSecret = 'b';
  const items = [];
  for (let i = 0; i < 3000; i++) {
    items.push({ id: `i${i}`, celeb: `사람${i % 200}`, item: `${['니트', '코트', '로퍼', '가방'][i % 4]}${i % 7}`, category: '상의', brand: '', product: '', situation: '공항패션', buzz: false, color: '', price: '', date: store.kstDate(-(i % 14)), title: `t${i}`, link: `l${i}` });
  }
  db.celeb = { items, seen: {}, lastRun: '', error: '', edits: {}, scores: {} };
  const t = Date.now();
  const v = celeb.view();
  assert.ok(v.hots.length > 100);
  assert.ok(Date.now() - t < 500, `view 가 ${Date.now() - t}ms 걸렸어요`); // 예전에는 약 2초
  db.celeb = null;
});
