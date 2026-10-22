// 관심 브랜드의 할인·신상 모음과 내 상품 알림
views.brands = async () => {
  loading();
  const f = await api('/api/brand-feed');
  const brands = Object.entries(f.brands || {});
  $app.innerHTML = `
    <h1>할인·신상</h1>
    <p class="lede">관심 브랜드의 세일·신상 소식을 최근 2주 블로그 글에서 모았어요. 세일 기간을 확인하면 캘린더에 넣어 두세요.</p>
    ${f.demo ? dataBanner(f, '할인·신상 소식') : ''}
    ${!f.brandsSet && !f.demo ? `<div class="card empty">관심 브랜드를 <a href="#/settings">설정</a>에 넣어 주세요. 예: 탑텐, 무신사 스탠다드, 자라</div>` : ''}
    ${f.error ? `<div class="banner stale">${esc(f.error)}</div>` : ''}
    <div class="row section">
      <span class="small muted">${f.fetchedAt ? `갱신: ${esc(timeText(f.fetchedAt))} · 하루 한 번 자동으로 가져와요` : ''}</span>
      <span class="spacer"></span>
      ${!f.demo && f.brandsSet ? `<button class="btn sm" id="refreshFeed">지금 가져오기</button>` : ''}
    </div>
    ${f.pending ? '<div class="card empty">처음 가져오는 중이에요. 잠시 뒤 새로고침해 주세요.</div>' : ''}
    ${brands.map(([name, b]) => `
      <section class="section card">
        <h2>${esc(name)}</h2>
        ${b.error ? `<p class="chip down">${esc(b.error)}</p>` : ''}
        <div class="grid grid-2">
          <div><div class="sub-head">세일·할인 소식 ${b.sale.length}</div>${newsList(b.sale, name, 'sale')}</div>
          <div><div class="sub-head">신상 소식 ${b.launch.length}</div>${newsList(b.launch, name, 'launch')}</div>
        </div>
      </section>`).join('')}
    <p class="small muted section">네이버 쇼핑 검색 API가 2026년 7월 31일 종료되어, 상품 가격 대신 블로그에 올라온 소식을 보여드려요. 실제 세일 기간과 가격은 브랜드 공식몰에서 확인하세요.
      상품을 상품 보드에 담으면 그 상품의 가격·품절은 따로 지켜봐요.</p>`;
  document.getElementById('refreshFeed')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = '가져오는 중…';
    try { await api('/api/brand-feed/refresh', { method: 'POST' }); } catch (err) { toast(err.message); }
    route();
  });
};

function newsList(list, brand, type) {
  if (!list.length) return '<p class="muted small">최근 2주 동안 올라온 글이 없어요.</p>';
  return `<ul class="news">${list.map((p) => `<li>
    <div class="grow">
      <a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${p.isNew ? '<b class="tag-new">NEW</b> ' : ''}${esc(p.title)}</a>
      <div class="small muted">${esc(p.date ? mmdd(p.date) : '')}</div>
    </div>
    <button class="btn ghost sm" data-ev='${esc(JSON.stringify({ type, brand, title: `${brand} ${type === 'sale' ? '세일' : '신상 출시'}` }))}' onclick="editEvent(JSON.parse(this.dataset.ev))">캘린더에 넣기</button>
  </li>`).join('')}</ul>`;
}

views.alerts = async () => {
  loading();
  const { alerts, lastCheck, error } = await api('/api/alerts');
  $app.innerHTML = `
    <h1>내 상품 알림</h1>
    <p class="lede">상품 보드에 저장한 상품만 12시간마다 확인해서 가격 하락·품절·재입고를 알려드려요.</p>
    <div class="row">
      <span class="small muted">${lastCheck ? `마지막 확인: ${esc(timeText(lastCheck))}` : '아직 확인 전'}${error ? ` · 오류: ${esc(error)}` : ''}</span>
      <span class="spacer"></span>
      <button class="btn sm" id="checkAll">지금 전체 확인</button>
    </div>
    <section class="section card">
      ${alerts.length ? `<ul class="alert-list">${alerts.map((a) => alertRow(a).replace('</li>', `<button class="btn ghost sm" data-dismiss="${a.id}">지우기</button></li>`)).join('')}</ul>`
        : '<p class="muted">알림이 없어요.</p>'}
    </section>
    <p class="small muted">가격이 내려가면 캘린더에 '할인 정보 글' 후보로도 표시돼요. 발행한 글의 상품이 품절되면 '글 수정 필요'로 알려드려요.</p>`;
  if (alerts.some((a) => !a.read)) api('/api/alerts/read', { method: 'POST' }).then(updateBell);
  $app.querySelectorAll('[data-dismiss]').forEach((el) => el.addEventListener('click', async () => {
    await api(`/api/alerts/${el.dataset.dismiss}`, { method: 'DELETE' });
    route();
  }));
  document.getElementById('checkAll').addEventListener('click', async (e) => {
    e.target.disabled = true;
    await api('/api/alerts/check', { method: 'POST', body: {} });
    toast('확인을 시작했어요. 상품마다 몇 초씩 걸리니 잠시 뒤 새로고침해 주세요.');
  });
};
