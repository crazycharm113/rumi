// 화면에 필요한 데이터를 모으는 곳. 외부 호출은 모두 하루 단위로 캐시합니다.
const store = require('./store');
const naver = require('./naver');
const weatherLib = require('./weather');
const analysis = require('./analysis');
const demo = require('./demo');
const { AGE_GROUPS, BLOGGER_QUERIES } = require('./catalog');
const { personalTitles } = require('./titles');
const { picksFor } = require('./picks');
const shopinsight = require('./shopinsight');

const hasNaver = (s) => Boolean(s.naverClientId && s.naverClientSecret);

async function getWeather({ force } = {}) {
  const db = store.load();
  const s = db.settings;
  if (!s.kmaServiceKey) {
    const days = weatherLib.demoForecast();
    return { demo: true, region: s.region, days, ...weatherLib.buildWeather(days, {}) };
  }
  const r = await store.cached(`weather:${s.region}`, () => weatherLib.fetchForecast(s.kmaServiceKey, s.region), { force });
  // '어제와의 차이'를 위해 날마다 그날 기온을 남겨 둡니다.
  const today = r.data[store.kstDate()];
  if (today && !db.history.weather[store.kstDate()]) {
    db.history.weather[store.kstDate()] = today;
    store.save();
  }
  return { demo: false, region: s.region, days: r.data, fetchedAt: r.fetchedAt, stale: r.stale, error: r.error, ...weatherLib.buildWeather(r.data, db.history.weather) };
}

async function getKeywordRows({ force, age: ageOverride } = {}) {
  const s = store.load().settings;
  const want = ageOverride ?? s.age;
  const age = AGE_GROUPS[want] ? want : 'all';
  if (!hasNaver(s)) {
    return { demo: true, age, rows: analysis.analyze(demo.demoTrends(s.keywords, age), demo.demoCounts(s.keywords), demo.demoShop(s.keywords)) };
  }
  const t = await store.cached(`trend:${age}:${s.keywords.join(',')}`, () => naver.trend(s, s.keywords, AGE_GROUPS[age].codes), { force });
  const c = await store.cached(`posts:${s.keywords.join(',')}`, async () => {
    const out = {};
    for (const k of s.keywords) out[k] = await naver.blogCount(s, k);
    return out;
  }, { force });
  // 쇼핑인사이트(구매 관심도)는 없어도 나머지가 돌아가도록 따로 받습니다.
  const shop = await store.cached(`shop:${age}:${s.keywords.join(',')}`, () => shopinsight.buyingInterest(s, s.keywords, age), { force })
    .catch((e) => ({ data: {}, error: e.message }));
  return {
    demo: false, age,
    fetchedAt: t.fetchedAt,
    stale: t.stale || c.stale,
    error: t.error || c.error,
    shopError: shop.data && Object.keys(shop.data).length ? '' : shop.error || '',
    rows: analysis.analyze(t.data, c.data, shop.data || {}),
  };
}

// ---- 쇼핑인사이트 ----
// 작년 정점 (하루 한 번)
async function getPeaks() {
  const s = store.load().settings;
  if (!hasNaver(s)) return { demo: true, peaks: demo.demoPeaks(s.keywords) };
  try {
    const r = await store.cached(`peaks:${s.keywords.join(',')}`, () => shopinsight.lastYearPeaks(s, s.keywords));
    return { demo: false, peaks: r.data };
  } catch (err) {
    return { demo: false, peaks: {}, error: err.message };
  }
}

// 타깃 독자 (키워드마다 하루 한 번)
async function getAudience(word) {
  const s = store.load().settings;
  if (!hasNaver(s)) return demo.demoAudience(word);
  try {
    return (await store.cached(`aud:${word}`, () => shopinsight.audience(s, word))).data;
  } catch {
    return null;
  }
}

// 새로 뜨는 아이템과 분야 흐름 (하루 한 번)
async function getDiscover({ force } = {}) {
  const s = store.load().settings;
  if (!hasNaver(s)) return { demo: true, items: demo.demoDiscover(s.keywords), categories: [] };
  const [d, c] = await Promise.all([
    store.cached(`discover:${s.keywords.join(',')}`, () => shopinsight.discover(s, s.keywords), { force }).catch((e) => ({ data: [], error: e.message })),
    store.cached('categoryWeeks', () => shopinsight.categoryWeeks(s), { force }).catch((e) => ({ data: [], error: e.message })),
  ]);
  return { demo: false, items: d.data || [], categories: c.data || [], fetchedAt: d.fetchedAt, error: d.error || c.error || '' };
}

function risingWithHistory(rows, age, isDemo) {
  const db = store.load();
  const hist = (db.history.ranks[age] ||= {});
  const prev = hist[store.kstDate(-1)] || null;
  const list = analysis.rising(rows, isDemo ? null : prev);
  if (!isDemo && !hist[store.kstDate()]) {
    hist[store.kstDate()] = list.map((r) => r.word);
    // 순위 기록은 최근 30일만 둡니다.
    for (const d of Object.keys(hist)) if (d < store.kstDate(-30)) delete hist[d];
    store.save();
  }
  return list;
}

