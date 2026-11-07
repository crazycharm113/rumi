const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-'));

// 실제 Anthropic 서버를 부르지 않도록 SDK 자리에 가짜를 넣고, 보낸 요청을 기록합니다.
const sent = [];
let reply = null;
class FakeAnthropic {
  constructor(opts) { this.opts = opts; this.beta = { messages: { create: async (body) => { sent.push({ body, key: opts.apiKey }); return reply(body); } } }; }
}
FakeAnthropic.APIError = class extends Error {};
FakeAnthropic.AuthenticationError = class extends FakeAnthropic.APIError {};
FakeAnthropic.PermissionDeniedError = class extends FakeAnthropic.APIError {};
FakeAnthropic.RateLimitError = class extends FakeAnthropic.APIError {};
require.cache[require.resolve('@anthropic-ai/sdk')] = { exports: FakeAnthropic, loaded: true };

const store = require('../lib/store');
const naver = require('../lib/naver');
const claude = require('../lib/claude');
const celeb = require('../lib/celeb');
const { pickTopics, analyze } = require('../lib/analysis');

const ok = (obj, usage = { input_tokens: 3000, output_tokens: 800 }) => () => ({
  stop_reason: 'end_turn', usage, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }],
});

test('Claude 요청: Opus 5.5, 거절 시 기본 대체, JSON 스키마, 사용량 기록', async () => {
  const db = store.load();
  db.settings.anthropicApiKey = 'sk-test';
  reply = ok({ outfits: [] });
  const r = await claude.askJson({ system: 'S', prompt: 'P', schema: celeb.SCHEMA });
  assert.deepStrictEqual(r, { outfits: [] });
  const { body, key } = sent.at(-1);
  assert.strictEqual(key, 'sk-test');
  assert.strictEqual(body.model, 'claude-opus-5-5');
  assert.strictEqual(body.fallbacks, 'default');
  assert.deepStrictEqual(body.betas, ['server-side-fallback-2026-07-01']);
  assert.strictEqual(body.output_config.format.type, 'json_schema');
  assert.strictEqual(body.thinking, undefined);
  const u = claude.monthUsage();
  assert.deepStrictEqual([u.input, u.output, u.calls], [3000, 800, 1]);
  assert.strictEqual(u.usd, 0.03); // 3000×$4/M + 800×$20/M = 0.028

  reply = () => ({ stop_reason: 'refusal', usage: {}, content: [] });
  await assert.rejects(claude.askJson({ system: 'S', prompt: 'P', schema: celeb.SCHEMA }), /답하지 않았어요/);
  reply = () => { throw new FakeAnthropic.AuthenticationError('bad'); };
  await assert.rejects(claude.askJson({ system: 'S', prompt: 'P', schema: celeb.SCHEMA }), /키가 올바르지 않아요/);
});

test('셀럽 착장 수집: 최근 기사만, 같은 기사 묶기, 본 기사는 다시 안 보냄', async () => {
  const db = store.load();
  Object.assign(db.settings, { naverClientId: 'x', naverClientSecret: 'y', anthropicApiKey: 'sk-test', celebs: ['문가영'] });
  const now = new Date().toUTCString();
  const old = new Date(Date.now() - 20 * 864e5).toUTCString();
  const queries = [];
  naver.searchNews = async (s, q) => {
    queries.push(q);
    return [
      { title: '문가영, 버버리 트렌치코트로 완성한 공항패션', description: '배우 문가영이 버버리 트렌치코트와 로퍼를 착용했다', link: 'https://news/a', pubDate: now },
      { title: '문가영, 버버리 트렌치코트로 완성한 공항패션', description: '같은 보도자료', link: 'https://news/a2', pubDate: now },
      { title: '오래된 기사', description: '', link: 'https://news/old', pubDate: old },
      { title: '가수 B 니트 착장', description: '가수 B가 니트를 입었다', link: 'https://news/b', pubDate: now },
    ];
  };
  reply = (body) => {
    assert.ok(body.messages[0].content.includes('[0] 문가영'));
    assert.ok(!body.messages[0].content.includes('오래된 기사'));
    return ok({ outfits: [
      { article: 0, celeb: '문가영', item: '트렌치코트', brand: '버버리', product: '', color: '베이지', price: '' },
      { article: 0, celeb: '문가영', item: '로퍼', brand: '', product: '', color: '', price: '' },
      { article: 1, celeb: '가수 B', item: '니트', brand: '', product: '', color: '', price: '' },
      { article: 9, celeb: '없는 기사', item: '코트', brand: '', product: '', color: '', price: '' },
    ] })();
  };
  await celeb.refresh();
  assert.ok(queries.includes('문가영 패션'));
  const v = celeb.view();
  assert.strictEqual(v.demo, false);
  assert.deepStrictEqual(v.outfits.map((o) => `${o.celeb}/${o.item}/${o.brand}`).sort(), ['가수 B/니트/', '문가영/로퍼/', '문가영/트렌치코트/버버리']);
  assert.strictEqual(v.lastNew, 2); // 같은 제목 기사와 오래된 기사는 빠짐

  const calls = sent.length;
  await celeb.refresh(); // 새 기사가 없으면 Claude를 부르지 않음
  assert.strictEqual(sent.length, calls);
  assert.strictEqual(celeb.view().outfits.length, 3);
});

test('이번 주 많이 입은 아이템과 오늘의 주제 반영', () => {
  const d = store.kstDate();
  const items = [
    { celeb: 'A', item: '트렌치코트', date: d }, { celeb: 'B', item: '트렌치코트', date: d }, { celeb: 'A', item: '트렌치코트', date: d },
    { celeb: 'C', item: '니트', date: store.kstDate(-10) },
  ];
  assert.deepStrictEqual(celeb.topItems(items)[0], { item: '트렌치코트', count: 2, celebs: ['A', 'B'] });
  const map = celeb.forKeywords(['트렌치코트', '니트', '코트'], items);
  assert.deepStrictEqual(map['트렌치코트'], { count: 2, names: ['A', 'B'] });
  assert.ok(!map['니트']); // 10일 전 착장은 제외
  assert.strictEqual(map['코트'].count, 2); // '코트'는 '트렌치코트'에 포함

  const series = Array(14).fill(10);
  const rows = analyze({ 트렌치코트: { series, anchorAvg: 10 }, 가디건: { series, anchorAvg: 10 } }, { 트렌치코트: 1000, 가디건: 1000 });
  const topics = pickTopics(rows, null, new Date(), 6, {}, { 트렌치코트: { count: 2, names: ['문가영', 'B'] } });
  assert.strictEqual(topics[0].word, '트렌치코트');
  assert.ok(topics[0].reasons.some((r) => r.text === '셀럽 착용 2명 (문가영, B)'));
  assert.strictEqual(topics[0].celebTitle, '문가영이 입은 트렌치코트, 비슷한 제품 찾아봤어요');
});
