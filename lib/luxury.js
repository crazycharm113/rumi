// 명품 메뉴: 브랜드와 상관없이 어떤 명품 브랜드가 요즘 많이 검색되는지 보고,
// 브랜드를 열면 제품·기사·블로그·검색 순위·쇼핑 클릭·누가 입었는지를 봅니다.
// 네이버는 판매량을 외부에 주지 않아, 네이버 쇼핑 클릭 추이를 '얼마나 사고 싶어 하나'의 대신 지표로 씁니다.
const store = require('./store');
const naver = require('./naver');
const claude = require('./claude');
const shopinsight = require('./shopinsight');
const { trendIndexOf } = require('./analysis');
const { LUXURY_BRANDS } = require('./catalog');

const hasNaver = (s) => Boolean(s.naverClientId && s.naverClientSecret);

// 일을 size 개씩 동시에 처리합니다 (브랜드 40개를 하나씩 기다리지 않게).
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

function brandList() {
  const extra = (store.load().settings.luxuryExtra || []).filter((n) => !LUXURY_BRANDS.some((b) => b.name === n));
  return [...LUXURY_BRANDS, ...extra.map((name) => ({ name, group: '추가', aliases: [] }))];
}

const dayAgo = (rfc, n) => {
  const t = Date.parse(rfc);
  return Number.isFinite(t) && Date.now() - t <= n * 864e5;
};

