const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-'));
const store = require('../lib/store');
const shopinsight = require('../lib/shopinsight');
const service = require('../lib/service');
const { autoPick } = require('../lib/analysis');

test('자동 키워드: 오르는 것 중 기온 맞는 것 우선, 꼭 포함·제외 키워드는 따로', () => {
  const screen = [
    { word: '무스탕', change: 80 }, // 15도엔 안 맞음(-5~8) → 80 × 0.2
    { word: '트위드자켓', change: 40 }, // 15도에 맞음
    { word: '수영복', change: 200 }, // 안 맞음 → 150(상한) × 0.2
    { word: '니트', change: 50 }, // 꼭 포함
    { word: '셋업', change: 30 },
    { word: '레깅스', change: -10 }, // 내려감
    { word: '볼캡', change: 35 }, // 계절 무관
  ];
  const picked = autoPick(screen, { avgTemp: 15, pinned: ['니트'], excluded: ['셋업'], n: 4 });
  // 제철(트위드자켓)과 계절 무관(볼캡)이 먼저, 철 지난 것은 아주 크게 올라야 뒤에 들어옴
  assert.deepStrictEqual(picked, ['트위드자켓', '볼캡', '수영복', '무스탕']);
});

test('활성 키워드 = 꼭 포함 + 자동 20개, 쇼핑인사이트 실패하면 꼭 포함만', async () => {
  const db = store.load();
  Object.assign(db.settings, { naverClientId: 'x', naverClientSecret: 'y', keywords: ['니트'], excludedKeywords: ['수영복'], autoKeywords: true });
  let screened = null;
  shopinsight.screenPool = async (s, words) => { screened = words; return words.map((w, i) => ({ word: w, change: 100 - i })); };
  const a = await service.activeKeywords();
  assert.ok(!screened.includes('수영복'));
  assert.strictEqual(a.auto.length, 20);
  assert.strictEqual(a.words[0], '니트');
  assert.ok(!a.auto.includes('니트'));

  db.settings.autoKeywords = false;
  assert.deepStrictEqual((await service.activeKeywords()).words, ['니트']);

  db.settings.autoKeywords = true;
  db.cache = {};
  shopinsight.screenPool = async () => { throw new Error('401'); };
  assert.deepStrictEqual(await service.activeKeywords(), { words: ['니트'], auto: [] });
});

test('사흘 넘은 캐시는 지움 (키워드가 바뀌어도 파일이 커지지 않게)', async () => {
  const db = store.load();
  db.cache = { 'trend:old': { date: store.kstDate(-5), data: 1 }, 'trend:recent': { date: store.kstDate(-1), data: 2 }, brandFeed: { date: store.kstDate(-9), brands: {} } };
  await store.cached('new', async () => 3);
  assert.deepStrictEqual(Object.keys(db.cache).sort(), ['brandFeed', 'new', 'trend:recent']);
});
