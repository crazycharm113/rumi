// 네이버 검색어트렌드(데이터랩)와 블로그 검색.
// 2026년 7월 31일부터 새 키는 NAVER API HUB(네이버 클라우드 플랫폼)에서만 발급되고 주소·인증 헤더가 다릅니다.
// 그 전에 개발자센터에서 받은 키(legacy)는 기존 주소로 계속 부릅니다.
const { kstDate } = require('./store');

const HUB = 'https://naverapihub.apigw.ntruss.com';
const LEGACY = 'https://openapi.naver.com';

const isLegacy = (s) => s.naverKeyType === 'legacy';

function endpoint(s, kind, query = '') {
  if (kind === 'trend') return isLegacy(s) ? `${LEGACY}/v1/datalab/search` : `${HUB}/search-trend/v1/search`;
  return (isLegacy(s) ? `${LEGACY}/v1/search/blog.json` : `${HUB}/search/v1/blog`) + query;
}

function headers(s) {
  const auth = isLegacy(s)
    ? { 'X-Naver-Client-Id': s.naverClientId, 'X-Naver-Client-Secret': s.naverClientSecret }
    : { 'X-NCP-APIGW-API-KEY-ID': s.naverClientId, 'X-NCP-APIGW-API-KEY': s.naverClientSecret };
  return { ...auth, 'Content-Type': 'application/json' };
}

// 인증 실패 시 어떤 주소로 불렀는지에 따라 확인할 점을 알려줍니다.
function authHint(url) {
  return url.startsWith(HUB)
    ? '설정의 키 종류가 "NAVER API HUB 키"인데 인증에 실패했어요. API HUB에서 받은 Client ID/Secret이 맞는지, Application에 Search Trend와 검색-블로그를 선택했는지 확인하세요.'
    : '설정의 키 종류가 "개발자센터 기존 키"예요. NAVER API HUB에서 받은 키라면 키 종류를 "NAVER API HUB 키"로 바꿔 주세요.';
}

async function call(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.errorMessage || json.message || json.error?.message || json.error?.errorMessage || '응답 없음';
    const hint = res.status === 401 || res.status === 403
      ? ` — ${authHint(url)}` : res.status === 429 ? ' — 호출 한도를 넘었습니다.' : '';
    throw new Error(`네이버 API 오류(${res.status}): ${msg}${hint}`);
  }
  return json;
}

// 기준 키워드. 데이터랩 값은 요청마다 '그 요청 안에서 가장 큰 값 = 100'인 상대 지수라서,
// 모든 요청에 같은 기준 키워드를 넣어 서로 다른 요청의 키워드끼리도 비교할 수 있게 합니다.
const ANCHOR = '코디';

// 키워드별 최근 14일 일별 지수를 가져옵니다. 오늘은 집계 중이라 어제까지 씁니다.
async function trend(s, keywords, ageCodes) {
  const endDate = kstDate(-1);
  const startDate = kstDate(-14);
  const result = {};
  for (let i = 0; i < keywords.length; i += 4) {
    const batch = keywords.slice(i, i + 4);
    const body = {
      startDate, endDate, timeUnit: 'date',
      keywordGroups: [ANCHOR, ...batch].map((k) => ({ groupName: k, keywords: [k] })),
    };
    if (ageCodes) body.ages = ageCodes;
    const json = await call(endpoint(s, 'trend'), { method: 'POST', headers: headers(s), body: JSON.stringify(body) });
    const series = Object.fromEntries(json.results.map((r) => [r.title, fill(r.data, startDate, 14)]));
    const anchorAvg = avg(series[ANCHOR]) || 1;
    for (const k of batch) result[k] = { series: series[k], anchorAvg };
  }
  return result;
}

// 데이터랩은 값이 0인 날을 빼고 돌려주므로 14일을 0으로 채웁니다.
function fill(data, startDate, days) {
  const map = Object.fromEntries(data.map((d) => [d.period, d.ratio]));
  const out = [];
  const start = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400e3).toISOString().slice(0, 10);
    out.push(map[d] || 0);
  }
  return out;
}

function avg(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

// 검색 결과 총 건수를 '같은 키워드의 블로그 글 수' 근사치로 씁니다.
async function blogCount(s, keyword) {
  const json = await call(endpoint(s, 'blog', `?query=${encodeURIComponent(keyword)}&display=1`), { headers: headers(s) });
  return json.total;
}

async function recentBlogPosts(s, query) {
  const json = await call(endpoint(s, 'blog', `?query=${encodeURIComponent(query)}&display=100&sort=date`), { headers: headers(s) });
  return json.items.map((it) => ({
    title: strip(it.title),
    description: strip(it.description),
    link: it.link,
    postdate: it.postdate,
  }));
}

// 블로그 검색 상위 100개 (검색 노출 순위 확인용)
async function searchBlog(s, query) {
  const json = await call(endpoint(s, 'blog', `?query=${encodeURIComponent(query)}&display=100&sort=sim`), { headers: headers(s) });
  return json.items.map((it) => ({ title: strip(it.title), link: it.link, bloggerlink: it.bloggerlink || '' }));
}

function strip(html) {
  return String(html).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
}

module.exports = { endpoint, trend, blogCount, recentBlogPosts, searchBlog, avg, fill, strip, call, headers, ANCHOR };
