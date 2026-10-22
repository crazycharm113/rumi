// 주제별 추천 제품. 네이버 쇼핑 검색 API가 종료되어, '주제 + 추천' 블로그 글에서
// 블로거들이 많이 언급한 '브랜드 + 제품명'을 뽑고 네이버 쇼핑 검색 링크와 후기 글 링크를 붙입니다.
const store = require('./store');
const naver = require('./naver');
const { BRAND_WORDS } = require('./catalog');

const MAX_GAP = 24; // 브랜드와 주제어 사이 최대 글자 수 (그 사이가 제품명)

const shopUrl = (q) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q)}`;
const tidy = (s) => s.replace(/[\[\]()"'“”‘’<>|·,.!?~]/g, ' ').replace(/\s+/g, ' ').trim();

// 글 하나에서 브랜드마다 제품명 후보를 뽑습니다. 브랜드 바로 뒤(24자 안)에 주제어가 오면 그 사이까지를
// 제품명으로 봅니다. 예: "유니클로 울트라라이트다운 경량패딩". 멀리 떨어져 있으면 이름 없이 브랜드만 셉니다.
// '자라', '코스', '망고'처럼 다른 낱말 속에도 들어가는 브랜드가 있어, 낱말 경계에서만 브랜드로 봅니다.
const brandRe = Object.fromEntries(BRAND_WORDS.map((b) => [b,
  new RegExp(`(^|\\s)${b.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}(?=\\s|$|에서|에|의|는|도|랑|와|표)`)]));

function phrasesIn(text, kw) {
  const t = tidy(text);
  const out = new Map(); // brand -> 제품명 또는 ''
  for (const brand of BRAND_WORDS) {
    const m = t.match(brandRe[brand]);
    if (!m) continue;
    const i = m.index + m[1].length;
    const k = t.indexOf(kw, i + brand.length);
    // 브랜드와 주제어 사이가 '모델명' 같아 보일 때만 제품명으로 씁니다. 조사가 붙거나("자라에서 산")
    // 서술어가 섞이면("~해서 산") 브랜드만 셉니다.
    const between = k === -1 ? '' : t.slice(i + brand.length, k);
    const looksLikeModel = k !== -1 && k - (i + brand.length) <= MAX_GAP && (between === '' || between.startsWith(' '))
      && between.trim().split(' ').filter(Boolean).length <= 3
      && !between.trim().split(' ').some((w) => /(에서|에게|에|의|은|는|을|를|도|으로|로|와|과|랑|산|한|던|샀|입은|구매|해서|하고)$/.test(w));
    const name = looksLikeModel ? `${brand}${between.replace(/\s+/g, ' ')}${kw}`.trim() : '';
    out.set(brand, name && !BRAND_WORDS.some((b) => b !== brand && name.includes(b)) ? name : '');
  }
  return out;
}

function rankPicks(posts, kw, n = 3) {
  const byBrand = new Map();
  for (const p of posts) {
    const text = `${p.title} ${p.description}`;
    if (!text.includes(kw)) continue;
    for (const [brand, name] of phrasesIn(text, kw)) {
      const cur = byBrand.get(brand) || { brand, mentions: 0, names: new Map(), review: null };
      cur.mentions++;
      if (name) cur.names.set(name, (cur.names.get(name) || 0) + 1);
      if (!cur.review || (name && !cur.reviewNamed)) { cur.review = { title: p.title, link: p.link }; cur.reviewNamed = Boolean(name); }
      byBrand.set(brand, cur);
    }
  }
  return [...byBrand.values()]
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, n)
    .map((x) => {
      // 가장 많이 나온 제품명, 같으면 더 구체적인(긴) 이름
      const best = [...x.names].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
      const name = best ? best[0] : `${x.brand} ${kw}`;
      return { name, brand: x.brand, mentions: x.mentions, review: x.review, shopUrl: shopUrl(name) };
    });
}

// 브랜드 제품을 못 찾아도 볼 수 있게, 제목에 주제어가 들어간 추천·후기 글 상위 3개
function topReviews(posts, kw) {
  return posts.filter((p) => p.title.includes(kw)).slice(0, 3).map((p) => ({ title: p.title, link: p.link }));
}

// 주제 카드의 제품 기반 제목: 추천 제품과 어긋나지 않도록 실제 브랜드·제품명으로 만듭니다.
function productTitle(kw, items) {
  const brands = [...new Set(items.map((x) => x.brand).filter(Boolean))];
  if (brands.length >= 2) return `${brands[0]} vs ${brands[1]} ${kw} 비교 (가격·핏)`;
  if (items.length) return `${items[0].name} 솔직 후기`;
  return null;
}

// 내 상품 보드에 담아 둔 같은 종류의 상품
function mySaved(kw) {
  return store.load().boards.flatMap((b) => b.products
    .filter((p) => (p.name || '').includes(kw) || b.keyword === kw)
    .map((p) => ({ name: p.name, brand: p.brand, price: p.price, url: p.url, boardId: b.id })))
    .slice(0, 3);
}

async function picksFor(kw) {
  const s = store.load().settings;
  if (!(s.naverClientId && s.naverClientSecret)) {
    return { demo: true, items: demoPicks(kw), reviews: [], searchUrl: shopUrl(kw), mine: mySaved(kw) };
  }
  const r = await store.cached(`picks2:${kw}`, async () => {
    const posts = await naver.searchBlogPosts(s, `${kw} 추천`, 'sim');
    return { items: rankPicks(posts, kw), reviews: topReviews(posts, kw) };
  });
  return { demo: false, ...r.data, searchUrl: shopUrl(kw), mine: mySaved(kw) };
}

function demoPicks(kw) {
  return [['유니클로', 4], ['탑텐', 3], ['무신사', 2]].map(([b, m]) => ({
    name: `${b} ${kw}`, brand: b, mentions: m, review: { title: `${b} ${kw} 솔직 후기`, link: '#' }, shopUrl: shopUrl(`${b} ${kw}`),
  }));
}

module.exports = { productTitle, topReviews, picksFor, rankPicks, phrasesIn, shopUrl };
