const test = require('node:test');
const assert = require('node:assert');
const si = require('../lib/shopinsight');
const { intentOf, analyze } = require('../lib/analysis');
const store = require('../lib/store');

const s = { naverClientId: 'id', naverClientSecret: 'sec', naverKeyType: 'hub' };

// fetch 를 가로채 요청을 기록하고, 경로마다 정해 둔 응답을 돌려줍니다.
function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body, headers: opts.headers });
    return { ok: true, status: 200, json: async () => handler(url, body) };
  };
  return calls;
}

test('쇼핑인사이트 주소: API HUB와 기존 키', () => {
  assert.strictEqual(si.endpoint(s, 'category/keywords'), 'https://naverapihub.apigw.ntruss.com/shopping/v1/category/keywords');
  assert.strictEqual(si.endpoint({ ...s, naverKeyType: 'legacy' }, 'categories'), 'https://openapi.naver.com/v1/datalab/shopping/categories');
});

test('1) 구매 관심도: 분야별로 5개씩 묶어 부르고 7일 변화 계산', async () => {
  const days = Array.from({ length: 14 }, (_, i) => store.kstDate(-14 + i));
  const calls = mockFetch((url, body) => ({
    results: body.keyword.map((k) => ({ title: k.name, data: days.map((d, i) => ({ period: d, ratio: i < 7 ? 10 : 15 })) })),
  }));
  const r = await si.buyingInterest(s, ['니트', '가디건', '부츠', '셔켓', '맨투맨', '후드집업', '블레이저'], '30');
  assert.strictEqual(r['니트'].shopChange, 50);
  assert.strictEqual(r['부츠'].shopChange, 50);
  const cats = calls.map((c) => c.body.category);
  assert.deepStrictEqual(cats.sort(), ['50000000', '50000000', '50000001']); // 의류 6개 → 2번, 잡화 1개 → 1번
  assert.deepStrictEqual(calls[0].body.ages, ['30']);
  assert.strictEqual(calls[0].headers['X-NCP-APIGW-API-KEY-ID'], 'id');
});

test('2) 작년 정점: 뚜렷한 정점만, 올해 같은 요일로 옮기고 2주 전 준비', async () => {
  mockFetch((url, body) => ({
    results: body.keyword.map((k) => ({
      title: k.name,
      data: Array.from({ length: 17 }, (_, i) => ({
        period: new Date(Date.parse(body.startDate) + i * 7 * 864e5).toISOString().slice(0, 10),
        ratio: k.name === '롱패딩' ? (i === 6 ? 100 : 20) : 50,
      })),
    })),
  }));
  const peaks = await si.lastYearPeaks(s, ['롱패딩', '니트']);
  assert.deepStrictEqual(Object.keys(peaks), ['롱패딩']);
  const p = peaks['롱패딩'];
  assert.strictEqual(new Date(p.peak).getDay(), new Date(p.lastYear).getDay());
  assert.strictEqual((Date.parse(p.peak) - Date.parse(p.prepare)) / 864e5, 14);
  assert.strictEqual(p.rise, 400);
});

test('3) 타깃 독자: 성별·연령 비중 요약', async () => {
  mockFetch((url) => ({
    results: [{ data: url.endsWith('gender')
      ? [{ group: 'f', ratio: 70 }, { group: 'm', ratio: 30 }]
      : [{ group: '20', ratio: 20 }, { group: '30', ratio: 50 }, { group: '40', ratio: 30 }] }],
  }));
  const a = await si.audience(s, '셔켓');
  assert.strictEqual(a.label, '30대 여성');
  assert.strictEqual(a.female, 70);
  assert.strictEqual(a.topAge.share, 50);
  assert.strictEqual(si.summarizeAudience({ f: 50, m: 50 }, {}).label, '고르게 분포');
});

test('4) 새로 뜨는 아이템: 지켜보는 키워드 제외, 클릭 드문 것 제외, 오른 것만', async () => {
  const days = Array.from({ length: 14 }, (_, i) => store.kstDate(-14 + i));
  mockFetch((url, body) => ({
    results: body.keyword.map((k, j) => ({
      title: k.name,
      data: j === 1 ? [{ period: days[13], ratio: 100 }] : days.map((d, i) => ({ period: d, ratio: j === 0 ? (i < 7 ? 10 : 30) : 20 })),
    })),
  }));
  const items = await si.discover(s, ['무스탕']);
  assert.ok(!items.some((x) => x.word === '무스탕'));
  assert.ok(items.every((x) => x.change > 0));
  assert.ok(items.length > 0 && items[0].change === 200);
});

test('구매 의도 판단과 점수 반영', () => {
  assert.strictEqual(intentOf(20, 30), 'buy');
  assert.strictEqual(intentOf(20, 0), 'info');
  assert.strictEqual(intentOf(20, null), null);
  const series = [...Array(7).fill(10), ...Array(7).fill(12)];
  const [withShop] = analyze({ 니트: { series, anchorAvg: 10 } }, { 니트: 1000 }, { 니트: { shopChange: 80, hasClicks: true } });
  const [noShop] = analyze({ 니트: { series, anchorAvg: 10 } }, { 니트: 1000 });
  assert.ok(withShop.score > noShop.score);
  assert.strictEqual(withShop.intent, 'buy');
});
