const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-'));
const store = require('../lib/store');
const naver = require('../lib/naver');
const perf = require('../lib/performance');
const report = require('../lib/report');
const { freshnessOf, pickTopics, analyze } = require('../lib/analysis');

test('1) 백업: 하루 한 번, 7개만 보관, 되돌리기와 가져오기 (지금 데이터는 먼저 백업)', () => {
  const db = store.load();
  db.boards.push({ id: 'b1', title: '원래 보드', products: [] });
  store.save();
  const dir = path.join(process.env.DATA_DIR, 'backup');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(dir, `db-2026-01-0${i}.json`), JSON.stringify({ settings: {}, boards: [{ id: `old${i}`, title: `옛 보드 ${i}`, products: [] }] }));
  store.backupToday();
  const list = store.listBackups();
  assert.strictEqual(list.length, 7);
  assert.strictEqual(list[0].date, store.kstDate());

  store.restoreBackup('db-2026-01-09.json');
  assert.deepStrictEqual(store.load().boards.map((b) => b.title), ['옛 보드 9']);
  const todays = JSON.parse(fs.readFileSync(path.join(dir, `db-${store.kstDate()}.json`), 'utf8'));
  assert.deepStrictEqual(todays.boards.map((b) => b.title), ['원래 보드']); // 되돌리기 전 데이터가 백업됨

  assert.throws(() => store.replaceAll({ hello: 1 }), /백업 파일이 아니/);
  store.replaceAll({ settings: { blogId: 'x' }, boards: [{ id: 'n', title: '가져온 보드', products: [] }] });
  assert.strictEqual(store.load().boards[0].title, '가져온 보드');
  assert.ok(Array.isArray(store.load().posts)); // 빠진 항목은 기본값으로 채움
});

test('1) 깨진 db.json 은 덮어쓰지 않고 따로 보관', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-'));
  fs.writeFileSync(path.join(dir, 'db.json'), '{ 깨진');
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, ['-e', "require('./lib/store').load(); require('./lib/store').save()"], { env: { ...process.env, DATA_DIR: dir }, cwd: path.join(__dirname, '..') });
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('db.broken-')));
});

test('4) 상위 글 나이: 중간 나이와 6개월 넘은 비율, 오래된 글이 많으면 주제 가산', () => {
  const f = freshnessOf(['20260101', '20250101', '20240101', '20261001'], '2026-10-22');
  assert.strictEqual(f.oldShare, 75);
  assert.ok(f.medianAge > 180);
  const series = Array(14).fill(10);
  const rows = analyze({ 니트: { series, anchorAvg: 10 }, 가디건: { series, anchorAvg: 10 } }, { 니트: 1000, 가디건: 1000 });
  rows.find((r) => r.word === '니트').freshness = { medianAge: 400, oldShare: 80 };
  rows.find((r) => r.word === '가디건').freshness = { medianAge: 10, oldShare: 0 };
  const topics = pickTopics(rows, null);
  assert.strictEqual(topics[0].word, '니트');
  assert.ok(topics[0].reasons.some((x) => x.text.includes('새 글 기회')));
});

test('2) 이미 쓴 주제는 뒤로, 이유에 표시', () => {
  const series = Array(14).fill(10);
  const rows = analyze({ 니트: { series, anchorAvg: 10 }, 가디건: { series, anchorAvg: 10 } }, { 니트: 100, 가디건: 1000 });
  const topics = pickTopics(rows, null, new Date(), 6, { 니트: { daysAgo: 3 } });
  assert.strictEqual(topics[0].word, '가디건');
  assert.strictEqual(topics[1].reasons[0].text, '3일 전에 쓴 주제');
  const planned = pickTopics(rows, null, new Date(), 6, { 니트: { planned: '2026-10-25' } });
  assert.strictEqual(planned.find((t) => t.word === '니트').reasons[0].text, '이미 10/25 발행 예정');
});

test('3) 누락 감시: 하루 지나도 안 보이면 누락 의심 알림 한 번, 보이면 노출됨', async () => {
  const db = store.load();
  db.settings.blogId = 'mylog';
  db.settings.naverClientId = 'x'; db.settings.naverClientSecret = 'y';
  db.alerts = [];
  db.posts = [
    { logNo: '111', title: '안 보이는 글', pubDate: store.kstDate(-2), views: [], ranks: [] },
    { logNo: '222', title: '보이는 글', pubDate: store.kstDate(-2), views: [], ranks: [] },
    { logNo: '333', title: '오늘 글', pubDate: store.kstDate(), views: [], ranks: [] },
  ];
  naver.searchBlog = async (s, q) => (q === '보이는 글' ? [{ link: 'https://blog.naver.com/mylog/222' }] : []);
  await perf.checkIndexing();
  const by = Object.fromEntries(db.posts.map((p) => [p.logNo, p.index.status]));
  assert.deepStrictEqual(by, { 111: 'missing', 222: 'ok', 333: 'pending' });
  assert.strictEqual(db.alerts.filter((a) => a.kind === 'not_indexed').length, 1);
  await perf.checkIndexing();
  assert.strictEqual(db.alerts.filter((a) => a.kind === 'not_indexed').length, 1); // 알림은 한 번만
});

test('9) 주간 리포트: 발행 글, 그 주에 늘어난 조회수, 잘된 주제, 다음 주 계획', () => {
  assert.strictEqual(report.mondayOf('2026-10-22'), '2026-10-19'); // 목 → 월
  assert.strictEqual(report.mondayOf('2026-10-25'), '2026-10-19'); // 일 → 같은 주 월
  assert.strictEqual(report.weekViews([{ date: '2026-10-10', views: 100 }, { date: '2026-10-15', views: 160 }, { date: '2026-10-18', views: 200 }], '2026-10-12', '2026-10-18'), 100);
  const db = {
    posts: [
      { title: 'A', link: 'a', pubDate: '2026-10-13', keyword: '니트', views: [{ date: '2026-10-18', views: 300 }], ranks: [{ date: '2026-10-15', rank: 4, keyword: '니트' }], index: { status: 'ok' } },
      { title: 'B', link: 'b', pubDate: '2026-10-16', keyword: '코트', views: [], ranks: [], index: { status: 'missing' } },
      { title: 'C', link: 'c', pubDate: '2026-09-01', keyword: '니트', views: [{ date: '2026-10-11', views: 50 }, { date: '2026-10-17', views: 90 }], ranks: [] },
    ],
    boards: [{ id: 'x', title: '다음 주 글', plannedDate: '2026-10-21', postStatus: '촬영' }],
  };
  const r = report.weekly(db, '2026-10-12', { peaks: { 패딩: { prepare: '2026-10-20', peak: '2026-11-03' } } });
  assert.deepStrictEqual(r.published.map((p) => p.title), ['A', 'B']);
  assert.strictEqual(r.totalViews, 340);
  assert.deepStrictEqual(r.topKeywords, [{ keyword: '니트', views: 340 }]);
  assert.strictEqual(r.ranks[0].rank, 4);
  assert.strictEqual(r.missing.length, 1);
  assert.strictEqual(r.viewsMissing, 1);
  assert.strictEqual(r.plans[0].title, '다음 주 글');
  assert.strictEqual(r.prepare[0].word, '패딩');
});
