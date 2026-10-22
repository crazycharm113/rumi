const test = require('node:test');
const assert = require('node:assert');
const { toGrid, summarize, buildWeather } = require('../lib/weather');
const { analyze, pickTopics, rising, scoreOf, trendIndexOf, countMentions } = require('../lib/analysis');
const { parse } = require('../lib/product');
const { fill } = require('../lib/naver');
const { kstDate } = require('../lib/store');

test('기상청 격자 변환: 서울시청 = (60, 127)', () => {
  assert.deepStrictEqual(toGrid(37.5665, 126.978), { nx: 60, ny: 127 });
  assert.deepStrictEqual(toGrid(35.1796, 129.0756), { nx: 98, ny: 76 });
});

test('예보 요약: TMN/TMX와 평균', () => {
  const d = kstDate().replace(/-/g, '');
  const days = summarize([
    { fcstDate: d, fcstTime: '0600', category: 'TMN', fcstValue: '8.0' },
    { fcstDate: d, fcstTime: '1500', category: 'TMX', fcstValue: '18.0' },
    { fcstDate: d, fcstTime: '1200', category: 'SKY', fcstValue: '1' },
    { fcstDate: d, fcstTime: '1200', category: 'PTY', fcstValue: '0' },
  ]);
  assert.deepStrictEqual(days[kstDate()], { tmn: 8, tmx: 18, avg: 13, pop: 0, sky: '맑음' });
  const w = buildWeather(days, {});
  assert.strictEqual(w.clothing.label, '서늘함');
});

test('데이터랩 빈 날짜를 0으로 채움', () => {
  assert.deepStrictEqual(fill([{ period: '2026-10-02', ratio: 5 }], '2026-10-01', 3), [0, 5, 0]);
});

test('기회 점수: 관심이 같으면 글이 적을수록 높음', () => {
  assert.ok(scoreOf(150, 1000) > scoreOf(150, 100000));
  assert.strictEqual(trendIndexOf([...Array(7).fill(10), ...Array(7).fill(15)]), 150);
  assert.strictEqual(trendIndexOf([...Array(7).fill(0), ...Array(7).fill(3)]), 300);
});

test('주제 3개 고르기와 급상승 순위', () => {
  const up = [...Array(7).fill(10), ...Array(7).fill(20)];
  const flat = Array(14).fill(10);
  const rows = analyze(
    { 트렌치코트: { series: up, anchorAvg: 50 }, 반팔티: { series: up, anchorAvg: 50 }, 니트: { series: flat, anchorAvg: 50 }, 가디건: { series: flat, anchorAvg: 50 }, 희귀템: { series: Array(14).fill(0.1), anchorAvg: 50 } },
    { 트렌치코트: 5000, 반팔티: 5000, 니트: 200000, 가디건: 100000, 희귀템: 10 },
  );
  const weather = { today: { avg: 12 }, drop: null };
  const topics = pickTopics(rows, weather);
  assert.strictEqual(topics.length, 3);
  assert.strictEqual(topics[0].word, '트렌치코트'); // 시즌 맞음 → 반팔티보다 앞
  assert.ok(!topics.some((t) => t.word === '희귀템'));
  assert.ok(topics[0].reasons.some((r) => r.kind === 'season'));
  const r = rising(rows, ['니트', '트렌치코트']);
  assert.strictEqual(r[0].move === 1 || r[0].move === 'new', true);
});

test('블로거 아이템 집계', () => {
  const c = countMentions([{ title: '트렌치코트 자라 데일리룩', description: '' }, { title: '니트 코디', description: '자라' }]);
  assert.strictEqual(c.brands[0].word, '자라');
  assert.strictEqual(c.brands[0].count, 2);
});

test('상품 페이지 파싱: JSON-LD 우선, og 태그 보조', () => {
  const html = `<html><head><title>x</title>
    <meta property="og:image" content="/img/a.jpg">
    <meta property="og:site_name" content="몰">
    <script type="application/ld+json">{"@type":"Product","name":"울 블렌드 트렌치코트","brand":{"name":"브랜드A"},
      "offers":{"@type":"Offer","price":"129000","availability":"https://schema.org/InStock"}}</script>
    <meta property="product:original_price:amount" content="159000"></head></html>`;
  const p = parse(html, new URL('https://shop.example.com/p/1'));
  assert.deepStrictEqual(p, { name: '울 블렌드 트렌치코트', brand: '브랜드A', price: 129000, originalPrice: 159000, image: 'https://shop.example.com/img/a.jpg', soldOut: false });
});
