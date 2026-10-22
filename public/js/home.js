// 홈: 오늘의 브리핑. 위에서 아래로 읽으면 하루 계획이 나오는 순서입니다.
views.home = async () => {
  loading('오늘의 브리핑을 준비하는 중…');
  const [b, settings] = await Promise.all([api('/api/briefing'), api('/api/settings')]);
  const dateText = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  $app.innerHTML = `
    <h1>${esc(dateText)}</h1>
    <p class="lede">오늘 올릴 만한 주제 3개와 그 이유입니다.</p>
    ${dataBanner(b.keywordsMeta, '키워드 데이터')}

    <section class="section card">${weatherBar(b.weather)}</section>

    <section class="section">
      <div class="section-head"><h2>오늘 올릴 주제 3개</h2>
        <span class="small muted">${esc(b.ageLabel)} 기준 · 기회 점수는 참고용</span></div>
      <div class="grid grid-3">
        ${b.topics.length ? b.topics.map(topicCard).join('') : `<div class="card empty">추천할 주제가 없습니다. <a href="#/settings">키워드</a>를 더 추가해 보세요.</div>`}
      </div>
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
};

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
    <div class="reasons">${t.reasons.map((r) => `<span class="chip ${r.kind}">${esc(r.text)}</span>`).join('')}</div>
    <div><div class="small muted">제목 아이디어</div>
      <ul class="titles">${t.titleIdeas.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="foot">
      <span class="small muted">기회 점수 <span class="score">${t.score}</span></span>
      <span class="row">
        <button class="btn sm" data-word="${esc(t.word)}" data-title="${esc(t.titleIdeas[0])}" onclick="scheduleTopic(this.dataset.word, this.dataset.title)">캘린더에 올리기</button>
        <button class="btn primary sm" data-word="${esc(t.word)}" data-title="${esc(t.titleIdeas[0])}" onclick="makeBoard(this.dataset.word, this.dataset.title)">상품 보드 만들기</button>
      </span>
    </div>
  </article>`;
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
  if (!f.brandsSet && !f.demo) return `<p class="muted small">관심 브랜드를 <a href="#/settings">설정</a>에 넣으면 할인·신상을 모아 드려요.</p>`;
  if (f.pending) return `<p class="muted small">관심 브랜드 상품을 가져오는 중이에요. 잠시 뒤 새로고침해 주세요.</p>`;
  const all = Object.values(f.brands || {});
  const sales = all.flatMap((x) => x.sales || []).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const launches = all.flatMap((x) => x.launches || []).slice(0, 3);
  if (!sales.length && !launches.length) return `<p class="muted small">오늘은 새로 내려간 가격이나 신상이 없어요. 가격 기록이 쌓일수록 정확해져요.</p>`;
  return `${f.demo ? '<p class="chip warn" style="margin:0 0 8px">예시 데이터</p>' : ''}
    <ul class="mini-products">${[...sales.map((x) => ({ ...x, tag: `${x.pct}%↓` })), ...launches.map((x) => ({ ...x, tag: '신상' }))].map(miniProduct).join('')}</ul>`;
}

function miniProduct(x) {
  return `<li>
    ${x.image ? `<img src="${esc(x.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<span class="ph"></span>'}
    <div class="grow"><div class="small muted">${esc(x.brand)}</div><div class="clip">${esc(x.title)}</div>
      <div class="small"><b class="${x.tag === '신상' ? 'tag-new' : 'tag-sale'}">${esc(x.tag)}</b> ${won(x.price)} ${x.before ? `<s class="muted">${won(x.before)}</s>` : ''}</div></div>
    <button class="btn sm" data-x='${esc(JSON.stringify({ url: x.link, name: x.title, brand: x.brand, price: x.price, originalPrice: x.before || null, image: x.image }))}' onclick="addToBoard(JSON.parse(this.dataset.x))">보드에 담기</button>
  </li>`;
}

// 할인·신상 상품을 기존 보드나 새 보드에 담습니다.
async function addToBoard(product) {
  const boards = await api('/api/boards');
  const r = await dialog('상품 보드에 담기', [
    { name: 'board', label: '어느 글에 담을까요?', value: boards[0]?.id || 'new', options: [...boards.map((b) => ({ value: b.id, label: b.title })), { value: 'new', label: '+ 새 보드 만들기' }] },
  ], { submit: '담기' });
  if (!r) return;
  let id = r.board;
  if (id === 'new') id = (await api('/api/boards', { method: 'POST', body: { title: `${product.brand} ${product.originalPrice ? '할인' : '신상'} 소식` } })).id;
  await api(`/api/boards/${id}/products`, { method: 'POST', body: product });
  toast('보드에 담았어요');
}

const ALERT_ICON = { price_drop: '⬇️', price_up: '⬆️', sold_out: '⛔', fix_post: '✏️', restock: '🔄' };

function alertRow(a) {
  return `<li class="${a.read ? '' : 'unread'} ${a.kind === 'fix_post' ? 'important' : ''}">
    <span aria-hidden="true">${ALERT_ICON[a.kind] || '•'}</span>
    <div class="grow"><a href="#/boards/${a.boardId}"><b>${esc(a.productName)}</b></a>
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
  return '';
}
