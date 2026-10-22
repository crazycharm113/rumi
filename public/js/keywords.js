// 키워드 기회 분석과 '요즘 많이 올라오는 아이템'
let kwState = { tab: 'score', sort: 'score', dir: -1 };

views.keywords = async (parts, params) => {
  loading('키워드를 분석하는 중…');
  const [data, settings] = await Promise.all([api('/api/keywords'), api('/api/settings')]);
  const focus = params.get('focus');

  const render = async () => {
    let body = '';
    if (kwState.tab === 'score') body = scoreTable(data.rows, focus);
    else body = await bloggerItems();
    $app.innerHTML = `
      <h1>키워드 기회 분석</h1>
      <p class="lede">검색 관심은 오르는데 블로그 글은 적은 키워드일수록 위에 옵니다.</p>
      ${dataBanner(data, '키워드 데이터')}
      <div class="section-head section">
        <div class="subtabs" role="tablist">
          <button role="tab" class="${kwState.tab === 'score' ? 'on' : ''}" data-t="score">기회 점수</button>
          <button role="tab" class="${kwState.tab === 'items' ? 'on' : ''}" data-t="items">요즘 많이 올라오는 아이템</button>
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
        <li><b>블로그 글 수</b>: 네이버 블로그 검색 결과 총 건수(근사치). 글이 10배 많으면 점수가 한 단계 내려가도록 로그를 썼습니다.</li>
        <li><b>관심 수준</b>: '코디' 검색량을 100으로 둔 상대값. 1 미만은 검색이 너무 적어 추천에서 뺍니다.</li>
      </ul>
      <p>점수가 높다고 무조건 좋은 주제는 아닙니다. 내 블로그 성격과 시즌을 함께 보고 고르세요.</p>
    </details>
    <div class="table-wrap"><table>
      <thead><tr>
        ${head('word', '키워드')}
        <th>최근 14일 흐름</th>
        ${head('change', '7일 관심도 변화', 'num')}
        ${head('level', '관심 수준', 'num')}
        ${head('posts', '블로그 글 수', 'num')}
        ${head('score', '기회 점수')}
        <th></th>
      </tr></thead>
      <tbody>${sorted.map((r) => `<tr id="kw-${esc(r.word)}" class="${r.lowVolume ? 'low' : ''}" ${r.word === focus ? 'style="background:var(--accent-soft)"' : ''}>
        <td><b>${esc(r.word)}</b>${r.lowVolume ? ' <span class="chip warn">검색 적음</span>' : ''}</td>
        <td>${spark(r.spark)}</td>
        <td class="num"><span class="pct ${r.change > 0 ? 'up' : r.change < 0 ? 'down' : ''}">${signed(r.change)}%</span></td>
        <td class="num">${r.level}</td>
        <td class="num">${num(r.posts)}</td>
        <td><span class="bar" style="width:${Math.round(((r.score || 0) / maxScore) * 90)}px"></span><span class="score">${r.score ?? '–'}</span></td>
        <td><button class="btn sm" data-word="${esc(r.word)}" onclick="makeBoard(this.dataset.word, this.dataset.word + ' 코디')">보드 만들기</button></td>
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

