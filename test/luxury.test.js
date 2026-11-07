const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lux-'));
const sent = [];
let reply = null;
class FakeAnthropic {
  constructor(opts) { this.beta = { messages: { create: async (body) => { sent.push(body); return reply(body); } } }; }
}
FakeAnthropic.APIError = class extends Error {};
FakeAnthropic.AuthenticationError = class extends FakeAnthropic.APIError {};
FakeAnthropic.PermissionDeniedError = class extends FakeAnthropic.APIError {};
FakeAnthropic.RateLimitError = class extends FakeAnthropic.APIError {};
require.cache[require.resolve('@anthropic-ai/sdk')] = { exports: FakeAnthropic, loaded: true };

const store = require('../lib/store');
const naver = require('../lib/naver');
const shopinsight = require('../lib/shopinsight');
const luxury = require('../lib/luxury');
const { LUXURY_BRANDS } = require('../lib/catalog');

const series = (a, b) => [...Array(7).fill(a), ...Array(7).fill(b)];

test('목록: 검색 수준 순위, 7일 변화, 쇼핑 클릭, 추가 브랜드, 어제 대비 순위 변동', async () => {
  const db = store.load();
  Object.assign(db.settings, { naverClientId: 'x', naverClientSecret: 'y', luxuryExtra: ['토즈'] });
  const level = { 샤넬: [30, 30], 구찌: [20, 40], 토즈: [5, 5] }; // 최근 7일 평균: 샤넬 30, 구찌 40
  naver.trend = async (s, names) => Object.fromEntries(names.map((n) => [n, { series: series(...(level[n] || [1, 1])), anchorAvg: 20 }]));
  shopinsight.brandClicks = async (s, names) => Object.fromEntries(names.map((n) => [n, { series: [], change: n === '구찌' ? 50 : 0, hasClicks: n !== '토즈' }]));
  naver.blogStats = async () => ({ total: 1000, topDates: [], items: [] });
  const now = new Date().toUTCString();
  naver.newsStats = async (s, q) => ({ total: 9, items: [{ title: 'a', link: 'l', pubDate: now }, { title: 'b', link: 'l2', pubDate: new Date(Date.now() - 20 * 864e5).toUTCString() }] });

  // 어제 기록: 샤넬 1위, 구찌 2위
  db.history.luxRanks = { [store.kstDate(-1)]: ['샤넬', '구찌', '루이비통'] };
  const r = await luxury.list();
  assert.strictEqual(r.demo, false);
  assert.strictEqual(r.rows.length, LUXURY_BRANDS.length + 1);
  const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
  assert.strictEqual(by['구찌'].rank, 1); // 최근 7일 검색이 더 큰 구찌가 1위
  assert.strictEqual(by['구찌'].change, 100); // 20 → 40
  assert.strictEqual(by['구찌'].level, 200); // 40 ÷ 코디 20 × 100
  assert.strictEqual(by['구찌'].shopChange, 50);
  assert.strictEqual(by['토즈'].shopChange, null); // 클릭이 없으면 표시 안 함
  assert.strictEqual(by['토즈'].group, '추가');
  assert.deepStrictEqual([by['구찌'].move, by['샤넬'].move], [1, -1]); // 구찌 ▲1, 샤넬 ▼1
  assert.strictEqual(by['에르메스'].move, 'new');
  assert.strictEqual(by['샤넬'].news7, 1); // 20일 전 기사는 7일 기사에 안 셈
  assert.strictEqual(by['샤넬'].posts, 1000);
});

