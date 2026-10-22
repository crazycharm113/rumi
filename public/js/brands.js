// 관심 브랜드의 할인·신상 모음과 내 상품 알림
views.brands = async () => {
  loading();
  const f = await api('/api/brand-feed');
  const brands = Object.entries(f.brands || {});
  $app.innerHTML = `
    <h1>할인·신상</h1>
    <p class="lede">관심 브랜드에서 가격이 내려간 상품과 새로 올라온 상품입니다. 마음에 들면 바로 상품 보드에 담으세요.</p>
    ${f.demo ? dataBanner(f, '할인·신상') : ''}
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
        <div class="section-head"><h2>${esc(name)}</h2>
          ${b.baseline ? '<span class="small muted">오늘부터 가격을 기록해요. 할인은 내일부터, 신상은 다음 갱신부터 보여요.</span>' : ''}</div>
        ${b.error ? `<p class="chip down">${esc(b.error)}</p>` : ''}
        <div class="grid grid-2">
          <div><div class="sub-head">가격 내려감 ${b.sales.length}</div>
            ${b.sales.length ? `<ul class="mini-products">${b.sales.slice(0, 10).map((x) => miniProduct({ ...x, tag: `${x.pct}%↓` })).join('')}</ul>` : '<p class="muted small">최근 14일 가격보다 5% 이상 내려간 상품이 없어요.</p>'}</div>
          <div><div class="sub-head">신상 ${b.launches.length}</div>
            ${b.launches.length ? `<ul class="mini-products">${b.launches.slice(0, 10).map((x) => miniProduct({ ...x, tag: '신상' })).join('')}</ul>`
              : b.recent?.length ? `<p class="muted small">새로 보인 상품은 없어요. 최근 등록순 상품:</p><ul class="mini-products">${b.recent.slice(0, 5).map((x) => miniProduct({ ...x, tag: '최근' })).join('')}</ul>` : '<p class="muted small">새로 보인 상품이 없어요.</p>'}</div>
        </div>
      </section>`).join('')}
    <p class="small muted section">네이버 쇼핑 검색 결과 기준입니다. 쇼핑몰에 따라 실제 판매가와 다를 수 있어요. 세일 기간은 <a href="#/calendar">캘린더</a>에 직접 넣을 수 있어요.</p>`;
  document.getElementById('refreshFeed')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = '가져오는 중…';
    try { await api('/api/brand-feed/refresh', { method: 'POST' }); } catch (err) { toast(err.message); }
    route();
  });
};

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
