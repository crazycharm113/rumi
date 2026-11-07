// 여러 모듈이 같이 쓰는 작은 도구
// 일을 size 개씩 동시에 처리합니다 (하나씩 기다리지 않게). 결과는 입력 순서대로 돌려줍니다.
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

module.exports = { pool };
