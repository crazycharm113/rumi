// 상품 링크를 붙여넣으면 상품명, 브랜드, 가격, 썸네일을 '가능한 범위에서' 채웁니다.
// 사용자가 직접 저장한 링크 한 개만, 저장하는 순간 한 번 읽습니다(전체 쇼핑몰 수집은 하지 않음).
const MAX_BYTES = 1_500_000;

async function scrape(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('올바른 링크가 아닙니다.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('http(s) 링크만 지원합니다.');

  const res = await fetch(u, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  }).catch(() => {
    throw new Error('쇼핑몰 페이지를 읽지 못했습니다. 직접 입력해 주세요.');
  });
  if (!res.ok) throw new Error(`쇼핑몰이 응답하지 않았습니다(${res.status}). 직접 입력해 주세요.`);
  const html = await readLimited(res);
  return parse(html, u);
}

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name.replace(/[:.]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || '') : '';
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function jsonLdProduct(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, ''));
      const list = Array.isArray(data) ? data : data['@graph'] || [data];
      const p = list.find((x) => [].concat(x['@type']).includes('Product'));
      if (p) return p;
    } catch { /* 잘못된 JSON-LD는 건너뜀 */ }
  }
  return null;
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function parse(html, u) {
  const ld = jsonLdProduct(html);
  const offer = ld ? [].concat(ld.offers || [])[0] : null;
  const name = ld?.name || meta(html, 'og:title') || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '');
  const brand = (typeof ld?.brand === 'string' ? ld.brand : ld?.brand?.name) || meta(html, 'product:brand') || meta(html, 'og:site_name') || u.hostname.replace(/^www\./, '');
  const price = toNumber(offer?.price ?? offer?.lowPrice) ?? toNumber(meta(html, 'product:sale_price:amount')) ?? toNumber(meta(html, 'product:price:amount')) ?? toNumber(meta(html, 'og:price:amount'));
  const originalPrice = toNumber(meta(html, 'product:original_price:amount')) ?? toNumber(offer?.highPrice);
  const image = [].concat(ld?.image || [])[0] || meta(html, 'og:image');
  const availability = String(offer?.availability || '');
  return {
    name: name.slice(0, 200),
    brand: String(brand).slice(0, 80),
    price,
    originalPrice: originalPrice && price && originalPrice > price ? originalPrice : null,
    image: image ? new URL(typeof image === 'string' ? image : image.url, u).href : '',
    soldOut: /OutOfStock|SoldOut/i.test(availability) || null,
  };
}

module.exports = { scrape, parse };