async function getBriefing({ force } = {}) {
  const [weather, kw] = await Promise.all([
    getWeather({ force }).catch((e) => ({ error: e.message })),
    // 키워드를 못 가져와도 날씨·일정 등 나머지 브리핑은 보여줍니다.
    getKeywordRows({ force }).catch((e) => {
      const age = store.load().settings.age;
      return { demo: false, age: AGE_GROUPS[age] ? age : 'all', rows: [], failed: true, error: e.message };
    }),
  ]);
  const w = weather.today ? weather : null;
  return {
    date: store.kstDate(),
    weather,
    age: kw.age,
    ageLabel: AGE_GROUPS[kw.age].label,
    keywordsMeta: { demo: kw.demo, fetchedAt: kw.fetchedAt, stale: kw.stale, failed: kw.failed, error: kw.error },
    topics: await withAudience(await withPicks(personalize(analysis.pickTopics(kw.rows, w)))),
    shopError: kw.shopError || '',
    rising: risingWithHistory(kw.rows, kw.age, kw.demo),
  };
}

// 연령대별 오늘 올릴 주제 (홈의 연령 버튼). 연령마다 검색·쇼핑 데이터를 따로 받아 하루 한 번 저장합니다.
async function getTopics(age) {
  const [weather, kw] = await Promise.all([
    getWeather().catch(() => ({})),
    getKeywordRows({ age }),
  ]);
  const w = weather.today ? weather : null;
  return {
    age: kw.age,
    ageLabel: AGE_GROUPS[kw.age].label,
    demo: kw.demo,
    topics: await withAudience(await withPicks(personalize(analysis.pickTopics(kw.rows, w))), kw.age),
  };
}

// 주제마다 블로거들이 많이 언급한 제품 (하루 한 번 저장해 재사용)
async function withPicks(topics) {
  return Promise.all(topics.map(async (t) => {
    try {
      return { ...t, picks: await picksFor(t.word) };
    } catch (err) {
      return { ...t, picks: { items: [], mine: [], error: err.message } };
    }
  }));
}

// 주제마다 누가 찾는지(성별·연령) 붙이고, 타깃을 넣은 제목 하나를 더합니다.
// age 를 고른 경우(연령 버튼) 제목의 연령은 고른 연령으로, 성별만 클릭 비중을 따릅니다.
async function withAudience(topics, age = null) {
  const month = Number(store.kstDate().slice(5, 7));
  return Promise.all(topics.map(async (t) => {
    const audience = await getAudience(t.word);
    const gender = audience?.female == null ? '' : audience.female >= 60 ? '여성' : audience.female <= 40 ? '남성' : '';
    const label = age && age !== 'all' ? [AGE_GROUPS[age].label, gender].filter(Boolean).join(' ') : audience?.label;
    if (!label || label === '고르게 분포') return { ...t, audience };
    const targeted = `${label} ${t.word} 코디 추천`;
    const titleIdeas = t.titleIdeas.includes(targeted) ? t.titleIdeas : [...t.titleIdeas.slice(0, 3), targeted];
    return { ...t, audience, titleIdeas, targetTitle: targeted, month };
  }));
}

// 내 블로그 글 제목이 있으면 그 형태를 따른 제목을 앞에 둡니다.
function personalize(topics) {
  const db = store.load();
  const month = Number(store.kstDate().slice(5, 7));
  return topics.map((t, i) => {
    const mine = personalTitles(t.word, db.posts, { keywords: db.settings.keywords, month, offset: i });
    if (!mine.length) return { ...t, titleSource: db.settings.blogId ? 'none' : 'noblog' };
    return { ...t, titleIdeas: [...mine, ...t.titleIdeas.filter((x) => !mine.includes(x))].slice(0, 3), titleSource: 'mine', myCount: mine.length };
  });
}

async function getBloggerItems({ force } = {}) {
  const s = store.load().settings;
  if (!hasNaver(s)) return { demo: true, queries: BLOGGER_QUERIES, ...analysis.countMentions(demo.demoPosts()) };
  const r = await store.cached('bloggerPosts', async () => {
    const all = [];
    for (const q of BLOGGER_QUERIES) all.push(...(await naver.recentBlogPosts(s, q)));
    // 같은 글이 여러 검색어에 걸리면 한 번만 셉니다.
    return [...new Map(all.map((p) => [p.link, p])).values()];
  }, { force });
  return { demo: false, queries: BLOGGER_QUERIES, fetchedAt: r.fetchedAt, stale: r.stale, error: r.error, ...analysis.countMentions(r.data) };
}

// 관심 브랜드 할인·신상. 실제 갱신은 스케줄러가 하루 한 번 하고, 여기서는 저장된 결과를 돌려줍니다.
function getBrandFeed() {
  const db = store.load();
  const s = db.settings;
  if (!hasNaver(s)) return { ...require('./brandnews').demoFeed(s.brands), brandsSet: s.brands.length > 0 };
  let feed = db.cache.brandFeed;
  // 쇼핑 검색 시절에 저장된 옛 형식(sales/launches)은 버리고 새로 가져오게 합니다.
  if (feed && Object.values(feed.brands || {}).some((b) => !Array.isArray(b.sale))) {
    delete db.cache.brandFeed;
    delete db.jobs.brandFeed;
    delete db.history.brandItems;
    store.save();
    feed = null;
    setTimeout(() => require('./scheduler').tick(), 100);
  }
  return { demo: false, brandsSet: s.brands.length > 0, pending: !feed, error: db.jobs.brandFeedError || '', ...(feed || { brands: {} }) };
}

module.exports = { getTopics, getPeaks, getAudience, getDiscover, getWeather, getKeywordRows, getBriefing, getBloggerItems, getBrandFeed, hasNaver };