test('상세: 블로그·기사·타깃, Claude 제품·착용자 정리, 셀럽 착장 합치기, 정리는 따로 저장', async () => {
  const db = store.load();
  db.settings.anthropicApiKey = 'sk-test';
  db.celeb = { items: [{ id: 'c1', celeb: '배우 B', item: '가방', brand: '샤넬', product: '클래식 플랩', category: '가방', date: store.kstDate(), title: '배우 B 샤넬', link: 'https://n/c' }], seen: {}, edits: {}, scores: {} };
  naver.blogStats = async (s, q, n) => ({ total: 777, topDates: [], items: [{ title: '샤넬 클래식 플랩 가격', description: '요약', link: 'https://b/1', blogger: '블로거', postdate: '20261101' }] });
  const now = new Date().toUTCString();
  naver.newsStats = async () => ({ total: 55, items: [{ title: '배우 A, 샤넬 백 들고 공항', description: '배우 A가 샤넬 클래식 플랩백', link: 'https://n/1', pubDate: now }] });
  shopinsight.audience = async () => ({ female: 80, male: 20, ages: { 30: 40 }, topAge: { code: '30', label: '30대', share: 40 }, label: '30대 여성' });
  reply = (body) => {
    const text = body.messages[0].content;
    assert.ok(text.includes('브랜드: 샤넬') && text.includes('[0] 샤넬 클래식 플랩 가격') && text.includes('[1] 배우 A, 샤넬 백 들고 공항'));
    return { stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 300 }, content: [{ type: 'text', text: JSON.stringify({
      products: [{ name: '클래식 플랩백', item: '가방', price: '1,200만원', mentions: 4, sources: [0] }, { name: '가브리엘 백', item: '가방', price: '', mentions: 1, sources: [1] }],
      wearers: [{ celeb: '배우 A', product: '클래식 플랩백', source: 1 }, { celeb: '없는 글', product: 'x', source: 9 }],
    }) }] };
  };
  const d = await luxury.detail('샤넬');
  assert.strictEqual(d.row.name, '샤넬');
  assert.strictEqual(d.blogTotal, 777);
  assert.strictEqual(d.newsTotal, 55);
  assert.strictEqual(d.audience.label, '30대 여성');
  assert.deepStrictEqual(d.ai.products.map((p) => [p.name, p.mentions, p.source?.link]), [['클래식 플랩백', 4, 'https://b/1'], ['가브리엘 백', 1, 'https://n/1']]);
  assert.deepStrictEqual(d.ai.wearers.map((w) => w.celeb), ['배우 A']); // 근거 글이 없는 착용자는 뺌
  assert.deepStrictEqual(d.wearersFromCeleb.map((w) => w.celeb), ['배우 B']);
  assert.ok(sent.at(-1).system.includes('명품') && sent.at(-1).output_config.format.type === 'json_schema');

  const calls = sent.length;
  await luxury.detail('샤넬'); // 하루 안에는 Claude를 다시 부르지 않음
  assert.strictEqual(sent.length, calls);
  await assert.rejects(luxury.detail('없는브랜드'), /목록에 없는/);
});

test('Claude 정리가 실패해도 상세는 보이고 다시 시도 가능', async () => {
  const db = store.load();
  delete db.cache['lux:ai:구찌'];
  reply = () => ({ stop_reason: 'refusal', usage: {}, content: [] });
  const d = await luxury.detail('구찌');
  assert.strictEqual(d.ai, null);
  assert.match(d.aiError, /답하지 않았어요/);
  assert.ok(d.blogs.length > 0);
  assert.ok(!db.cache['lux:ai:구찌']); // 실패는 저장하지 않음
});

test('키가 없으면 예시 데이터', async () => {
  const db = store.load();
  Object.assign(db.settings, { naverClientId: '', naverClientSecret: '', anthropicApiKey: '' });
  const r = await luxury.list();
  assert.strictEqual(r.demo, true);
  assert.ok(r.rows.length >= 40 && r.rows[0].rank === 1);
  const d = await luxury.detail('디올');
  assert.strictEqual(d.demo, true);
  assert.ok(d.ai.products.length > 0);
});

test('동시 처리 도우미: 순서 유지, 동시 개수 제한', async () => {
  let running = 0, peak = 0;
  const out = await luxury.pool([1, 2, 3, 4, 5, 6], 2, async (n) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return n * 2; });
  assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.strictEqual(peak, 2);
});
