const test = require('node:test');
const assert = require('node:assert');
const { toTemplate, fill, personalTitles } = require('../lib/titles');

const words = ['트렌치코트', '가디건', '니트', '코트'].sort((a, b) => b.length - a.length);

test('제목 틀 만들기: 아이템·월·계절 자리를 비우고, 브랜드 제목은 제외', () => {
  assert.strictEqual(toTemplate('10월 트렌치코트 3종 비교 후기 | 키 160 기준', words), '{month}월 {kw} 3종 비교 후기 | 키 160 기준');
  assert.strictEqual(toTemplate('[데일리룩] 가을 출근룩, 가디건 하나로 끝', words), '[데일리룩] {season} 출근룩, {kw} 하나로 끝');
  assert.strictEqual(toTemplate('자라 니트 후기', words), null);
  assert.strictEqual(toTemplate('카페 투어 일상', words), null);
});

test('채우기: 받침에 맞춰 조사 고치기', () => {
  assert.strictEqual(fill('{kw}와 니트 코디', '경량패딩', 10), '경량패딩과 니트 코디');
  assert.strictEqual(fill('{kw}과 청바지', '셔켓', 10), '셔켓과 청바지');
  assert.strictEqual(fill('{kw}과 청바지', '플리스', 10), '플리스와 청바지');
  assert.strictEqual(fill('{kw}를 고른 이유', '셔켓', 10), '셔켓을 고른 이유');
  assert.strictEqual(fill('{kw}로 완성한 {season}룩', '경량패딩', 10), '경량패딩으로 완성한 가을룩');
  assert.strictEqual(fill('{kw}로 끝', '머플러', 1), '머플러로 끝');
});

test('내 블로그 제목 스타일로 3개, 같은 틀은 한 번만', () => {
  const posts = [
    { title: '10월 트렌치코트 3종 비교 후기 | 키 160 기준' },
    { title: '9월 가디건 3종 비교 후기 | 키 160 기준' },
    { title: '[데일리룩] 가을 출근룩, 니트 하나로 끝' },
    { title: '카페 투어 일상' },
    { title: '코트 고를 때 꼭 보는 3가지' },
  ];
  assert.deepStrictEqual(personalTitles('경량패딩', posts, { month: 10 }), [
    '10월 경량패딩 3종 비교 후기 | 키 160 기준',
    '[데일리룩] 가을 출근룩, 경량패딩 하나로 끝',
    '경량패딩 고를 때 꼭 보는 3가지',
  ]);
  assert.deepStrictEqual(personalTitles('경량패딩', [], { month: 10 }), []);
});
