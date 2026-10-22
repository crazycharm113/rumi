const test = require('node:test');
const assert = require('node:assert');
const { rankPicks, phrasesIn } = require('../lib/picks');
const { pickTopics, analyze } = require('../lib/analysis');

test('추천 제품: 블로그에서 많이 언급된 브랜드 제품명, 브랜드당 하나', () => {
  const posts = [
    { title: '유니클로 울트라라이트다운 경량패딩 후기', description: '', link: 'l1' },
    { title: '경량패딩 추천 TOP3', description: '유니클로 울트라라이트다운 경량패딩, 탑텐 경량패딩', link: 'l2' },
    { title: '자라에서 산 경량패딩', description: '', link: 'l3' },
    { title: '유니클로 경량패딩 사이즈', description: '', link: 'l4' },
    { title: '키가 자라서 산 코트', description: '경량패딩 아님', link: 'l5' },
  ];
  const picks = rankPicks(posts, '경량패딩');
  assert.deepStrictEqual(picks.map((p) => [p.name, p.mentions]), [['유니클로 울트라라이트다운 경량패딩', 3], ['탑텐 경량패딩', 1], ['자라 경량패딩', 1]]);
  assert.ok(picks[0].shopUrl.startsWith('https://search.shopping.naver.com/search/all?query='));
  assert.strictEqual(picks[0].review.link, 'l1');
  assert.strictEqual(phrasesIn('키가 자라서 코스트코', '코트').size, 0);
});

test('오늘 올릴 주제는 6개', () => {
  const series = (up) => [...Array(7).fill(10), ...Array(7).fill(10 + up)];
  const words = ['니트', '가디건', '셔켓', '블레이저', '맨투맨', '후드집업', '플리스', '바람막이'];
  const rows = analyze(Object.fromEntries(words.map((w, i) => [w, { series: series(i), anchorAvg: 20 }])), Object.fromEntries(words.map((w) => [w, 5000])));
  assert.strictEqual(pickTopics(rows, { today: { avg: 15 }, drop: null }).length, 6);
});

test('추천 제품을 못 찾아도 후기 글을 보여주고, 제목은 실제 추천 제품으로 만듦', () => {
  const { topReviews, productTitle } = require('../lib/picks');
  const posts = [
    { title: '체스터코트 추천 BEST', description: '', link: 'r1' },
    { title: '코트 고르는 법', description: '체스터코트', link: 'r2' },
    { title: '여자 체스터코트 코디', description: '', link: 'r3' },
  ];
  assert.deepStrictEqual(rankPicks(posts, '체스터코트'), []);
  assert.deepStrictEqual(topReviews(posts, '체스터코트').map((r) => r.link), ['r1', 'r3']);
  assert.strictEqual(productTitle('발마칸코트', [{ brand: '무신사', name: '무신사 발마칸코트' }, { brand: '유니클로', name: '유니클로 발마칸코트' }]), '무신사 vs 유니클로 발마칸코트 비교 (가격·핏)');
  assert.strictEqual(productTitle('코듀로이팬츠', [{ brand: '마시모두띠', name: '마시모두띠 코듀로이팬츠' }]), '마시모두띠 코듀로이팬츠 솔직 후기');
  assert.strictEqual(productTitle('체스터코트', []), null);
});

test('제목 스타일은 고른 카테고리의 글에서만 배움', () => {
  const { titlePosts } = require('../lib/service');
  const db = { settings: { titleCategories: ['데일리룩'] }, posts: [{ title: 'a', category: '데일리룩' }, { title: 'b', category: '연예인 패션' }] };
  assert.deepStrictEqual(titlePosts(db).map((p) => p.title), ['a']);
  db.settings.titleCategories = [];
  assert.strictEqual(titlePosts(db).length, 2);
});
