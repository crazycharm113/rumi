// 홈: 오늘의 브리핑. 위에서 아래로 읽으면 하루 계획이 나오는 순서입니다.
views.home = async () => {
  loading('오늘의 브리핑을 준비하는 중…');
  const [b, settings] = await Promise.all([api('/api/briefing'), api('/api/settings')]);
  const dateText = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  $app.innerHTML = `
    <h1>${esc(dateText)}</h1>
    <p class="lede">오늘 올릴 만한 주제 6개와 그 이유, 블로거들이 많이 언급한 제품입니다.</p>
    ${dataBanner(b.keywordsMeta, '키워드 데이터')}
    ${b.shopError ? `<div class="banner stale">쇼핑인사이트를 가져오지 못해 구매 관심도 없이 보여드려요: ${esc(b.shopError)}</div>` : ''}

    ${[1, 2].includes(new Date().getDay()) ? `<div class="banner" style="background:var(--info-soft);color:var(--info)">📊 지난주 리포트가 준비됐어요. <a href="#/performance">성과에서 보기 →</a></div>` : ''}
    <section class="section card">${weatherBar(b.weather)}</section>

    <section class="section">
      <div class="section-head"><h2>오늘 올릴 주제 6개</h2>
        <div class="subtabs" role="tablist" aria-label="연령대">${TOPIC_AGES.map(([v, l]) => `<button role="tab" data-age="${v}" class="${v === topicAge(b.age) ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <p class="small muted" id="topicsNote" style="margin:-4px 0 10px">${topicsNote(b.ageLabel, b.topics)}</p>
      <div class="grid grid-3" id="topicsGrid">${topicsGrid(b.topics)}</div>
    </section>

    <div class="grid grid-2 section">
      <section class="card">
        <div class="section-head"><h2>급상승 키워드</h2>${ageSelect(b.age, settings.ages)}</div>
        <ol class="rank">${b.rising.map(risingRow).join('')}</ol>
        <div class="row" style="margin-top:10px"><a class="btn sm" href="#/keywords">키워드 기회 분석 전체 보기 →</a></div>
      </section>
      <section class="card">
        <div class="section-head"><h2>오늘의 할인·신상</h2><a class="btn sm" href="#/brands">전체 보기</a></div>
        ${brandFeedSummary(b.brandFeed)}
      </section>
    </div>

    <div class="grid grid-2 section">
      <section class="card">
        <div class="section-head"><h2>내 상품 알림</h2><a class="btn sm" href="#/alerts">전체 보기</a></div>
        ${b.alerts.length ? `<ul class="alert-list">${b.alerts.slice(0, 5).map(alertRow).join('')}</ul>`
          : `<p class="muted small">상품 보드에 저장한 상품의 가격이 내려가거나 품절·재입고되면 여기에 알려드려요. (12시간마다 확인)</p>`}
      </section>
      <section class="card">
        <div class="section-head"><h2>이번 주 일정</h2><a class="btn sm" href="#/calendar">캘린더</a></div>
        ${weekList(b.week)}
        ${b.upcomingPeaks.length ? `<div class="sub-head">곧 준비할 시즌 글 · 작년 쇼핑 클릭 정점 기준${b.peaksDemo ? ' (예시)' : ''}</div>
          <ul class="plain">${b.upcomingPeaks.map((p) => `<li class="row">
            <span class="spacer"><b>${esc(p.word)}</b> <span class="small muted">정점 ${esc(mmdd(p.peak))} · 준비 ${esc(mmdd(p.prepare))}부터</span></span>
            <button class="btn sm" data-w="${esc(p.word)}" data-d="${p.prepare <= kstDate() ? kstDate(1) : p.prepare}" onclick="scheduleTopic(this.dataset.w, this.dataset.w + ' 코디 추천', this.dataset.d)">일정 잡기</button>
          </li>`).join('')}</ul>` : ''}
        ${b.emptyDays.length ? `<div class="sub-head">비어 있는 날</div>
          <ul class="plain">${b.emptyDays.slice(0, 4).map((d) => `<li class="row">
            <span class="small muted" style="width:52px">${esc(mmdd(d.date))} ${'일월화수목금토'[new Date(d.date + 'T00:00:00').getDay()]}</span>
            ${d.topic ? `<span class="spacer">${esc(d.topic.word)} 글 어때요?</span>
              <button class="btn sm" data-w="${esc(d.topic.word)}" data-t="${esc(d.topic.titleIdeas[0])}" data-d="${d.date}"
                onclick="scheduleTopic(this.dataset.w, this.dataset.t, this.dataset.d)">이날 올리기</button>` : '<span class="muted small">주제 없음</span>'}
          </li>`).join('')}</ul>` : ''}
      </section>
    </div>
    <p class="small muted section">키워드 갱신: ${esc(timeText(b.keywordsMeta.fetchedAt) || '예시')} ·
      <button class="btn ghost sm" onclick="refreshAll()">지금 새로 가져오기</button></p>
  `;
  bindTopicTabs();
};

// ---- 연령대별 오늘 올릴 주제 ----
const TOPIC_AGES = [['all', '전체'], ['10', '10대'], ['20', '20대'], ['30', '30대'], ['40', '40대']];
const topicAge = (age) => (TOPIC_AGES.some(([v]) => v === age) ? age : 'all');

function topicsGrid(topics) {
  return topics.length ? topics.map(topicCard).join('') : `<div class="card empty">추천할 주제가 없습니다. <a href="#/settings">키워드</a>를 더 추가해 보세요.</div>`;
}

function topicsNote(ageLabel, topics) {
  return `${esc(ageLabel)} 검색·쇼핑 기준 · 기회 점수는 참고용${topics[0]?.titleSource === 'noblog' ? ' · <a href="#/settings">블로그 아이디</a>를 넣으면 내 제목 스타일로 추천해요' : ''}`;
}

// 연령 버튼: 그 연령의 검색·쇼핑 데이터로 주제 6개를 다시 고릅니다(연령마다 하루 한 번 받아 저장).
function bindTopicTabs() {
  $app.querySelectorAll('[data-age]').forEach((btn) => btn.addEventListener('click', async () => {
    $app.querySelectorAll('[data-age]').forEach((x) => x.classList.toggle('on', x === btn));
    const grid = document.getElementById('topicsGrid');
    grid.innerHTML = `<div class="card empty" style="grid-column:1/-1">${esc(btn.textContent)} 주제를 고르는 중… (처음 볼 때는 몇 초 걸려요)</div>`;
    try {
      const r = await api(`/api/topics?age=${btn.dataset.age}`);
      grid.innerHTML = topicsGrid(r.topics);
      document.getElementById('topicsNote').innerHTML = topicsNote(r.ageLabel, r.topics);
    } catch (err) {
      grid.innerHTML = `<div class="card empty" style="grid-column:1/-1">주제를 가져오지 못했어요: ${esc(err.message)}</div>`;
    }
  }));
}

function weatherBar(w) {
  if (!w || w.error && !w.today) return `<div class="weather"><span class="muted">날씨를 가져오지 못했습니다. ${esc(w?.error || '')}</span></div>`;
  const t = w.today;
  const diffY = w.diffYesterday == null ? '' : `어제보다 ${w.diffYesterday === 0 ? '비슷' : `${Math.abs(w.diffYesterday)}°C ${w.diffYesterday > 0 ? '높음' : '낮음'}`}`;
  const diffT = w.diffTomorrow == null ? '' : `내일 ${w.diffTomorrow === 0 ? '비슷' : `${Math.abs(w.diffTomorrow)}°C ${w.diffTomorrow > 0 ? '오름' : '내려감'}`}`;
  return `<div class="weather">
    <div><div class="small muted">${esc(w.region)} 오늘${w.demo ? ' · 예시' : ''}</div><div class="temp">${t.tmn}° / ${t.tmx}°</div></div>
    <div class="meta">
      <span>${esc(t.sky || '')}${t.pop ? ` · 강수확률 ${t.pop}%` : ''}</span>
      <span class="small muted">${[diffY, diffT].filter(Boolean).join(' · ')}</span>
    </div>
    <div class="meta">
      <span class="small muted">평균 ${t.avg}°C · ${esc(w.clothing.label)}</span>
      <div class="wear">${w.clothing.items.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</div>
    </div>
    ${w.drop ? `<div class="alert">📉 ${esc(mmdd(w.drop.date))} 평균 기온이 ${Math.abs(w.drop.diff)}°C 떨어집니다. ${esc(w.drop.clothing.items.slice(0, 3).join(', '))} 글을 미리 준비해 두세요.</div>` : ''}
    ${w.stale ? `<div class="alert">마지막 날씨(${esc(timeText(w.fetchedAt))})를 보여줍니다.</div>` : ''}
  </div>`;
}

function topicCard(t, i) {
  return `<article class="card topic">
    <div class="num">주제 ${i + 1}</div>
    <h3>${esc(t.word)}</h3>
    <div class="reasons">${t.reasons.map((r) => `<span class="chip ${r.kind}">${esc(r.text)}</span>`).join('')}
      ${audienceChip(t.audience)}</div>
    <div><div class="small muted">제목 아이디어${t.titleSource === 'mine' ? ' · <span class="tag-new">내 블로그 제목 스타일</span>' : ''}</div>
      <ul class="titles">${t.titleIdeas.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    ${picksBlock(t)}
    <div class="foot">
      <span class="small muted">기회 점수 <span class="score">${t.score}</span></span>
      <span class="row">
        <button class="btn sm" data-word="${esc(t.word)}" data-title="${esc(t.titleIdeas[0])}" onclick="scheduleTopic(this.dataset.word, this.dataset.title)">캘린더에 올리기</button>
        <button class="btn primary sm" data-word="${esc(t.word)}" data-title="${esc(t.titleIdeas[0])}" onclick="makeBoard(this.dataset.word, this.dataset.title)">상품 보드 만들기</button>
      </span>
    </div>
  </article>`;
}

// 누가 찾는지: 쇼핑 클릭 기준 성별·연령
function audienceChip(a) {
  if (!a) return '';
  const parts = [];
  if (a.female != null) parts.push(`여성 ${a.female}%`);
  if (a.topAge) parts.push(`${a.topAge.label} ${a.topAge.share}%`);
  return `<span class="chip target" title="최근 30일 네이버 쇼핑 클릭 기준 (전체 연령)">👤 클릭 ${esc(a.label)} 중심${parts.length ? ` (${esc(parts.join(', '))})` : ''}</span>`;
}

// 주제별 추천 제품: 블로거들이 많이 언급한 제품 + 내 보드에 담아 둔 같은 종류 상품
function picksBlock(t) {
  const p = t.picks || { items: [], mine: [], reviews: [] };
  if (p.error) return `<div class="picks small muted">추천 제품을 가져오지 못했어요.</div>`;
  const items = p.items || [];
  const reviews = p.reviews || [];
  return `<div class="picks"><div class="small muted">추천 제품 · 블로그 언급 기준${p.demo ? ' (예시)' : ''}</div>
    ${items.length ? `<ul>${items.map((x) => `<li>
      <a class="pick-name" href="${esc(x.shopUrl)}" target="_blank" rel="noopener noreferrer" title="네이버 쇼핑에서 검색">${esc(x.name)}&nbsp;↗</a>
      <span class="pick-meta small muted">언급 ${x.mentions}회${x.review?.link && x.review.link !== '#' ? ` · <a href="${esc(x.review.link)}" target="_blank" rel="noopener noreferrer" title="${esc(x.review.title)}">후기</a>` : ''}</span>
      <button class="btn ghost sm pick-add" data-x='${esc(JSON.stringify({ name: x.name, brand: x.brand, memo: `네이버 쇼핑 검색: ${x.shopUrl}` }))}' data-kw="${esc(t.word)}" onclick="addToBoard(JSON.parse(this.dataset.x), this.dataset.kw)">담기</button>
    </li>`).join('')}</ul>`
    : `<p class="small muted" style="margin:4px 0">블로그 글에서 자주 언급된 브랜드 제품을 찾지 못했어요. 아래 후기 글과 쇼핑 검색을 참고하세요.</p>
       ${reviews.length ? `<ul>${reviews.map((r) => `<li><a class="pick-review" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">📝 ${esc(r.title)}</a></li>`).join('')}</ul>` : ''}`}
    ${(p.mine || []).map((x) => `<div class="small"><a href="#/boards/${x.boardId}">내 보드: ${esc(x.name || '이름 없음')}</a>${x.price ? ` <span class="muted">${won(x.price)}</span>` : ''}</div>`).join('')}
    ${p.searchUrl ? `<a class="small pick-search" href="${esc(p.searchUrl)}" target="_blank" rel="noopener noreferrer">네이버 쇼핑에서 '${esc(t.word)}' 전체 보기&nbsp;↗</a>` : ''}
  </div>`;
}

// 추천 제품을 기존 보드나 새 보드에 담습니다.
async function addToBoard(product, keyword) {
  const boards = await api('/api/boards');
  const r = await dialog('상품 보드에 담기', [
    { name: 'board', label: '어느 글에 담을까요?', value: boards.find((b) => b.keyword === keyword)?.id || 'new',
      options: [...boards.map((b) => ({ value: b.id, label: b.title })), { value: 'new', label: `+ 새 보드 만들기 (${keyword})` }] },
  ], { submit: '담기' });
  if (!r) return;
  let id = r.board;
  if (id === 'new') id = (await api('/api/boards', { method: 'POST', body: { keyword, title: `${keyword} 추천` } })).id;
  await api(`/api/boards/${id}/products`, { method: 'POST', body: product });
  toast('보드에 담았어요. 실제 상품 링크를 붙여넣으면 가격도 지켜봐요.');
}

function risingRow(r) {
  let move = '<span class="move muted">–</span>';
  if (r.move === 'new') move = '<span class="move new">NEW</span>';
  else if (r.move > 0) move = `<span class="move up">▲${r.move}</span>`;
  else if (r.move < 0) move = `<span class="move down">▼${-r.move}</span>`;
  return `<li><span class="n">${r.rank}</span>
    <a class="w" href="#/keywords?focus=${encodeURIComponent(r.word)}">${esc(r.word)}</a>
    <span class="pct ${r.change > 0 ? 'up' : r.change < 0 ? 'down' : ''}">${signed(r.change)}%</span>${move}</li>`;
}

function brandFeedSummary(f) {
  if (!f.brandsSet && !f.demo) return `<p class="muted small">관심 브랜드를 <a href="#/settings">설정</a>에 넣으면 세일·신상 소식을 모아 드려요.</p>`;
  if (f.pending) return `<p class="muted small">관심 브랜드 소식을 가져오는 중이에요. 잠시 뒤 새로고침해 주세요.</p>`;
  const items = Object.entries(f.brands || {}).flatMap(([brand, b]) => [
    ...(b.sale || []).map((p) => ({ ...p, brand, tag: '세일' })),
    ...(b.launch || []).map((p) => ({ ...p, brand, tag: '신상' })),
  ]).sort((x, y) => (y.isNew - x.isNew) || (y.date || '').localeCompare(x.date || '')).slice(0, 6);
  if (!items.length) return `<p class="muted small">최근 2주 동안 관심 브랜드의 세일·신상 소식이 없어요.</p>`;
  return `${f.demo ? '<p class="chip warn" style="margin:0 0 8px">예시 데이터</p>' : ''}
    <ul class="news">${items.map((p) => `<li><div class="grow">
      <div class="small muted">${esc(p.brand)} · <b class="${p.tag === '세일' ? 'tag-sale' : 'tag-new'}">${p.tag}</b> · ${esc(mmdd(p.date))}${p.isNew ? ' · <b class="tag-new">NEW</b>' : ''}</div>
      <a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" class="clip" style="display:block">${esc(p.title)}</a></div></li>`).join('')}</ul>`;
}

// 알림 종류: 저장 상품 가격·품절, 발행 글 검색 누락
const ALERT_ICON = { not_indexed: '🔍', price_drop: '⬇️', price_up: '⬆️', sold_out: '⛔', fix_post: '✏️', restock: '🔄' };

function alertRow(a) {
  return `<li class="${a.read ? '' : 'unread'} ${a.kind === 'fix_post' ? 'important' : ''}">
    <span aria-hidden="true">${ALERT_ICON[a.kind] || '•'}</span>
    <div class="grow"><a href="${esc(a.link || `#/boards/${a.boardId}`)}"><b>${esc(a.productName)}</b></a>
      <div class="small">${esc(a.text)}</div>
      <div class="small muted">${esc(a.boardTitle)} · ${esc(mmdd(a.date))}</div></div>
  </li>`;
}

const POST_STATUS_CLASS = { 구상: 's-idea', 촬영: 's-shoot', 작성: 's-write', 발행: 's-done' };

function weekList(week) {
  // 여러 날 이어지는 일정은 처음 보이는 날에 한 번만 보여줍니다.
  const seen = new Set();
  const rows = Object.entries(week).flatMap(([d, items]) => items.map((it) => ({ d, ...it }))).filter((r) => {
    if (r.kind !== 'event') return true;
    if (seen.has(r.eventId)) return false;
    seen.add(r.eventId);
    return true;
  });
  if (!rows.length) return '<p class="muted small">이번 주에 잡힌 일정이 없어요.</p>';
  return `<ul class="plain">${rows.slice(0, 8).map((r) => `<li class="row">
    <span class="small muted" style="width:52px">${esc(mmdd(r.d))} ${'일월화수목금토'[new Date(r.d + 'T00:00:00').getDay()]}</span>
    ${calItemLabel(r)}</li>`).join('')}</ul>`;
}

function calItemLabel(it) {
  if (it.kind === 'post') return `<a class="cal-item ${POST_STATUS_CLASS[it.status] || ''}" href="#/boards/${it.boardId}">${esc(it.status)} · ${esc(it.title)}${it.sponsored ? ' <b>협찬</b>' : ''}</a>`;
  if (it.kind === 'deadline') return `<a class="cal-item deadline" href="#/boards/${it.boardId}">⏰ ${esc(it.title)}${it.disclosure ? '' : ' · 광고표시 미확인'}</a>`;
  if (it.kind === 'event') return `<span class="cal-item ev-${it.type}">${esc(it.typeLabel)} · ${esc(it.title)}</span>`;
  if (it.kind === 'suggest') return `<a class="cal-item suggest" href="#/boards/${it.boardId}">💡 ${esc(it.title)}</a>`;
  if (it.kind === 'weather') return `<span class="cal-item weather">🌡 ${esc(it.title)}</span>`;
  if (it.kind === 'peak') return `<span class="cal-item peak">📈 ${esc(it.title)}</span>`;
  if (it.kind === 'prepare') return `<span class="cal-item prepare">✍️ ${esc(it.title)}</span>`;
  return '';
}
