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

test('화제가 된 옷: 같은 사람·같은 옷은 합치고, 점수는 최근 블로그 글 수 중심', async () => {
  const db = store.load();
  Object.assign(db.settings, { naverClientId: 'x', naverClientSecret: 'y', anthropicApiKey: 'sk-test', celebs: ['문가영'], blogId: 'mylog' });
  const now = new Date().toUTCString();
  const old = new Date(Date.now() - 20 * 864e5).toUTCString();
  const queries = [];
  naver.searchNews = async (s, q) => {
    queries.push(q);
    return [
      { title: '문가영, 버버리 트렌치코트로 완성한 공항패션', description: '배우 문가영이 버버리 켄싱턴 트렌치코트를 입었다. 완판', link: 'https://news/a', pubDate: now },
      { title: '문가영, 버버리 트렌치코트로 완성한 공항패션', description: '같은 보도자료', link: 'https://news/a2', pubDate: now },
      { title: '문가영 사복패션 트렌치코트 화제', description: '문가영의 트렌치코트 사복패션', link: 'https://news/a3', pubDate: now },
      { title: '오래된 기사', description: '', link: 'https://news/old', pubDate: old },
      { title: '가수 B 니트 착장', description: '가수 B가 니트를 입었다', link: 'https://news/b', pubDate: now },
    ];
  };
  reply = (body) => {
    const text = body.messages[0].content;
    assert.ok(text.includes('[0] 문가영') && !text.includes('오래된 기사'));
    assert.ok(body.system.includes('situation') && body.system.includes('buzz'));
    return ok({ outfits: [
      { article: 0, celeb: '문가영', situation: '공항패션', item: '트렌치코트', category: '아우터', brand: '버버리', product: '켄싱턴 트렌치', color: '베이지', price: '', buzz: true },
      { article: 0, celeb: '문가영', situation: '공항패션', item: '로퍼', category: '신발', brand: '', product: '', color: '', price: '', buzz: false },
      { article: 1, celeb: '문가영', situation: '사복패션', item: '트렌치코트', category: '아우터', brand: '', product: '', color: '', price: '', buzz: false },
      { article: 2, celeb: '가수 B', situation: '화보', item: '니트', category: '상의', brand: '', product: '', color: '', price: '', buzz: false },
      { article: 9, celeb: '없는 기사', situation: '기타', item: '코트', category: '아우터', brand: '', product: '', color: '', price: '', buzz: false },
    ] })();
  };
  naver.trend = async (s, names) => Object.fromEntries(names.map((n) => [n, { series: n === '문가영' ? [...Array(7).fill(10), ...Array(7).fill(20)] : Array(14).fill(10), anchorAvg: 10 }]));
  // 블로그: 문가영 트렌치코트는 최근 글이 많고(최신순), 가수 B 니트는 거의 없음
  const ymd = (n) => store.kstDate(-n).replace(/-/g, '');
  naver.blogStats = async (s, q, display, sort) => {
    if (q.startsWith('문가영')) {
      const recent = [...Array(6).fill(0).map((_, i) => ({ title: `문가영 트렌치코트 코디 ${i}`, description: '', link: `https://blog.naver.com/o/${i}`, blogger: 'x', postdate: ymd(i % 2 ? 1 : 5) })),
        { title: '문가영 로퍼', description: '', link: 'https://blog.naver.com/o/9', blogger: 'x', postdate: ymd(1) }, // 아이템이 달라서 제외
        { title: '문가영 트렌치코트 후기', description: '', link: 'https://blog.naver.com/mylog/7', blogger: '나', postdate: ymd(30) }]; // 오래된 글
      return { total: 50, topDates: ['20240101', '20240201'], items: sort === 'date' ? recent : recent.filter((p) => p.postdate !== ymd(30)).slice(0, 3).concat(recent.at(-1)) };
    }
    return { total: 50000, topDates: [], items: sort === 'date' ? [{ title: '가을 니트 코디 추천', description: '', link: 'https://blog.naver.com/o/b', blogger: 'x', postdate: ymd(2) }] : [] };
  };
  await celeb.refresh();
  assert.ok(queries.includes('문가영 패션') && queries.includes('공항패션') && queries.includes('사복패션'));
  const v = celeb.view();
  assert.strictEqual(v.demo, false);
  assert.strictEqual(v.lastNew, 3); // 같은 제목 기사와 오래된 기사는 빠짐

  // 같은 사람·같은 아이템은 한 항목: 기사 2건(공항패션·사복패션)이 합쳐짐
  const trench = v.hots.find((h) => h.celeb === '문가영' && h.item === '트렌치코트');
  assert.strictEqual(trench.articles.length, 2);
  assert.deepStrictEqual([trench.situation, trench.brand, trench.product, trench.buzz], ['공항패션', '버버리', '켄싱턴 트렌치', true]);
  assert.strictEqual(trench.name, '문가영 공항패션 버버리 켄싱턴 트렌치');
  assert.strictEqual(trench.sameLook[0], '로퍼'); // 같은 날 같이 입은 옷

  // 점수 = 블로그 글 수 중심: 이름+아이템이 모두 들어간 글만, 7일/3일 구분
  assert.strictEqual(trench.score.blog7, 6); // 1일 전 3개 + 5일 전 3개 (30일 전 글·로퍼 글은 제외)
  assert.strictEqual(trench.score.blog3, 3);
  assert.strictEqual(trench.score.posts, 50);
  const knit = v.hots.find((h) => h.item === '니트');
  assert.ok(trench.score.score > knit.score.score);
  assert.ok(trench.hot && !knit.hot); // 블로그 글이 충분히 쓰인 옷만 🔥
  assert.strictEqual(knit.score.blog7, 0); // 이름이 안 들어간 글은 안 셈
  assert.ok(knit.score.blog7 < v.minBlog7);
  // 이미 쓰인 상위 글: 이름·아이템이 들어간 글만, 내 글 표시
  assert.ok(trench.score.blogs.length >= 1 && trench.score.blogs.every((b) => b.title.includes('트렌치코트')));
  assert.ok(trench.score.blogs.some((b) => b.mine));

  const calls = sent.length;
  await celeb.refresh(); // 새 기사가 없으면 Claude를 부르지 않음
  assert.strictEqual(sent.length, calls);
});

