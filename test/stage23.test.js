const test = require('node:test');
const assert = require('node:assert');
const { pickPosts, markNew } = require('../lib/brandnews');
const naver = require('../lib/naver');
const { diff } = require('../lib/alerts');
const calendar = require('../lib/calendar');
const helper = require('../lib/helper');
const perf = require('../lib/performance');

test('네이버 API: 새 HUB 키와 기존 개발자센터 키의 주소·헤더', () => {
  const hub = { naverClientId: 'id', naverClientSecret: 'sec', naverKeyType: 'hub' };
  const legacy = { ...hub, naverKeyType: 'legacy' };
  assert.strictEqual(naver.endpoint(hub, 'trend'), 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search');
  assert.strictEqual(naver.endpoint(hub, 'blog', '?query=a'), 'https://naverapihub.apigw.ntruss.com/search/v1/blog?query=a');
  assert.strictEqual(naver.endpoint(legacy, 'trend'), 'https://openapi.naver.com/v1/datalab/search');
  assert.strictEqual(naver.headers(hub)['X-NCP-APIGW-API-KEY-ID'], 'id');
  assert.strictEqual(naver.headers(hub)['X-NCP-APIGW-API-KEY'], 'sec');
  assert.strictEqual(naver.headers(legacy)['X-Naver-Client-Id'], 'id');
});

test('브랜드 소식: 브랜드+주제어가 함께 나오는 최근 글만, 새 글 표시', () => {
  const posts = [
    { title: '탑텐 가을 세일 후기', description: '', link: 'a', postdate: '20261020' },
    { title: '세일 정보 모음', description: '여러 브랜드', link: 'b', postdate: '20261021' },
    { title: '탑텐 코디', description: '할인 받아서 샀어요', link: 'c', postdate: '20261021' },
    { title: '탑텐 세일', description: '', link: 'd', postdate: '20260901' },
  ];
  const picked = pickPosts(posts, '탑텐', ['세일', '할인'], '2026-10-08');
  assert.deepStrictEqual(picked.map((p) => p.link), ['c', 'a']);
  assert.strictEqual(picked[0].date, '2026-10-21');
  assert.deepStrictEqual(markNew(picked, new Set(['a'])).map((p) => p.isNew), [true, false]);
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
