// 성과 기록: 발행한 글의 반응을 쌓아 어떤 주제가 잘 되는지 봅니다.
views.performance = async () => {
  loading();
  const [d, boards] = await Promise.all([api('/api/posts'), api('/api/boards')]);
  if (!d.blogId) {
    $app.innerHTML = `<h1>성과 기록</h1>
      <div class="card empty">
        <p>내 네이버 블로그 아이디를 <a href="#/settings">설정</a>에 넣으면, 블로그 RSS로 글 목록을 자동으로 가져와요.</p>
        <p class="small muted">비밀번호는 받지 않아요. 조회수는 네이버가 외부에 공식으로 제공하지 않아 직접 입력해요.</p>
      </div>`;
    return;
  }
  const latest = (a) => (a && a.length ? a[a.length - 1] : null);
  const rankText = (r) => (!r ? '–' : r.rank == null ? '100위 밖' : `${r.rank}위`);
  const maxViews = Math.max(1, ...d.summary.map((s) => s.avgViews || 0));

  $app.innerHTML = `
    <h1>성과 기록</h1>
    <p class="lede">글 목록은 블로그 RSS(${esc(d.blogId)})로 자동으로 가져와요. 조회수는 블로그 통계를 보고 직접 넣어 주세요.</p>
    <div class="row">
      <span class="small muted">${d.lastSync ? `글 목록 갱신: ${esc(timeText(d.lastSync))}` : '아직 가져오기 전'}${d.error ? ` · 오류: ${esc(d.error)}` : ''}</span>
      <span class="spacer"></span>
      <button class="btn sm" id="sync">글 목록 새로 가져오기</button>
    </div>

    <section class="section card">
      <h2>어떤 주제가 잘 되나</h2>
      ${d.summary.length ? `<div class="table-wrap" style="border:0"><table>
        <thead><tr><th>키워드</th><th class="num">글 수</th><th>평균 조회수(최근 입력)</th><th class="num">최고 검색 순위</th></tr></thead>
        <tbody>${d.summary.map((s) => `<tr><td><b>${esc(s.keyword)}</b></td><td class="num">${s.posts}</td>
          <td>${s.avgViews == null ? '<span class="muted">–</span>' : `<span class="bar" style="width:${Math.round((s.avgViews / maxViews) * 120)}px"></span>${num(s.avgViews)}`}</td>
          <td class="num">${s.bestRank ? `${s.bestRank}위` : '–'}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted small">글을 가져오면 키워드별로 묶어서 보여드려요.</p>'}
      <p class="small muted">키워드는 연결한 상품 보드의 주제 키워드를 따르거나 직접 넣을 수 있어요. 검색 순위는 네이버 블로그 검색 상위 100개 안에서 찾아요(하루 한 번 자동).</p>
    </section>

    <section class="section">
      <h2>글 목록 ${d.posts.length}</h2>
      <div class="grid">
      ${d.posts.map((p) => {
        const v = latest(p.views), r = latest(p.ranks);
        return `<article class="card post-row" data-log="${esc(p.logNo)}">
          <div class="row"><span class="small muted">${esc(p.pubDate)}${p.category ? ` · ${esc(p.category)}` : ''}</span><span class="spacer"></span>
            <a class="btn ghost sm" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">글 보기 ↗</a></div>
          <h3>${esc(p.title)}</h3>
          <div class="fields">
            <label class="field">검색 키워드<input data-k value="${esc(p.keyword || '')}" placeholder="예: 트렌치코트"></label>
            <label class="field">연결한 상품 보드<select data-board><option value="">없음</option>${boards.map((b) => `<option value="${b.id}" ${b.id === p.boardId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select></label>
            <div class="field">검색 순위<div class="row"><b>${rankText(r)}</b>${r ? `<span class="small muted">${esc(mmdd(r.date))}</span>` : ''}
              <button class="btn sm" data-rank ${p.keyword && d.hasNaver ? '' : 'disabled title="키워드와 네이버 API 키가 필요해요"'}>확인</button></div></div>
            <div class="field">조회수<div class="row"><b>${v ? num(v.views) : '–'}</b>${v ? `<span class="small muted">${esc(mmdd(v.date))}</span>` : ''}
              <button class="btn sm" data-views>입력</button></div></div>
          </div>
          ${(p.views || []).length > 1 ? `<div class="small muted">조회수 기록: ${p.views.slice(-6).map((x) => `${mmdd(x.date)} ${num(x.views)}`).join(' → ')}</div>` : ''}
        </article>`;
      }).join('') || '<div class="card empty">아직 가져온 글이 없어요. 위의 \'글 목록 새로 가져오기\'를 눌러 보세요.</div>'}
      </div>
    </section>`;

  document.getElementById('sync').addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = '가져오는 중…';
    try { await api('/api/posts/sync', { method: 'POST' }); toast('글 목록을 가져왔어요'); } catch (err) { toast(err.message); }
    route();
  });
  const save = debounce(async (logNo, body) => { await api(`/api/posts/${logNo}`, { method: 'PUT', body }); toast('저장했어요'); }, 600);
  $app.querySelectorAll('[data-log]').forEach((card) => {
    const logNo = card.dataset.log;
    card.querySelector('[data-k]').addEventListener('input', (e) => save(logNo, { keyword: e.target.value }));
    card.querySelector('[data-board]').addEventListener('change', async (e) => {
      await api(`/api/posts/${logNo}`, { method: 'PUT', body: { boardId: e.target.value } });
      toast('연결했어요');
      route();
    });
    card.querySelector('[data-rank]').addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = '확인 중…';
      try { await api(`/api/posts/${logNo}/rank`, { method: 'POST' }); } catch (err) { toast(err.message); }
      route();
    });
    card.querySelector('[data-views]').addEventListener('click', async () => {
      const r = await dialog('조회수 입력', [
        { name: 'date', label: '날짜', type: 'date', value: kstDate(), required: true },
        { name: 'views', label: '누적 조회수', type: 'number', value: '', required: true },
      ]);
      if (!r) return;
      await api(`/api/posts/${logNo}/views`, { method: 'POST', body: r });
      route();
    });
  });
};
