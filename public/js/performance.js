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

    <section class="section card" id="report"><div class="skeleton">주간 리포트를 만드는 중…</div></section>

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
          <h3>${esc(p.title)} ${indexBadge(p)}</h3>
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

  renderReport(reportWeek);
  $app.querySelectorAll('[data-index]').forEach((el) => el.addEventListener('click', async () => {
    el.disabled = true; el.textContent = '확인 중…';
    try { await api('/api/posts/index-check', { method: 'POST', body: { logNo: el.dataset.index } }); } catch (err) { toast(err.message); }
    route();
  }));
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

// 검색 노출 상태 (발행 후 10일 동안 제목으로 검색해 확인)
function indexBadge(p) {
  const i = p.index;
  const recent = p.pubDate >= kstDate(-10);
  if (!i) return recent ? `<button class="chip-btn" data-index="${esc(p.logNo)}" title="제목으로 검색해 내 글이 나오는지 확인">🔍 노출 확인</button>` : '';
  if (i.status === 'ok') return `<span class="chip up" title="${esc(i.since)} 확인">✅ 검색 노출</span>`;
  if (i.status === 'missing') return `<span class="chip down" title="${esc(i.checkedAt)} 확인">⚠️ 누락 의심 (발행 ${i.age}일째)</span> <button class="chip-btn" data-index="${esc(p.logNo)}">다시 확인</button>`;
  return `<span class="chip" title="발행 당일은 아직 안 보일 수 있어요">⏳ 노출 대기</span>`;
}

let reportWeek = 'last';

async function renderReport(week) {
  reportWeek = week;
  const box = document.getElementById('report');
  if (!box) return;
  let r;
  try { r = await api(`/api/report?week=${week}`); } catch (err) { box.innerHTML = `<p class="muted">리포트를 만들지 못했어요: ${esc(err.message)}</p>`; return; }
  const range = `${mmdd(r.from)} ~ ${mmdd(r.to)}`;
  const nextLabel = week === 'last' ? '이번 주' : '다음 주'; // 지난주 리포트의 '다음 주'는 이번 주
  const list = (items, fn, empty) => (items.length ? `<ul class="plain">${items.map(fn).join('')}</ul>` : `<p class="small muted">${empty}</p>`);
  box.innerHTML = `
    <div class="section-head"><h2>주간 리포트 <span class="small muted">${esc(range)}</span></h2>
      <div class="subtabs"><button class="${week === 'last' ? 'on' : ''}" data-week="last">지난주</button><button class="${week === 'this' ? 'on' : ''}" data-week="this">이번 주</button></div></div>
    <div class="stats">
      <div><div class="small muted">발행한 글</div><b>${r.published.length}개</b></div>
      <div><div class="small muted">늘어난 조회수</div><b>${num(r.totalViews)}</b></div>
      <div><div class="small muted">검색 누락 의심</div><b class="${r.missing.length ? 'tag-sale' : ''}">${r.missing.length}개</b></div>
      <div><div class="small muted">${nextLabel} 예정</div><b>${r.plans.length}개</b></div>
    </div>
    ${r.viewsMissing ? `<p class="chip warn">이번 기간에 발행한 글 ${r.viewsMissing}개는 조회수를 아직 안 넣었어요. 아래 글 목록에서 입력하면 리포트가 정확해져요.</p>` : ''}
    <div class="grid grid-2" style="margin-top:12px">
      <div><div class="sub-head">조회수가 많이 늘어난 글</div>
        ${list(r.topPosts, (x) => `<li class="row"><a class="spacer" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><b>+${num(x.gained)}</b></li>`, '조회수를 입력하면 보여요.')}</div>
      <div><div class="sub-head">잘된 주제 (키워드별 조회수)</div>
        ${list(r.topKeywords, (x) => `<li class="row"><span class="spacer">${esc(x.keyword)}</span><b>+${num(x.views)}</b></li>`, '글에 검색 키워드를 넣으면 주제별로 묶어 보여요.')}</div>
      <div><div class="sub-head">좋은 검색 순위</div>
        ${list(r.ranks, (x) => `<li class="row"><span class="spacer">${esc(x.title)} <span class="small muted">'${esc(x.keyword)}'</span></span><b>${x.rank}위</b></li>`, '이 기간에 100위 안에 든 기록이 없어요.')}</div>
      <div><div class="sub-head">${nextLabel} 계획 (${esc(mmdd(r.next.from))} ~ ${esc(mmdd(r.next.to))})</div>
        ${list([...r.plans.map((x) => ({ ...x, kind: 'plan' })), ...r.prepare.map((x) => ({ ...x, kind: 'prep' }))],
          (x) => x.kind === 'plan'
            ? `<li class="row"><span class="small muted" style="width:44px">${esc(mmdd(x.date))}</span><a class="spacer" href="#/boards/${x.id}">${esc(x.title)}</a><span class="cal-item ${POST_STATUS_CLASS[x.status] || ''}">${esc(x.status)}</span></li>`
            : `<li class="row"><span class="small muted" style="width:44px">${esc(mmdd(x.prepare))}</span><span class="spacer">✍️ ${esc(x.word)} 글 준비 시작 <span class="small muted">(작년 정점 ${esc(mmdd(x.peak))})</span></span></li>`,
          '잡힌 일정이 없어요. 브리핑의 주제를 캘린더에 올려 보세요.')}</div>
    </div>
    ${r.missing.length ? `<div class="sub-head">검색 누락 의심 글</div>${list(r.missing, (x) => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a></li>`, '')}` : ''}`;
  box.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => renderReport(b.dataset.week)));
}