test('고치기·숨기기, 이미 쓴 착장, 이 옷으로 글 만들기', () => {
  const db = store.load();
  const v = celeb.view();
  const trench = v.hots.find((h) => h.celeb === '문가영' && h.item === '트렌치코트');
  celeb.editItem(trench.ids[0], { brand: '버버리 런던', situation: '사복패션' });
  assert.strictEqual(celeb.view().hots.find((h) => h.id === trench.id).brand, '버버리 런던');
  const knit = v.hots.find((h) => h.item === '니트');
  celeb.editItem(knit.ids[0], { hidden: true });
  assert.ok(!celeb.view().hots.some((h) => h.item === '니트'));
  assert.throws(() => celeb.editItem('nope', { hidden: true }), /찾을 수 없어요/);

  db.posts = [{ title: '문가영 트렌치코트 공항패션 정보', pubDate: store.kstDate() }];
  assert.strictEqual(celeb.view().hots.find((h) => h.id === trench.id).written, true);

  const board = celeb.boardFromHot(trench.id, { plannedDate: '2026-12-01' });
  assert.strictEqual(board.keyword, '트렌치코트');
  assert.strictEqual(board.plannedDate, '2026-12-01');
  assert.ok(board.title.includes('문가영') && board.title.includes('트렌치코트'));
  assert.deepStrictEqual(board.products.map((p) => p.name), ['버버리 런던 켄싱턴 트렌치', '로퍼']); // 옷 + 같이 입은 아이템
  assert.ok(board.memo.includes('https://news/a'));
  assert.strictEqual(db.boards[0].id, board.id);

  // 한 줄로 묶인 여러 옷을 한 번에 담기
  const two = celeb.view().hots.filter((h) => h.celeb === '문가영').slice(0, 2);
  assert.ok(two.length >= 2);
  const multi = celeb.boardFromHot('', { hotIds: two.map((h) => h.id) });
  assert.ok(two.every((h) => multi.products.some((p) => p.name.includes(h.product || h.item))));
});