// ---- 목록 ----
function buildRows(brands, trends, shop, stats) {
  const rows = brands.map((b) => {
    const t = trends[b.name];
    if (!t) return null;
    const recent = t.series.slice(7).reduce((a, x) => a + x, 0) / 7;
    const sh = shop[b.name];
    const st = stats[b.name] || {};
    const peak = Math.max(...t.series, 1);
    return {
      name: b.name, group: b.group,
      level: Math.round((recent / (t.anchorAvg || 1)) * 1000) / 10, // '코디' 검색량 = 100 기준
      change: trendIndexOf(t.series) - 100,
      spark: t.series.map((v) => Math.round((v / peak) * 100)),
      shopChange: sh?.hasClicks ? sh.change : null,
      posts: st.posts ?? null,
      news7: st.news7 ?? null,
    };
  }).filter(Boolean).sort((a, b) => b.level - a.level);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// 어제(가장 최근 기록)와 비교한 순위 변동. 처음이면 null.
function withRankMove(rows) {
  const db = store.load();
  const hist = (db.history.luxRanks ||= {});
  const today = store.kstDate();
  const prevDate = Object.keys(hist).filter((d) => d < today).sort().pop();
  const prev = prevDate ? hist[prevDate] : null;
  hist[today] = rows.map((r) => r.name);
  for (const d of Object.keys(hist)) if (d < store.kstDate(-30)) delete hist[d];
  store.save();
  return rows.map((r) => {
    const before = prev ? prev.indexOf(r.name) : -1;
    return { ...r, move: !prev ? null : before === -1 ? 'new' : before + 1 - r.rank };
  });
}

async function collectList(s, force) {
  const brands = brandList();
  const names = brands.map((b) => b.name);
  const trends = (await store.cached('lux:trend', () => naver.trend(s, names, null), { force })).data;
  const shop = (await store.cached('lux:shop', () => shopinsight.brandClicks(s, names), { force }).catch(() => ({ data: {} }))).data;
  const stats = (await store.cached('lux:stats', async () => {
    const out = {};
    await pool(names, 5, async (name) => {
      const [b, n] = await Promise.all([naver.blogStats(s, name, 1).catch(() => null), naver.newsStats(s, name, 30).catch(() => null)]);
      out[name] = { posts: b?.total ?? null, news7: n ? n.items.filter((a) => dayAgo(a.pubDate, 7)).length : null };
    });
    return out;
  }, { force })).data;
  return withRankMove(buildRows(brands, trends, shop, stats));
}

function demoRows() {
  const names = brandList();
  const hash = (t) => [...t].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const rows = names.map((b) => {
    const h = hash(b.name + store.kstDate());
    const level = Math.round(20 + (h % 5000) / 10) / 1;
    const base = 20 + (h % 60);
    const series = Array.from({ length: 14 }, (_, i) => Math.round(base * (1 + (((h >> 3) % 40) - 10) / 400 * i) * (0.9 + ((h >> (i % 7)) % 20) / 100)));
    const peak = Math.max(...series);
    return { name: b.name, group: b.group, level, change: ((h >> 5) % 80) - 25, spark: series.map((v) => Math.round((v / peak) * 100)), shopChange: ((h >> 7) % 70) - 20,
      posts: 20000 + (h % 900000), news7: h % 31 };
  }).sort((a, b) => b.level - a.level);
  return rows.map((r, i) => ({ ...r, rank: i + 1, move: ((i * 7) % 5) - 2 }));
}

async function list({ force } = {}) {
  const s = store.load().settings;
  if (!hasNaver(s)) return { demo: true, rows: demoRows(), updatedAt: null };
  try {
    const rows = await collectList(s, force);
    return { demo: false, rows, updatedAt: store.load().cache['lux:trend']?.fetchedAt || null };
  } catch (err) {
    return { demo: false, rows: [], error: err.message };
  }
}

// ---- 상세 ----
const SYSTEM = `너는 명품·패션 담당 에디터야. 아래 블로그 글과 기사 제목·요약에서 지정한 브랜드의 제품과, 그 제품을 입거나 들거나 착용한 사람을 뽑아.
적혀 있는 사실만 써. 제품명·가격은 글에 나온 것만 쓰고 없으면 빈 문자열로 둬.
제품(product)은 같은 제품이 여러 글에 나오면 하나로 합치고 mentions 에 몇 개 글에 나왔는지 적어.
착용자(wearer)는 연예인·유명인만 (일반 블로거 제외). source 는 근거가 된 글 번호야.`;

const SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '제품명 (예: 클래식 플랩백, 스피디 30)' },
          item: { type: 'string', enum: ['가방', '신발', '의류', '주얼리', '시계', '지갑·소품', '향수·뷰티', '기타'] },
          price: { type: 'string' },
          mentions: { type: 'integer' },
          sources: { type: 'array', items: { type: 'integer' } },
        },
        required: ['name', 'item', 'price', 'mentions', 'sources'],
        additionalProperties: false,
      },
    },
    wearers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { celeb: { type: 'string' }, product: { type: 'string' }, source: { type: 'integer' } },
        required: ['celeb', 'product', 'source'],
        additionalProperties: false,
      },
    },
  },
  required: ['products', 'wearers'],
  additionalProperties: false,
};

function promptFor(brand, docs) {
  return `브랜드: ${brand.name}${brand.aliases?.length ? ` (${brand.aliases.join(', ')})` : ''}\n\n${docs.map((d, i) => `[${i}] ${d.title}\n${d.description || ''}`).join('\n\n')}`;
}

async function extract(brand, docs) {
  const r = await claude.askJson({ system: SYSTEM, prompt: promptFor(brand, docs), schema: SCHEMA });
  const at = (i) => docs[i];
  return {
    products: r.products.filter((p) => p.name.trim()).sort((a, b) => b.mentions - a.mentions).slice(0, 12).map((p) => ({
      name: p.name.trim(), item: p.item, price: p.price.trim(), mentions: p.mentions,
      source: at(p.sources[0]) ? { title: at(p.sources[0]).title, link: at(p.sources[0]).link } : null,
    })),
    wearers: r.wearers.filter((w) => w.celeb.trim() && at(w.source)).map((w) => ({
      celeb: w.celeb.trim(), product: w.product.trim(), title: at(w.source).title, link: at(w.source).link,
    })),
  };
}

