// 2단계: 콘텐츠 캘린더. 발행 예정 글, 협찬 마감, 직접 넣은 세일·신상 일정, 기온이 크게 바뀌는 날,
// 할인 정보 글 제안을 한 달력에 겹쳐 보여줍니다.
const store = require('./store');

const EVENT_TYPES = { sale: '세일', launch: '신상 출시', etc: '기타' };

function inRange(d, from, to) {
  return d >= from && d <= to;
}

function eachDay(from, to) {
  const out = [];
  for (let t = new Date(from + 'T00:00:00Z'); t <= new Date(to + 'T00:00:00Z'); t = new Date(t.getTime() + 864e5)) out.push(t.toISOString().slice(0, 10));
  return out;
}

// from~to 사이의 날짜별 항목. weatherDays는 기상청 예보 요약({날짜: {avg,...}}).
function build({ boards, events, alerts }, from, to, weatherDays = {}, peaks = {}) {
  const days = Object.fromEntries(eachDay(from, to).map((d) => [d, []]));
  const push = (d, item) => { if (days[d]) days[d].push(item); };

  for (const b of boards) {
    if (b.plannedDate) {
      push(b.plannedDate, {
        kind: 'post', boardId: b.id, title: b.title, status: b.postStatus || '구상',
        sponsored: b.products.some((p) => p.type === '협찬'),
      });
    }
    if (b.sponsorDeadline) {
      push(b.sponsorDeadline, { kind: 'deadline', boardId: b.id, title: `협찬 마감: ${b.title}`, disclosure: Boolean(b.checklist?.disclosure) });
    }
  }
  for (const e of events) {
    for (const d of eachDay(e.start, e.end || e.start)) {
      if (inRange(d, from, to)) push(d, { kind: 'event', eventId: e.id, type: e.type, typeLabel: EVENT_TYPES[e.type] || '기타', title: e.title, brand: e.brand || '', first: d === e.start });
    }
  }
  for (const a of alerts) {
    if (a.kind === 'price_drop' && !a.dismissed) push(a.date, { kind: 'suggest', boardId: a.boardId, title: `할인 정보 글 후보: ${a.productName} ${a.pct}%↓` });
  }
  // 작년 쇼핑 클릭 정점을 올해로 옮긴 날과, 그 2주 전 '준비 시작'
  for (const [word, p] of Object.entries(peaks)) {
    push(p.peak, { kind: 'peak', word, title: `${word} 작년 정점` });
    push(p.prepare, { kind: 'prepare', word, title: `${word} 글 준비 시작` });
  }
  // 기온: 전날보다 평균 4도 이상 내려가는 날 표시
  const wd = Object.keys(weatherDays).sort();
  for (let i = 1; i < wd.length; i++) {
    const diff = weatherDays[wd[i]].avg - weatherDays[wd[i - 1]].avg;
    if (diff <= -4) push(wd[i], { kind: 'weather', title: `기온 ${Math.round(Math.abs(diff))}°C 하강 (평균 ${weatherDays[wd[i]].avg}°C)` });
  }
  return days;
}

// 앞으로 7일 중 발행 예정 글이 없는 날과, 그날 쓸 만한 주제 제안
function emptyDays(boards, topics, today = store.kstDate()) {
  const taken = new Set(boards.map((b) => b.plannedDate).filter(Boolean));
  const out = [];
  let i = 0;
  for (const d of eachDay(today, store.kstDate(6, new Date(today + 'T12:00:00+09:00')))) {
    if (taken.has(d)) continue;
    out.push({ date: d, topic: topics.length ? topics[i++ % topics.length] : null });
  }
  return out;
}

module.exports = { build, emptyDays, eachDay, EVENT_TYPES };
