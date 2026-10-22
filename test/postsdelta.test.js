const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-'));
const store = require('../lib/store');
const naver = require('../lib/naver');
const shopinsight = require('../lib/shopinsight');
const service = require('../lib/service');

test('블로그 글 수 전일 대비: 기록과 비교, 기록 없으면 비움, 며칠 비면 그만큼 표시', async () => {
  const db = store.load();
  Object.assign(db.settings, { naverClientId: 'x', naverClientSecret: 'y', keywords: ['니트', '셔켓'] });
  naver.trend = async (s, words) => Object.fromEntries(words.map((w) => [w, { series: Array(14).fill(10), anchorAvg: 10 }]));
  let counts = { 니트: 1000, 셔켓: 500 };
  naver.blogStats = async (s, w) => ({ total: counts[w], topDates: ['20250101', '20260101'] });
  shopinsight.buyingInterest = async () => ({});

  let r = await service.getKeywordRows();
  assert.ok(r.rows.every((x) => x.postsDelta === null)); // 첫날은 비교할 기록이 없음

  db.history.postCounts = { [store.kstDate(-1)]: { 니트: 940, 셔켓: 500 } };
  db.cache = {};
  r = await service.getKeywordRows();
  const by = Object.fromEntries(r.rows.map((x) => [x.word, x]));
  assert.strictEqual(by['니트'].postsDelta, 60);
  assert.strictEqual(by['셔켓'].postsDelta, 0);
  assert.strictEqual(by['니트'].postsDeltaDays, 1);
  assert.deepStrictEqual(db.history.postCounts[store.kstDate()], { 니트: 1000, 셔켓: 500 }); // 오늘 기록 저장

  db.history.postCounts = { [store.kstDate(-3)]: { 니트: 900 } };
  db.cache = {};
  r = await service.getKeywordRows();
  const n = r.rows.find((x) => x.word === '니트');
  assert.deepStrictEqual([n.postsDelta, n.postsDeltaDays], [100, 3]);
  assert.strictEqual(r.rows.find((x) => x.word === '셔켓').postsDelta, null);
});
