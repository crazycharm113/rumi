// 키워드 기회 분석과 '요즘 많이 올라오는 아이템'
let kwState = { tab: 'score', sort: 'score', dir: -1 };

views.keywords = async (parts, params) => {
  loading('키워드를 분석하는 중…');
  const [data, settings] = await Promise.all([api('/api/keywords'), api('/api/settings')]);
  const focus = params.get('focus');

  const render = async () => {
    let body = '';
    if (kwState.tab === 'score') body = scoreTable(data.rows, focus);
    else if (kwState.tab === 'discover') body = await discoverView(data.rows);
    else body = await bloggerItems();
    $app.innerHTML = `
      <h1>키워드 기회 분석</h1>
      <p class="lede">검색 관심은 오르는데 블로그 글은 적은 키워드일수록 위에 옵니다.</p>
      ${dataBanner(data, '키워드 데이터')}
      <div class="section-head section">
        <div class="subtabs" role="tablist">
          <button role="tab" class="${kwState.tab === 'score' ? 'on' : ''}" data-t="score">기회 점수</button>
          <button role="tab" class="${kwState.tab === 'items' ? 'on' : ''}" data-t="items">요즘 많이 올라오는 아이템</button>
          <button role="tab" class="${kwState.tab === 'discover' ? 'on' : ''}" data-t="discover">새로 뜨는 아이템</button>
        </div>
        ${kwState.tab === 'score' ? ageSelect(data.age, settings.ages) : ''}
      </div>
      ${body}`;
    $app.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { kwState.tab = b.dataset.t; render(); }));
    $app.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      kwState.dir = kwState.sort === k ? -kwState.dir : (k === 'word' || k === 'posts' ? 1 : -1);
      kwState.sort = k;
      render();
    }));
    if (focus) document.getElementById(`kw-${CSS.escape(focus)}`)?.scrollIntoView({ block: 'center' });
  };
  await render();
};