// 이미 '셀럽 착장' 메뉴에 모아 둔 착장 중 이 브랜드인 것
function celebWearers(brand) {
  let items = [];
  try { items = require('./celeb').currentItems(); } catch { /* 셀럽 착장을 안 쓰면 없음 */ }
  const names = [brand.name, ...(brand.aliases || [])].map((n) => n.toLowerCase().replace(/\s/g, ''));
  return items.filter((x) => x.brand && names.some((n) => x.brand.toLowerCase().replace(/\s/g, '').includes(n)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((x) => ({ celeb: x.celeb, product: x.product || x.item, date: x.date, title: x.title, link: x.link }));
}

async function detail(name, { force } = {}) {
  const brand = brandList().find((b) => b.name === name);
  if (!brand) throw Object.assign(new Error('목록에 없는 브랜드예요.'), { status: 404 });
  const s = store.load().settings;
  const listing = await list({ force });
  const row = listing.rows.find((r) => r.name === name) || null;
  const common = { name, group: brand.group, aliases: brand.aliases, row, total: listing.rows.length, demo: listing.demo, wearersFromCeleb: celebWearers(brand), aiEnabled: claude.hasKey() };
  if (listing.demo) return { ...common, ...demoDetail(brand) };

  const base = (await store.cached(`lux:d:${name}`, async () => {
    const [blogs, news, clicks, audience] = await Promise.all([
      naver.blogStats(s, `${name} 인기템`, 30),
      naver.newsStats(s, name, 30),
      shopinsight.brandClicks(s, [name]).catch(() => ({})),
      shopinsight.audience(s, name, '50000001').catch(() => null),
    ]);
    return { blogs: blogs.items, blogTotal: blogs.total, news: news.items, newsTotal: news.total, clicks: clicks[name] || null, audience };
  }, { force })).data;

  // 제품·착용자 정리는 Claude 키가 있을 때만, 하루 한 번 (실패하면 저장하지 않아 다시 시도)
  let ai = null, aiError = '';
  if (claude.hasKey()) {
    try {
      const docs = [...base.blogs.slice(0, 25).map((b) => ({ title: b.title, description: b.description, link: b.link })),
        ...base.news.slice(0, 25).map((n) => ({ title: n.title, description: n.description, link: n.link }))];
      ai = (await store.cached(`lux:ai:${name}`, () => extract(brand, docs), { force })).data;
    } catch (err) { aiError = err.message; }
  }
  return { ...common, ...base, ai, aiError };
}

function demoDetail(brand) {
  const d = (n) => store.kstDate(-n).replace(/-/g, '');
  return {
    blogs: [1, 2, 3, 4, 5].map((n) => ({ title: `${brand.name} 인기템 추천 ${n} (예시)`, description: '', link: '#', blogger: `블로거${n}`, postdate: d(n) })),
    blogTotal: 123456,
    news: [1, 2, 3].map((n) => ({ title: `${brand.name}, 새 시즌 컬렉션 공개 (예시)`, description: '', link: '#', pubDate: new Date(Date.now() - n * 864e5).toUTCString() })),
    newsTotal: 5000,
    clicks: { series: [], change: 12, hasClicks: true },
    audience: { female: 72, male: 28, ages: { 30: 38 }, topAge: { code: '30', label: '30대', share: 38 }, label: '30대 여성' },
    ai: {
      products: [
        { name: '클래식 플랩백 (예시)', item: '가방', price: '', mentions: 6, source: { title: '예시 글', link: '#' } },
        { name: '카드지갑 (예시)', item: '지갑·소품', price: '', mentions: 3, source: null },
      ],
      wearers: [{ celeb: '배우 A (예시)', product: '클래식 플랩백', title: '예시 기사', link: '#' }],
    },
    aiError: '',
  };
}

module.exports = { list, detail, buildRows, withRankMove, extract, celebWearers, pool, brandList, SCHEMA };
