// 셀럽 착장: 연예인·유명인 패션 기사에서 Claude가 뽑은 착장 목록
let celebFilter = '';

views.celeb = async () => {
  loading();
  const d = await api('/api/celeb');
  const people = [...new Set(d.outfits.map((o) => o.celeb))];
  const list = celebFilter ? d.outfits.filter((o) => o.celeb === celebFilter) : d.outfits;
  const missing = [d.needs.claude && 'Claude API 키', d.needs.naver && '네이버 API 키(검색 - 뉴스 포함)'].filter(Boolean).join('와 ');
  $app.innerHTML = `
    <h1>셀럽 착장</h1>
    <p class="lede">최근 연예인·유명인 패션 기사에서 누가 어떤 옷을 입었는지 Claude가 뽑아 정리했어요.</p>
    ${d.demo ? `<div class="banner demo">지금 보이는 착장은 <b>예시</b>입니다. <a href="#/settings">설정</a>에 ${missing}를 넣으면 실제 기사로 바뀌어요.</div>` : ''}
    ${d.error ? `<div class="banner stale">마지막 수집에 실패했어요: ${esc(d.error)}</div>` : ''}
    <div class="row section">
      <span class="small muted">${d.lastRun ? `갱신: ${esc(timeText(d.lastRun))}${d.lastNew != null ? ` · 새 기사 ${d.lastNew}개` : ''} · 하루 한 번 자동` : '아직 수집 전'}
        ${!d.demo ? ` · 이번 달 Claude 사용 약 $${d.usage.usd} (${d.usage.calls}회)` : ''}</span>
      <span class="spacer"></span>
      ${!d.demo ? '<button class="btn sm" id="celebRefresh">지금 모으기</button>' : ''}
    </div>

    <section class="section card">
      <h2>이번 주 셀럽이 많이 입은 아이템</h2>
      ${d.top.length ? `<div class="row">${d.top.map((t) => `<span class="chip celeb" title="${esc(t.celebs.join(', '))}">${esc(t.item)} · ${t.count}명</span>`).join('')}</div>
        <p class="small muted" style="margin-bottom:0">많이 입은 아이템은 오늘의 주제 순위가 조금 올라가고 '셀럽 착용' 표시가 붙어요.</p>` : '<p class="muted small">이번 주 착장 기사가 아직 없어요.</p>'}
    </section>

    <div class="row section">
      <button class="chip-btn ${!celebFilter ? 'on' : ''}" data-celeb="">전체 ${d.outfits.length}</button>
      ${people.slice(0, 30).map((p) => `<button class="chip-btn ${celebFilter === p ? 'on' : ''}" data-celeb="${esc(p)}">${esc(p)}</button>`).join('')}
    </div>
    <div class="grid grid-3">
      ${list.map(outfitCard).join('') || '<div class="card empty">착장이 없어요.</div>'}
    </div>
    <p class="small muted section">기사 제목·요약만 저장하고 본문과 사진은 저장하지 않아요. 블로그에 기사 문장이나 보도 사진을 그대로 옮기면 저작권 문제가 생길 수 있으니, 출처를 밝히고 직접 쓴 문장과 직접 찍은·허락받은 사진을 써 주세요.</p>`;

  $app.querySelectorAll('[data-celeb]').forEach((b) => b.addEventListener('click', () => { celebFilter = b.dataset.celeb; views.celeb(); }));
  document.getElementById('celebRefresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = '모으는 중… (1분 정도)';
    try { await api('/api/celeb/refresh', { method: 'POST' }); toast('새 기사를 정리했어요'); } catch (err) { toast(err.message); }
    views.celeb();
  });
};

function outfitCard(o) {
  const q = [o.brand, o.product || o.item].filter(Boolean).join(' ');
  const shop = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q)}`;
  const product = { name: q, brand: o.brand, memo: `${o.celeb} 착용 (${o.articles[0]?.link || ''})` };
  return `<article class="card outfit">
    <div class="row"><b>${esc(o.celeb)}</b><span class="spacer"></span><span class="small muted">${esc(mmdd(o.date))}</span></div>
    <div class="outfit-item">${esc(o.item)}${o.color ? ` <span class="muted small">(${esc(o.color)})</span>` : ''}</div>
    <div class="small">${o.brand ? `<b>${esc(o.brand)}</b>` : '<span class="muted">브랜드 미상</span>'}${o.product ? ` · ${esc(o.product)}` : ''}${o.price ? ` · ${esc(o.price)}` : ''}</div>
    <div class="row small" style="margin-top:6px">
      <a href="${esc(shop)}" target="_blank" rel="noopener noreferrer">쇼핑 검색&nbsp;↗</a>
      ${o.articles.slice(0, 2).map((a, i) => `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" title="${esc(a.title)}">기사${o.articles.length > 1 ? ` ${i + 1}` : ''}&nbsp;↗</a>`).join('')}
      ${o.articles.length > 2 ? `<span class="muted">외 ${o.articles.length - 2}건</span>` : ''}
      <span class="spacer"></span>
      <button class="btn ghost sm" data-x='${esc(JSON.stringify(product))}' data-kw="${esc(o.item)}" onclick="addToBoard(JSON.parse(this.dataset.x), this.dataset.kw)">담기</button>
    </div>
  </article>`;
}
