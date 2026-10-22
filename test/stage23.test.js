const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../lib/shopping');
const { diff } = require('../lib/alerts');
const calendar = require('../lib/calendar');
const helper = require('../lib/helper');
const perf = require('../lib/performance');

const item = (id, price, recent = false) => ({ id, brand: '탑텐', title: `상품${id}`, price, recent });

test('브랜드 피드: 첫날은 기준만, 다음 날 가격 하락은 할인·새 상품은 신상', () => {
  const h = {};
  let r = classify([item('a', 50000, true), item('b', 30000)], h, '2026-10-20', true);
  assert.deepStrictEqual([r.sales.length, r.launches.length], [0, 0]);
  r = classify([item('a', 40000, true), item('b', 29500), item('c', 19000, true)], h, '2026-10-21', false);
  assert.strictEqual(r.sales.length, 1);            // b는 1.7% 하락이라 제외
  assert.strictEqual(r.sales[0].pct, 20);
  assert.deepStrictEqual(r.launches.map((x) => x.id), ['c']);
  r = classify([item('c', 19000, true)], h, '2026-10-26', false);
  assert.strictEqual(r.launches.length, 0);         // 3일 지나면 신상 아님
});

test('저장 상품 알림: 가격 하락, 발행한 글 상품 품절, 재입고', () => {
  const board = { id: 'b1', title: '아우터', postStatus: '발행' };
  const p = { id: 'p1', name: '코트', price: 100000, soldOut: false, status: '발행 완료' };
  const a = diff(board, p, { price: 80000, soldOut: true });
  assert.deepStrictEqual(a.map((x) => x.kind), ['price_drop', 'fix_post']);
  assert.strictEqual(a[0].pct, 20);
  assert.deepStrictEqual(diff(board, { ...p, soldOut: true }, { price: 100000, soldOut: false }).map((x) => x.kind), ['restock']);
  assert.deepStrictEqual(diff(board, p, { price: null, soldOut: null }), []);
});

test('캘린더: 글·협찬 마감·여러 날 세일·할인 제안·기온 하강', () => {
  const db = {
    boards: [{ id: 'b1', title: '아우터', plannedDate: '2026-10-23', sponsorDeadline: '2026-10-25', postStatus: '촬영', products: [{ type: '협찬' }], checklist: {} }],
    events: [{ id: 'e1', type: 'sale', title: '가을 세일', start: '2026-10-22', end: '2026-10-24' }],
    alerts: [{ kind: 'price_drop', date: '2026-10-22', boardId: 'b1', productName: '코트', pct: 20 }],
  };
  const days = calendar.build(db, '2026-10-20', '2026-10-26', { '2026-10-23': { avg: 15 }, '2026-10-24': { avg: 10 } });
  assert.deepStrictEqual(days['2026-10-23'].map((x) => x.kind), ['post', 'event']);
  assert.strictEqual(days['2026-10-23'][0].sponsored, true);
  assert.strictEqual(days['2026-10-25'][0].kind, 'deadline');
  assert.strictEqual(days['2026-10-24'].filter((x) => x.kind === 'event')[0].first, false);
  assert.ok(days['2026-10-22'].some((x) => x.kind === 'suggest'));
  assert.ok(days['2026-10-24'].some((x) => x.kind === 'weather'));
  const empty = calendar.emptyDays(db.boards, [{ word: '니트' }], '2026-10-22');
  assert.strictEqual(empty.length, 6);
  assert.ok(!empty.some((d) => d.date === '2026-10-23'));
});

test('포스팅 도우미: 표, 제목·태그, 협찬·제휴 체크리스트', () => {
  const board = {
    title: '10월 출근룩', keyword: '트렌치코트', checklist: { priceDate: true },
    products: [
      { name: '싱글 트렌치', brand: '브랜드A', price: 129000, size: 'M', url: 'https://x/1', type: '협찬', priceCheckedAt: '2026-10-20' },
      { name: '롱 트렌치', brand: '브랜드B', price: 89000, url: 'https://x/2', type: '제휴 링크', soldOut: true },
    ],
  };
  const t = helper.productTable(board.products);
  assert.ok(t.html.includes('<table') && t.html.includes('129,000원') && t.html.includes('2026.10.20'));
  assert.strictEqual(t.text.split('\n').length, 4);
  assert.ok(helper.titleIdeas(board).some((x) => x.includes('2종')));
  assert.ok(helper.tagIdeas(board).includes('트렌치코트코디'));
  const c = helper.checklist(board);
  assert.deepStrictEqual(c.items.map((i) => i.key), ['affiliateLinks', 'disclosure', 'priceDate', 'images']);
  assert.ok(c.items[1].template.includes('브랜드A로부터 제품을 제공받아'));
  assert.ok(c.items[1].template.includes('수수료'));
  assert.strictEqual(c.done, false);
  assert.ok(c.warnings[0].includes('품절'));
});

test('성과: RSS 파싱, 순위 찾기, 주제별 요약', () => {
  const xml = `<rss><channel><item><author>me</author><category><![CDATA[패션]]></category>
    <title><![CDATA[10월 트렌치코트 코디 추천]]></title><link>https://blog.naver.com/mylog/223456789012?fromRss=true&amp;trackingCode=rss</link>
    <guid>https://blog.naver.com/mylog/223456789012</guid><pubDate>Wed, 21 Oct 2026 20:30:00 +0900</pubDate><tag><![CDATA[트렌치코트,코디]]></tag></item></channel></rss>`;
  const [p] = perf.parseRss(xml);
  assert.deepStrictEqual([p.logNo, p.title, p.pubDate, p.tags.length], ['223456789012', '10월 트렌치코트 코디 추천', '2026-10-21', 2]);
  assert.strictEqual(perf.normalizeBlogId('https://blog.naver.com/mylog'), 'mylog');
  const results = [{ link: 'https://blog.naver.com/other/1' }, { link: 'https://blog.naver.com/mylog/223456789012' }];
  assert.strictEqual(perf.findRank(results, 'mylog', '223456789012'), 2);
  assert.strictEqual(perf.findRank(results, 'mylog', '999999999'), null);
  const boards = [{ id: 'b1', title: '10월 트렌치코트 코디 추천', keyword: '트렌치코트' }];
  const posts = perf.merge([], [p], boards);
  assert.strictEqual(posts[0].boardId, 'b1');
  posts[0].views.push({ date: '2026-10-22', views: 120 });
  posts[0].ranks.push({ date: '2026-10-22', rank: 7 });
  assert.deepStrictEqual(perf.topicSummary(posts), [{ keyword: '트렌치코트', posts: 1, avgViews: 120, bestRank: 7 }]);
});
