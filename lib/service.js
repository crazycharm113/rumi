// 화면에 필요한 데이터를 모으는 곳. 외부 호출은 모두 하루 단위로 캐시합니다.
const store = require('./store');
const naver = require('./naver');
const weatherLib = require('./weather');
const analysis = require('./analysis');
const demo = require('./demo');
const { AGE_GROUPS, BLOGGER_QUERIES } = require('./catalog');

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

async function getKeywordRows({ force } = {}) {
  const s = store.load().settings;
  const age = AGE_GROUPS[s.age] ? s.age : 'all';
  if (!hasNaver(s)) {
    return { demo: true, age, rows: analysis.analyze(demo.demoTrends(s.keywords, age), demo.demoCounts(s.keywords)) };
  }
  const t = await store.cached(`trend:${age}:${s.keywords.join(',')}`, () => naver.trend(s, s.keywords, AGE_GROUPS[age].codes), { force });
  const c = await store.cached(`posts:${s.keywords.join(',')}`, async () => {
    const out = {};
    for (const k of s.keywords) out[k] = await naver.blogCount(s, k);
    return out;
  }, { force });
  return {
    demo: false, age,
    fetchedAt: t.fetchedAt,
    stale: t.stale || c.stale,
    error: t.error || c.error,
    rows: analysis.analyze(t.data, c.data),
  };
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
    topics: analysis.pickTopics(kw.rows, w),
    rising: risingWithHistory(kw.rows, kw.age, kw.demo),
  };
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

module.exports = { getWeather, getKeywordRows, getBriefing, getBloggerItems, getBrandFeed, hasNaver };
