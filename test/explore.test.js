const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
const service = require('../lib/service');

// 키가 없으면 예시 데이터로 돌아가므로, 외부 호출 없이 페이지 나누기와 필터를 확인할 수 있습니다.
test('주제 더 보기: 브리핑 6개를 뺀 7위부터, 겹치지 않고 12개씩 이어짐', async () => {
  const brief = await service.getTopics('all');
  const briefWords = brief.topics.map((t) => t.word);
  assert.strictEqual(briefWords.length, 6);

  const p1 = await service.getMoreTopics({ age: 'all', offset: 0, limit: 12 });
  assert.strictEqual(p1.topics.length, 12);
  assert.ok(p1.topics.every((t) => !briefWords.includes(t.word)));
  assert.deepStrictEqual(p1.topics.map((t) => t.rank), Array.from({ length: 12 }, (_, i) => 7 + i));
  assert.ok(p1.topics[0].picks && p1.topics[0].titleIdeas.length > 0);
  assert.strictEqual(p1.hasMore, p1.total > 12);

  const p2 = await service.getMoreTopics({ age: 'all', offset: 12, limit: 12 });
  const words = [...p1.topics, ...p2.topics].map((t) => t.word);
  assert.strictEqual(new Set(words).size, words.length); // 중복 없음
  assert.strictEqual(p2.topics[0].rank, 19);
  assert.strictEqual(p1.total, p1.allCount);
});

test('주제 더 보기: 종류·검색 필터, 연령 선택', async () => {
  const all = await service.getMoreTopics({ limit: 30 });
  const cats = all.categories.map((c) => c.name);
  assert.ok(cats.length >= 2);
  const cat = all.categories[0];
  const byCat = await service.getMoreTopics({ cat: cat.name, limit: 30 });
  assert.strictEqual(byCat.total, cat.count);
  assert.ok(byCat.topics.every((t) => t.category === cat.name));

  const word = all.topics[0].word.slice(0, 2);
  const byQ = await service.getMoreTopics({ q: word, limit: 30 });
  assert.ok(byQ.topics.length > 0 && byQ.topics.every((t) => t.word.includes(word)));

  const thirties = await service.getMoreTopics({ age: '30', limit: 3 });
  assert.strictEqual(thirties.age, '30');
  assert.ok(thirties.topics[0].titleIdeas.some((x) => x.includes('30대')) || thirties.topics.length > 0);
  const none = await service.getMoreTopics({ q: '없는키워드zzz' });
  assert.deepStrictEqual([none.topics.length, none.total, none.hasMore], [0, 0, false]);
});
