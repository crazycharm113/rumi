// 네이버 쇼핑인사이트: 네이버 쇼핑에서의 '클릭' 추이(= 살 마음). 검색어 트렌드와 함께 보면
// 검색만 오르는지(정보 탐색), 클릭도 오르는지(구매 의도) 알 수 있습니다.
//  1) 구매 관심도: 키워드별 최근 14일 클릭 추이
//  2) 작년 정점: 작년 같은 시기 주간 클릭 추이에서 정점 주를 찾아 올해 날짜로 옮김
//  3) 타깃 독자: 키워드 성별·연령별 클릭 비중
//  4) 새로 뜨는 아이템: 지켜보는 목록에 없는 아이템 키워드의 클릭 상승률
const store = require('./store');
const { call, headers, isLegacy, avg, fill } = require('./naver');
const { CATEGORY_OF, DISCOVERY_WORDS, CATEGORIES } = require('./catalog');

// API HUB: /shopping/v1/<경로>, 개발자센터 기존 키: /v1/datalab/shopping/<경로>
function endpoint(s, p) {
  return isLegacy(s) ? `https://openapi.naver.com/v1/datalab/shopping/${p}` : `https://naverapihub.apigw.ntruss.com/shopping/v1/${p}`;
}

const post = (s, p, body) => call(endpoint(s, p), { method: 'POST', headers: headers(s), body: JSON.stringify(body) });

// 쇼핑인사이트 연령 코드는 10/20/30/40/50/60 (검색어 트렌드와 다릅니다)
const SHOP_AGES = { all: null, '10': ['10'], '20': ['20'], '30': ['30'], '40': ['40'], '50': ['50', '60'] };
const AGE_LABEL = { 10: '10대', 20: '20대', 30: '30대', 40: '40대', 50: '50대', 60: '60대 이상' };

const categoryOf = (w) => CATEGORY_OF[w] || CATEGORIES.clothes.cid;

// 같은 분야끼리 5개씩 묶어 부릅니다. 반환: { 키워드: 기간별 클릭 지수 배열 }
async function keywordSeries(s, words, { startDate, endDate, timeUnit, ages, days }) {
  const groups = {};
  for (const w of words) (groups[categoryOf(w)] ||= []).push(w);
  const out = {};
  for (const [cid, list] of Object.entries(groups)) {
    for (let i = 0; i < list.length; i += 5) {
      const batch = list.slice(i, i + 5);
      const body = { startDate, endDate, timeUnit, category: cid, keyword: batch.map((k) => ({ name: k, param: [k] })) };
      if (ages) body.ages = ages;
      const json = await post(s, 'category/keywords', body);
      for (const r of json.results) {
        out[r.title] = timeUnit === 'date' ? fill(r.data, startDate, days) : r.data.map((d) => ({ period: d.period, ratio: d.ratio }));
      }
    }
  }
  return out;
}

function changeOf(series) {
  const prev = avg(series.slice(0, 7));
  const recent = avg(series.slice(7));
  if (prev === 0) return recent > 0 ? 200 : 0;
  return Math.min(200, Math.round((recent / prev - 1) * 100));
}

// 1) 구매 관심도: 키워드별 최근 7일 클릭 변화(%)
async function buyingInterest(s, words, age) {
  const series = await keywordSeries(s, words, { startDate: store.kstDate(-14), endDate: store.kstDate(-1), timeUnit: 'date', ages: SHOP_AGES[age], days: 14 });
  return Object.fromEntries(Object.entries(series).map(([w, v]) => [w, { shopChange: changeOf(v), hasClicks: v.some((x) => x > 0) }]));
}