test('상황 키워드 짐작과 착장 이름', () => {
  assert.strictEqual(celeb.guessSituation('문가영 공항 출국길 패션'), '공항패션');
  assert.strictEqual(celeb.guessSituation('○○ 사복 패션 화제'), '사복패션');
  assert.strictEqual(celeb.guessSituation('그냥 기사'), '기타');
  assert.strictEqual(celeb.hotName({ celeb: 'A', situation: '공항패션', brand: '구찌', product: '홀스빗 로퍼', item: '로퍼' }), 'A 공항패션 구찌 홀스빗 로퍼');
  assert.strictEqual(celeb.hotName({ celeb: 'A', situation: '기타', brand: '', product: '', item: '니트' }), 'A 니트');
  assert.ok(celeb.hotScore({ blog7: 10, blog3: 4, articles: 2, buzz: true }) > celeb.hotScore({ blog7: 10, blog3: 4, articles: 2, buzz: false }));
  assert.ok(celeb.hotScore({ blog7: 20, articles: 1 }) > celeb.hotScore({ blog7: 0, articles: 5 })); // 블로그 글이 기사 수보다 중요
});

test('아이템 이름 통일과 종류 추정', () => {
  assert.strictEqual(celeb.normItem('트렌치 코트'), '트렌치코트');
  assert.strictEqual(celeb.normItem('버버리 트렌치코트', '버버리'), '트렌치코트');
  assert.strictEqual(celeb.normItem('재킷'), '자켓');
  assert.strictEqual(celeb.guessCategory('숄더백'), '가방');
  assert.strictEqual(celeb.guessCategory('와이드팬츠'), '하의');
  assert.strictEqual(celeb.guessCategory('발레리나 플랫'.replace(/\s/g, '')), '신발');
  const items = celeb.cleanItems([{ id: '1', item: '트렌치 코트', brand: '', category: '', date: '2026-01-01', celeb: 'A' }]);
  assert.deepStrictEqual([items[0].item, items[0].category], ['트렌치코트', '아우터']);
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

test('기사가 많으면 50건씩 나눠 Claude에 보내고, 각 묶음의 번호가 맞게 연결됨', async () => {
  const db = store.load();
  db.celeb = { items: [], seen: {}, lastRun: '', error: '', edits: {}, scores: {} };
  const now = new Date().toUTCString();
  let n = 0;
  naver.searchNews = async (s, q, display) => {
    assert.strictEqual(display, 100);
    return q === '공항패션' ? Array.from({ length: 120 }, (_, i) => ({ title: `연예인${i} 공항패션 착용 기사 번호 ${i}`, description: '', link: `https://news/${i}`, pubDate: now })) : [];
  };
  const before = sent.length;
  reply = (body) => {
    const text = body.messages[0].content;
    const nums = [...text.matchAll(/\[(\d+)\] 연예인(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    n += nums.length;
    return ok({ outfits: nums.map(([idx, who]) => ({ article: idx, celeb: `연예인${who}`, situation: '공항패션', item: '코트', category: '아우터', brand: '', product: '', color: '', price: '', buzz: false })) })();
  };
  naver.trend = async () => ({});
  naver.blogStats = async () => ({ total: 0, topDates: [], items: [] });
  await celeb.refresh();
  assert.strictEqual(sent.length - before, 3); // 120건 → 50 + 50 + 20
  assert.strictEqual(n, 120);
  const st = celeb.state();
  assert.strictEqual(new Set(st.items.map((x) => x.celeb)).size, 120);
  assert.strictEqual(st.items.find((x) => x.celeb === '연예인77').link, 'https://news/77'); // 두 번째 묶음에서도 번호가 맞음
});
