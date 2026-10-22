// 2단계: 상품 보드에 저장한 상품만 정해진 주기로 다시 읽어 가격 하락·품절·재입고를 알립니다.
// 요청 사이에 간격을 길게 두어 쇼핑몰에 부담을 주지 않습니다.
const store = require('./store');
const { scrape } = require('./product');

const GAP_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addAlert(db, a) {
  // 같은 상품의 같은 종류 알림이 오늘 이미 있으면 새로 만들지 않습니다.
  const today = store.kstDate();
  if (db.alerts.some((x) => x.productId === a.productId && x.kind === a.kind && x.date === today)) return;
  db.alerts.unshift({ id: store.id(), date: today, createdAt: new Date().toISOString(), read: false, ...a });
  db.alerts = db.alerts.slice(0, 300);
}

// 한 상품의 이전 상태와 새로 읽은 상태를 비교해 알림 목록을 만듭니다.
function diff(board, p, fresh) {
  const out = [];
  const base = { boardId: board.id, productId: p.id, boardTitle: board.title, productName: p.name || fresh.name || '이름 없는 상품' };
  if (fresh.price && p.price && fresh.price < p.price) {
    const pct = Math.round((1 - fresh.price / p.price) * 100);
    out.push({ ...base, kind: 'price_drop', before: p.price, after: fresh.price, pct, text: `가격 ${pct}% 인하 (${p.price.toLocaleString('ko-KR')}원 → ${fresh.price.toLocaleString('ko-KR')}원)` });
  }
  if (fresh.price && p.price && fresh.price > p.price) {
    out.push({ ...base, kind: 'price_up', before: p.price, after: fresh.price, text: `가격 인상 (${p.price.toLocaleString('ko-KR')}원 → ${fresh.price.toLocaleString('ko-KR')}원)` });
  }
  if (fresh.soldOut === true && !p.soldOut) {
    const published = p.status === '발행 완료' || board.postStatus === '발행';
    out.push({ ...base, kind: published ? 'fix_post' : 'sold_out', text: published ? '발행한 글에 쓴 상품이 품절됐어요 — 글 수정 필요' : '품절됐어요' });
  }
  if (fresh.soldOut === false && p.soldOut) out.push({ ...base, kind: 'restock', text: '재입고됐어요' });
  return out;
}

let running = false;

async function checkSavedProducts({ onlyBoard } = {}) {
  if (running) return { skipped: true };
  running = true;
  const db = store.load();
  let checked = 0, failed = 0, created = 0;
  try {
    for (const board of db.boards) {
      if (onlyBoard && board.id !== onlyBoard) continue;
      for (const p of board.products) {
        if (!p.url || !/^https?:/.test(p.url)) continue;
        if (checked > 0) await sleep(GAP_MS);
        checked++;
        try {
          const fresh = await scrape(p.url);
          const alerts = diff(board, p, fresh);
          for (const a of alerts) { addAlert(db, a); created++; }
          if (fresh.price) {
            if (fresh.price !== p.price) p.priceCheckedAt = store.kstDate();
            p.price = fresh.price;
            p.priceHistory = [...(p.priceHistory || []), [store.kstDate(), fresh.price]].slice(-60);
          }
          if (fresh.soldOut != null) p.soldOut = fresh.soldOut;
          p.lastCheckedAt = new Date().toISOString();
          p.lastCheckError = '';
        } catch (err) {
          failed++;
          p.lastCheckError = err.message;
        }
        store.save();
      }
    }
  } finally {
    running = false;
  }
  return { checked, failed, created };
}

module.exports = { checkSavedProducts, diff, addAlert };