// 2) 작년 정점: 작년 오늘부터 4개월 동안의 주간 클릭에서 가장 높은 주 → 올해 같은 주로 옮김
async function lastYearPeaks(s, words) {
  const startDate = store.kstDate(-365);
  const endDate = store.kstDate(-365 + 120);
  const series = await keywordSeries(s, words, { startDate, endDate, timeUnit: 'week' });
  const out = {};
  for (const [w, data] of Object.entries(series)) {
    if (!data.length) continue;
    const top = data.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    const first = data[0].ratio || 1;
    if (top.ratio < first * 1.3) continue; // 뚜렷한 정점이 없으면 건너뜀
    const peak = shiftYear(top.period);
    if (peak < store.kstDate(0)) continue;
    out[w] = { peak, prepare: addDays(peak, -14), lastYear: top.period, rise: Math.round((top.ratio / first - 1) * 100) };
  }
  return out;
}

function addDays(d, n) {
  return new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
}

function shiftYear(d) {
  return addDays(d, 364); // 같은 요일이 되도록 52주 뒤
}

// 3) 타깃 독자: 최근 30일 성별·연령 클릭 비중
async function audience(s, word) {
  const base = { startDate: store.kstDate(-30), endDate: store.kstDate(-1), timeUnit: 'month', category: categoryOf(word), keyword: word };
  const share = (json) => {
    const sum = {};
    for (const d of json.results?.[0]?.data || []) sum[d.group] = (sum[d.group] || 0) + d.ratio;
    const total = Object.values(sum).reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(Object.entries(sum).map(([g, v]) => [g, Math.round((v / total) * 100)]));
  };
  const gender = share(await post(s, 'category/keyword/gender', base));
  const ages = share(await post(s, 'category/keyword/age', base));
  return summarizeAudience(gender, ages);
}

function summarizeAudience(gender, ages) {
  const female = gender.f ?? null;
  const topAge = Object.entries(ages).sort((a, b) => b[1] - a[1])[0];
  const genderLabel = female == null ? '' : female >= 60 ? '여성' : female <= 40 ? '남성' : '';
  const ageLabel = topAge ? AGE_LABEL[topAge[0]] || '' : '';
  return {
    female, male: gender.m ?? null, ages,
    topAge: topAge ? { code: topAge[0], label: ageLabel, share: topAge[1] } : null,
    label: [ageLabel, genderLabel].filter(Boolean).join(' ') || '고르게 분포',
  };
}

// 4) 새로 뜨는 아이템: 지켜보지 않는 아이템 키워드 중 클릭이 오르는 것
async function discover(s, watched) {
  const words = DISCOVERY_WORDS.filter((w) => !watched.includes(w));
  const series = await keywordSeries(s, words, { startDate: store.kstDate(-14), endDate: store.kstDate(-1), timeUnit: 'date', days: 14 });
  // 묶음마다 상대 지수라 수준 비교는 못 하므로, 클릭이 거의 없는 것만 걸러내고 상승률로 정렬합니다.
  return Object.entries(series)
    .filter(([, v]) => v.filter((x) => x > 0).length >= 10)
    .map(([word, v]) => ({ word, change: changeOf(v), spark: v.map((x) => Math.round((x / Math.max(...v, 1)) * 100)) }))
    .filter((x) => x.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, 12);
}

// 자동 키워드: 아이템 사전 전체의 최근 14일 클릭 변화. 클릭이 드문 아이템은 뺍니다.
async function screenPool(s, words) {
  const series = await keywordSeries(s, words, { startDate: store.kstDate(-14), endDate: store.kstDate(-1), timeUnit: 'date', days: 14 });
  return Object.entries(series)
    .filter(([, v]) => v.filter((x) => x > 0).length >= 10)
    .map(([word, v]) => ({ word, change: changeOf(v) }));
}

// 분야 전체 흐름 (패션의류·패션잡화), 최근 8주
async function categoryWeeks(s) {
  const json = await post(s, 'categories', {
    startDate: store.kstDate(-56), endDate: store.kstDate(-1), timeUnit: 'week',
    category: Object.values(CATEGORIES).map((c) => ({ name: c.name, param: [c.cid] })),
  });
  return json.results.map((r) => ({ name: r.title, weeks: r.data.map((d) => ({ period: d.period, ratio: d.ratio })) }));
}

module.exports = { screenPool, endpoint, buyingInterest, lastYearPeaks, audience, summarizeAudience, discover, categoryWeeks, changeOf, shiftYear, SHOP_AGES };
