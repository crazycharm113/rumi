// 키워드 기회 분석, 오늘 올릴 주제 고르기, 블로거 아이템 집계
const { KEYWORD_TEMP, ITEM_WORDS, BRAND_WORDS } = require('./catalog');
const { avg } = require('./naver');
const { kstDate } = require('./store');

// 검색 관심이 너무 적은 키워드(기준 키워드 '코디' 대비 1% 미만)는 상승률이 튀기 쉬워 추천에서 뺍니다.
const MIN_LEVEL = 1;

// 기회 점수 = 관심도 변화 지수 ÷ log10(블로그 글 수 + 10)
//  - 관심도 변화 지수: 최근 7일 평균 ÷ 그 전 7일 평균 × 100 (100이면 변화 없음, 최대 300)
//    쇼핑인사이트 클릭 변화가 있으면 검색 지수와 클릭 지수의 평균을 씁니다(구매 관심 반영).
//  - 글 수는 10배 차이가 나도 점수가 한 단계만 달라지도록 로그를 씁니다.
function scoreOf(trendIndex, posts) {
  return Math.round((trendIndex / Math.log10(posts + 10)) * 10) / 10;
}

function trendIndexOf(series) {
  const prev = avg(series.slice(0, 7));
  const recent = avg(series.slice(7));
  if (prev === 0) return recent > 0 ? 300 : 100;
  return Math.min(300, Math.round((recent / prev) * 100));
}

// 검색과 쇼핑 클릭이 함께 오르면 구매 의도(buy), 검색만 오르면 정보 탐색(info)
function intentOf(change, shopChange) {
  if (shopChange == null) return null;
  if (shopChange >= 10 && change >= -5) return 'buy';
  if (change >= 10 && shopChange < 5) return 'info';
  return null;
}

function analyze(trends, counts, shop = {}) {
  return Object.keys(trends).map((word) => {
    const { series, anchorAvg } = trends[word];
    const recent = avg(series.slice(7));
    const level = Math.round((recent / anchorAvg) * 1000) / 10; // '코디' = 100 기준 관심 수준
    const trendIndex = trendIndexOf(series);
    const posts = counts[word] ?? null;
    const peak = Math.max(...series, 1);
    const shopChange = shop[word]?.hasClicks ? shop[word].shopChange : null;
    const index = shopChange == null ? trendIndex : Math.round((trendIndex + Math.min(300, 100 + shopChange)) / 2);
    return {
      word,
      level,
      lowVolume: level < MIN_LEVEL,
      change: trendIndex - 100,
      shopChange,
      intent: intentOf(trendIndex - 100, shopChange),
      posts,
      score: posts == null ? null : scoreOf(index, posts),
      spark: series.map((v) => Math.round((v / peak) * 100)),
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

// 급상승 키워드와 어제 대비 순위 변동
function rising(rows, prevRanks) {
  const list = rows.filter((r) => !r.lowVolume).sort((a, b) => b.change - a.change).slice(0, 10);
  return list.map((r, i) => {
    const before = prevRanks ? prevRanks.indexOf(r.word) : -1;
    return { ...r, rank: i + 1, move: prevRanks == null ? null : before === -1 ? 'new' : before - i };
  });
}

function seasonFit(word, weather) {
  const range = KEYWORD_TEMP[word];
  if (!range || !weather) return null;
  const temps = [weather.today.avg];
  if (weather.drop) temps.push(weather.drop.avg);
  return temps.some((t) => t >= range[0] && t <= range[1]);
}

// 오늘 올릴 주제 3개: 기회 점수에 시즌 적합도를 곱해 고르고, 고른 이유를 함께 돌려줍니다.
function pickTopics(rows, weather, now = new Date(), n = 6) {
  const usable = rows.filter((r) => !r.lowVolume && r.score != null);
  const postsSorted = usable.map((r) => r.posts).sort((a, b) => a - b);
  const median = postsSorted[Math.floor(postsSorted.length / 2)] ?? 0;
  const month = Number(kstDate(0, now).slice(5, 7));

  return usable
    .map((r) => {
      const season = seasonFit(r.word, weather);
      const weight = r.score * (season === true ? 1.3 : season === false ? 0.6 : 1) * (r.change < 0 ? 0.8 : 1);
      return { ...r, season, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n)
    .map((r) => {
      const reasons = [];
      if (r.change > 0) reasons.push({ kind: 'up', text: `검색 관심 +${r.change}% (지난 7일 대비)` });
      else if (r.change === 0) reasons.push({ kind: 'flat', text: '검색 관심 유지' });
      else reasons.push({ kind: 'down', text: `검색 관심 ${r.change}% (꾸준히 찾는 키워드)` });
      reasons.push(r.posts <= median
        ? { kind: 'gap', text: `블로그 글이 적은 편 (${r.posts.toLocaleString('ko-KR')}건)` }
        : { kind: 'crowded', text: `글이 많은 편 (${r.posts.toLocaleString('ko-KR')}건) — 각도를 좁혀 쓰기` });
      if (r.intent === 'buy') reasons.push({ kind: 'buy', text: `쇼핑 클릭 +${r.shopChange}% → 제품 추천·비교 글` });
      if (r.intent === 'info') reasons.push({ kind: 'info', text: '검색만 오름 → 코디·스타일링 글' });
      if (r.season && weather) {
        const useDrop = weather.drop && !(weather.today.avg >= KEYWORD_TEMP[r.word][0] && weather.today.avg <= KEYWORD_TEMP[r.word][1]);
        reasons.push({
          kind: 'season',
          text: useDrop ? `곧 평균 ${weather.drop.avg}°C로 떨어져 미리 올리기 좋음` : `오늘 평균 ${weather.today.avg}°C에 맞는 아이템`,
        });
      }
      return {
        word: r.word,
        score: r.score,
        change: r.change,
        shopChange: r.shopChange,
        intent: r.intent,
        posts: r.posts,
        reasons,
        titleIdeas: [`${month}월 ${r.word} 코디 추천`, `${r.word} 데일리룩 모음`, `${r.word} 가격대별 비교`],
      };
    });
}

// 최근 블로그 글 제목·요약에서 아이템과 브랜드가 언급된 글 수를 셉니다.
function countMentions(posts) {
  const tally = (words) => words
    .map((w) => ({ word: w, count: posts.filter((p) => (p.title + ' ' + p.description).includes(w)).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
  return { total: posts.length, items: tally([...new Set(ITEM_WORDS)]).slice(0, 15), brands: tally(BRAND_WORDS).slice(0, 15) };
}

module.exports = { intentOf, analyze, rising, pickTopics, countMentions, scoreOf, trendIndexOf, seasonFit, MIN_LEVEL };
