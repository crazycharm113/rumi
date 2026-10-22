// 콘텐츠 캘린더: 발행 예정 글, 협찬 마감, 세일·신상 일정, 기온 변화, 할인 정보 글 제안을 한 달력에
views.calendar = async (parts, params) => {
  loading();
  const month = params.get('month') || kstDate().slice(0, 7);
  const c = await api(`/api/calendar?month=${month}`);
  const [y, m] = c.month.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const firstDow = new Date(c.from + 'T00:00:00').getDay();
  const today = kstDate();
  const cells = [...Array(firstDow).fill(null), ...Object.keys(c.days)];

  $app.innerHTML = `
    <h1>콘텐츠 캘린더</h1>
    <p class="lede">발행 예정일과 놓치면 안 되는 시기를 한 달력에 겹쳐 봅니다.</p>
    <div class="section-head section">
      <div class="row">
        <a class="btn sm" href="#/calendar?month=${prev}" aria-label="이전 달">←</a>
        <h2 style="margin:0;min-width:110px;text-align:center">${y}년 ${m}월</h2>
        <a class="btn sm" href="#/calendar?month=${next}" aria-label="다음 달">→</a>
        ${c.month !== today.slice(0, 7) ? `<a class="btn ghost sm" href="#/calendar">이번 달</a>` : ''}
      </div>
      <div class="row">
        <button class="btn sm" onclick="editEvent()">+ 세일·신상 일정</button>
        <button class="btn primary sm" onclick="scheduleTopic('', '', '${today}')">+ 글 일정</button>
      </div>
    </div>
    <div class="legend small muted row">
      <span class="cal-item s-idea">구상</span><span class="cal-item s-shoot">촬영</span><span class="cal-item s-write">작성</span><span class="cal-item s-done">발행</span>
      <span class="cal-item deadline">협찬 마감</span><span class="cal-item ev-sale">세일</span><span class="cal-item ev-launch">신상</span>
      <span class="cal-item weather">기온 하강</span><span class="cal-item suggest">할인 글 제안</span>
      <span class="cal-item peak">작년 정점</span><span class="cal-item prepare">준비 시작</span>
    </div>
    <div class="cal">
      ${'일월화수목금토'.split('').map((d, i) => `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('')}
      ${cells.map((d) => d ? `<div class="cal-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}">
          <div class="cal-date">${Number(d.slice(8))}</div>
          ${c.days[d].map((it) => calCell(it)).join('')}
          <button class="cal-add" title="${mmdd(d)}에 글 일정 추가" aria-label="${mmdd(d)}에 글 일정 추가" onclick="scheduleTopic('', '', '${d}')">+</button>
        </div>` : '<div class="cal-day empty-cell"></div>').join('')}
    </div>

    <section class="section card">
      <h2>세일·신상 일정</h2>
      ${c.events.length ? `<ul class="plain">${c.events.sort((a, b) => a.start.localeCompare(b.start)).map((e) => `<li class="row">
        <span class="cal-item ev-${e.type}">${e.type === 'sale' ? '세일' : e.type === 'launch' ? '신상' : '기타'}</span>
        <span class="spacer">${esc(e.title)} ${e.brand ? `<span class="muted small">${esc(e.brand)}</span>` : ''}</span>
        <span class="small muted">${esc(mmdd(e.start))}${e.end && e.end !== e.start ? ` ~ ${esc(mmdd(e.end))}` : ''}</span>
        <button class="btn ghost sm" onclick='editEvent(${esc(JSON.stringify(e))})'>수정</button>
      </li>`).join('')}</ul>` : '<p class="muted small">브랜드 세일 기간이나 신상 출시일을 넣어 두면 달력에 함께 보여요.</p>'}
    </section>`;
};

function calCell(it) {
  const short = (s) => esc(s.length > 18 ? s.slice(0, 17) + '…' : s);
  if (it.kind === 'post') return `<a class="cal-item ${POST_STATUS_CLASS[it.status] || ''}" href="#/boards/${it.boardId}" title="${esc(it.title)}">${short(it.title)}</a>`;
  if (it.kind === 'deadline') return `<a class="cal-item deadline" href="#/boards/${it.boardId}" title="${esc(it.title)}">⏰ ${short(it.title.replace('협찬 마감: ', ''))}${it.disclosure ? '' : ' ⚠'}</a>`;
  if (it.kind === 'event') return it.first ? `<span class="cal-item ev-${it.type}" title="${esc(it.title)}">${short(it.title)}</span>` : `<span class="cal-item ev-${it.type} cont" title="${esc(it.title)}">&nbsp;</span>`;
  if (it.kind === 'suggest') return `<a class="cal-item suggest" href="#/boards/${it.boardId}" title="${esc(it.title)}">💡 ${short(it.title.replace('할인 정보 글 후보: ', ''))}</a>`;
  if (it.kind === 'weather') return `<span class="cal-item weather" title="${esc(it.title)}">🌡 ${short(it.title)}</span>`;
  if (it.kind === 'peak') return `<span class="cal-item peak" title="작년 쇼핑 클릭이 가장 많았던 주를 올해로 옮긴 날">📈 ${short(it.word)} 정점</span>`;
  if (it.kind === 'prepare') return `<button class="cal-item prepare" title="정점 2주 전: 지금 글을 준비하면 좋아요" onclick="scheduleTopic('${esc(it.word)}', '${esc(it.word)} 코디 추천')">✍️ ${short(it.word)} 준비</button>`;
  return '';
}

async function editEvent(e = null) {
  const editing = Boolean(e?.id);
  const r = await dialog(editing ? '일정 수정' : '세일·신상 일정 추가', [
    { name: 'type', label: '종류', value: e?.type || 'sale', options: [{ value: 'sale', label: '세일' }, { value: 'launch', label: '신상 출시' }, { value: 'etc', label: '기타' }] },
    { name: 'title', label: '이름', value: e?.title || '', required: true },
    { name: 'brand', label: '브랜드 (선택)', value: e?.brand || '' },
    { name: 'start', label: '시작일', type: 'date', value: e?.start || kstDate(), required: true },
    { name: 'end', label: '종료일 (선택)', type: 'date', value: e?.end || '' },
  ], { extra: editing ? `<button class="btn danger sm" value="delete" formnovalidate style="justify-self:start">이 일정 삭제</button>` : '' });
  if (!r) return;
  if (r._action === 'delete') {
    if (confirm('이 일정을 삭제할까요?')) {
      await api(`/api/events/${e.id}`, { method: 'DELETE' });
      route();
    }
    return;
  }
  if (editing) await api(`/api/events/${e.id}`, { method: 'PUT', body: r });
  else await api('/api/events', { method: 'POST', body: r });
  toast('저장했어요');
  route();
}
