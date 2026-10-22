// 2단계: 관심 브랜드의 할인·신상 소식.
// 네이버 쇼핑 검색 API가 2026년 7월 31일 종료되어, 블로그 검색으로 '브랜드 + 세일/신상' 최근 글을 모읍니다.
// 쇼핑몰을 직접 수집하지 않으며, 세일 기간은 소식을 보고 캘린더에 넣을 수 있게 합니다.
const store = require('./store');
const naver = require('./naver');

const TOPICS = { sale: ['세일', '할인'], launch: ['신상', '신제품'] };
const DAYS = 14;

const toDate = (yyyymmdd) => (/^\d{8}$/.test(yyyymmdd || '') ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : '');

// 최근 글 중 브랜드 이름과 주제어가 제목·요약에 함께 나오는 글만 남깁니다.
function pickPosts(posts, brand, words, since) {
  const b = brand.replace(/\s/g, '').toLowerCase();
  const seen = new Set();
  return posts
    .map((p) => ({ ...p, date: toDate(p.postdate) }))
    .filter((p) => {
      const text = (p.title + ' ' + p.description).replace(/\s/g, '').toLowerCase();
      if (!text.includes(b) || !words.some((w) => text.includes(w)) || (p.date && p.date < since) || seen.has(p.link)) return false;
      seen.add(p.link);
      return true;
    })
    .sort((x, y) => (y.date || '').localeCompare(x.date || ''))
    .slice(0, 10);
}

// 지난번에 본 글은 isNew를 끕니다.
function markNew(list, seenLinks) {
  return list.map((p) => ({ ...p, isNew: !seenLinks.has(p.link) }));
}

async function refreshBrandFeed() {
  const db = store.load();
  const s = db.settings;
  const since = store.kstDate(-DAYS);
  const prev = db.cache.brandFeed?.brands || {};
  const out = { date: store.kstDate(), fetchedAt: new Date().toISOString(), brands: {} };
  for (const brand of s.brands) {
    try {
      const seen = new Set([...(prev[brand]?.sale || []), ...(prev[brand]?.launch || [])].map((p) => p.link));
      const first = !prev[brand];
      const result = {};
      for (const [kind, words] of Object.entries(TOPICS)) {
        const posts = await naver.recentBlogPosts(s, `${brand} ${words[0]}`);
        const picked = pickPosts(posts, brand, words, since);
        result[kind] = first ? picked.map((p) => ({ ...p, isNew: false })) : markNew(picked, seen);
      }
      out.brands[brand] = result;
    } catch (err) {
      out.brands[brand] = { error: err.message, sale: [], launch: [] };
    }
  }
  db.cache.brandFeed = out;
  store.save();
  return out;
}

function demoFeed(brands) {
  const list = brands.length ? brands : ['예시 브랜드'];
  const d = (n) => store.kstDate(-n);
  const out = {};
  for (const b of list) {
    out[b] = {
      sale: [
        { title: `${b} 가을 시즌오프 세일 최대 50%, 건진 아이템 정리`, description: '', link: '#', date: d(0), isNew: true },
        { title: `${b} 회원 할인 주간, 니트·코트 가격 비교`, description: '', link: '#', date: d(3), isNew: false },
      ],
      launch: [{ title: `${b} 신상 트렌치코트 입어봤어요 (사이즈 팁)`, description: '', link: '#', date: d(1), isNew: true }],
    };
  }
  return { demo: true, date: store.kstDate(), brands: out };
}

module.exports = { refreshBrandFeed, demoFeed, pickPosts, markNew };