function scoreTable(rows, focus) {
  const k = kwState.sort;
  rows = rows.map((r) => ({ ...r, freshAge: r.freshness ? r.freshness.medianAge : null }));
  const sorted = [...rows].sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * kwState.dir;
  });
  const maxScore = Math.max(...rows.map((r) => r.score || 0), 1);
  const head = (key, label, cls = '') => `<th class="${cls}" aria-sort="${kwState.sort === key ? (kwState.dir > 0 ? 'ascending' : 'descending') : 'none'}">
    <button data-sort="${key}">${label}${kwState.sort === key ? (kwState.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  return `
    <details class="explain"><summary>기회 점수는 이렇게 계산해요 (참고용)</summary>
      <p><b>기회 점수 = 관심도 변화 지수 ÷ log<sub>10</sub>(블로그 글 수 + 10)</b></p>
      <ul>
        <li><b>관심도 변화 지수</b>: 네이버 데이터랩 검색어트렌드에서 최근 7일 평균 ÷ 그 전 7일 평균 × 100 (100이면 변화 없음).</li>
        <li><b>상위 글 나이</b>: 그 키워드로 검색했을 때 상위 10개 블로그 글의 작성일 중간값(일)과 6개월 넘은 글 비율. 오래된 글이 60% 이상이면 새 글이 치고 들어갈 기회로 보고 오늘의 주제 순위에 가산합니다.</li>
        <li><b>글 수 전일 대비</b>: 블로그 글 수를 날마다 기록해 어제 기록과 비교한 증가 건수. 하루 이상 비어 있으면 가장 최근 기록과 비교하고 (n일)로 표시합니다. 많이 늘수록 다른 블로거들도 지금 쓰고 있다는 뜻이에요.</li>
        <li><b>블로그 글 수</b>: 네이버 블로그 검색 결과 총 건수(근사치). 글이 10배 많으면 점수가 한 단계 내려가도록 로그를 썼습니다.</li>
        <li><b>쇼핑 클릭 변화</b>: 네이버 쇼핑인사이트에서 최근 7일 클릭 ÷ 그 전 7일. 있으면 관심도 변화 지수를 '검색 지수와 클릭 지수의 평균'으로 계산해 구매 관심을 반영합니다.
          <span class="chip buy">구매</span> 검색·클릭이 함께 오름 → 제품 추천·비교 글, <span class="chip info">정보</span> 검색만 오름 → 코디·스타일링 글.</li>
        <li><b>관심 수준</b>: '코디' 검색량을 100으로 둔 상대값. 1 미만은 검색이 너무 적어 추천에서 뺍니다.</li>
      </ul>
      <p>점수가 높다고 무조건 좋은 주제는 아닙니다. 내 블로그 성격과 시즌을 함께 보고 고르세요.</p>
    </details>
    <div class="table-wrap"><table>
      <thead><tr>
        ${head('word', '키워드')}
        <th>최근 14일 흐름</th>
        ${head('change', '7일 관심도 변화', 'num')}
        ${head('shopChange', '쇼핑 클릭 변화', 'num')}
        ${head('level', '관심 수준', 'num')}
        ${head('posts', '블로그 글 수', 'num')}
        ${head('postsDelta', '글 수 전일 대비', 'num')}
        ${head('freshAge', '상위 글 나이', 'num')}
        ${head('score', '기회 점수')}
        <th></th>
      </tr></thead>
      <tbody>${sorted.map((r) => `<tr id="kw-${esc(r.word)}" class="${r.lowVolume ? 'low' : ''}" ${r.word === focus ? 'style="background:var(--accent-soft)"' : ''}>
        <td><b>${esc(r.word)}</b>${r.auto ? ' <span class="chip" title="요즘 쇼핑 클릭이 올라 자동으로 고른 키워드">자동</span>' : ''}${r.lowVolume ? ' <span class="chip warn">검색 적음</span>' : ''}</td>
        <td>${spark(r.spark)}</td>
        <td class="num"><span class="pct ${r.change > 0 ? 'up' : r.change < 0 ? 'down' : ''}">${signed(r.change)}%</span></td>
        <td class="num">${r.shopChange == null ? '<span class="muted">–</span>' : `<span class="pct ${r.shopChange > 0 ? 'up' : r.shopChange < 0 ? 'down' : ''}">${signed(r.shopChange)}%</span>`}
          <span class="intent-slot">${r.intent === 'buy' ? '<span class="chip buy">구매</span>' : r.intent === 'info' ? '<span class="chip info">정보</span>' : ''}</span></td>
        <td class="num">${r.level}</td>
        <td class="num">${num(r.posts)}</td>
        <td class="num" ${r.postsDeltaDays > 1 ? `title="${r.postsDeltaDays}일 전 기록과 비교"` : ''}>${r.postsDelta == null
          ? '<span class="muted" title="오늘부터 기록해서 내일부터 보여요">–</span>'
          : `<span class="pct ${r.postsDelta > 0 ? 'up' : r.postsDelta < 0 ? 'down' : ''}">${r.postsDelta > 0 ? '+' : ''}${num(r.postsDelta)}</span>${r.postsDeltaDays > 1 ? `<span class="small muted"> (${r.postsDeltaDays}일)</span>` : ''}`}</td>
        <td class="num" title="상위 10개 글의 작성일 중간값 · 6개월 넘은 글 비율">${r.freshness ? `${r.freshness.medianAge}일 <span class="small ${r.freshness.oldShare >= 60 ? 'tag-new' : 'muted'}">(${r.freshness.oldShare}% 오래됨)</span>` : '<span class="muted">–</span>'}</td>
        <td><span class="bar" style="width:${Math.round(((r.score || 0) / maxScore) * 90)}px"></span><span class="score">${r.score ?? '–'}</span></td>
        <td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-word="${esc(r.word)}" onclick="makeBoard(this.dataset.word, this.dataset.word + ' 코디')">보드 만들기</button>
          <button class="btn ghost sm" data-word="${esc(r.word)}" onclick="excludeKeyword(this.dataset.word)" title="추천에서 빼기">제외</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted">흐름 그래프의 색칠된 부분이 최근 7일입니다. 지켜볼 키워드는 <a href="#/settings">설정</a>에서 바꿀 수 있어요.</p>`;
}

async function bloggerItems() {
  const d = await api('/api/blogger-items');
  const bars = (list, cls) => {
    const max = Math.max(...list.map((x) => x.count), 1);
    return list.map((x) => `<div class="hbar ${cls}"><span>${esc(x.word)}</span>
      <div class="track"><div class="fill" style="width:${(x.count / max) * 100}%"></div></div>
      <span class="small muted" style="text-align:right">${x.count}</span></div>`).join('') || '<p class="muted small">언급된 항목이 없습니다.</p>';
  };
  return `${dataBanner(d, '아이템 집계')}
    <p class="small muted">최근 블로그 글 ${d.total}개(검색어: ${d.queries.map(esc).join(', ')})의 제목·요약에서 언급된 글 수입니다. 주제를 고를 때 근거로 보세요.</p>
    <div class="grid grid-2">
      <section class="card"><h2>옷 종류</h2>${bars(d.items, '')}</section>
      <section class="card"><h2>브랜드</h2>${bars(d.brands, 'brand')}</section>
    </div>`;
}


// 새로 뜨는 아이템: 지켜보지 않는 아이템 중 네이버 쇼핑 클릭이 오르는 것
async function discoverView() {
  const d = await api('/api/discover');
  const cats = (d.categories || []).map((c) => {
    const w = c.weeks;
    const last = w[w.length - 1]?.ratio, prev = w[w.length - 2]?.ratio;
    const ch = last && prev ? Math.round((last / prev - 1) * 100) : null;
    return `<span class="chip ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}">${esc(c.name)} 지난주 대비 ${ch == null ? '–' : signed(ch) + '%'}</span>`;
  }).join(' ');
  return `${d.demo ? dataBanner(d, '쇼핑 클릭 데이터') : ''}
    ${d.error ? `<div class="banner stale">쇼핑인사이트를 가져오지 못했어요: ${esc(d.error)}</div>` : ''}
    <p class="small muted">지켜보는 키워드에 없는 아이템 40개 중, 네이버 쇼핑 클릭이 지난주보다 오른 것입니다. 마음에 들면 키워드에 추가하세요.</p>
    ${cats ? `<div class="row" style="margin-bottom:12px">${cats}</div>` : ''}
    ${d.items.length ? `<div class="table-wrap"><table>
      <thead><tr><th>아이템</th><th>최근 14일 쇼핑 클릭</th><th class="num">7일 변화</th><th></th></tr></thead>
      <tbody>${d.items.map((x) => `<tr><td><b>${esc(x.word)}</b></td><td>${spark(x.spark)}</td>
        <td class="num"><span class="pct up">${signed(x.change)}%</span></td>
        <td><button class="btn sm" data-add="${esc(x.word)}" onclick="addKeyword(this.dataset.add)">키워드에 추가</button></td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="card empty">지금은 새로 뜨는 아이템이 없어요.</div>'}`;
}

async function addKeyword(word) {
  const s = await api('/api/settings');
  if (s.keywords.includes(word)) return toast('이미 지켜보고 있어요');
  await api('/api/settings', { method: 'PUT', body: { keywords: [...s.keywords, word] } });
  toast(`'${word}'를 지켜볼 키워드에 추가했어요. 내일 분석부터 반영돼요.`);
}

async function excludeKeyword(word) {
  if (!confirm(`'${word}'를 추천에서 뺄까요? 설정의 '제외할 키워드'에서 다시 되돌릴 수 있어요.`)) return;
  const s = await api('/api/settings');
  await api('/api/settings', { method: 'PUT', body: { excludedKeywords: [...s.excludedKeywords, word], keywords: s.keywords.filter((w) => w !== word) } });
  toast(`'${word}'를 제외했어요. 내일 분석부터 반영돼요.`);
}
