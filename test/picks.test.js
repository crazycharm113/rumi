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
