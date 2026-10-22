// 화면 양옆 빈자리에 띄우는 사진(폴라로이드 액자). 사진은 data/photos 에만 저장하고 GitHub 에는 올리지 않습니다.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const DIR = path.join(store.DATA_DIR, 'photos');
const MAX = 8;
const MAX_BYTES = 8e6;
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function list() {
  return store.load().settings.photos || [];
}

// dataUrl: 화면에서 줄여 보낸 이미지 (data:image/jpeg;base64,...)
function add({ dataUrl, caption = '', side }) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m || !TYPES[m[1]]) throw bad('jpg, png, webp, gif 사진만 올릴 수 있어요.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw bad('사진이 너무 커요(8MB 이하).');
  const s = store.load().settings;
  s.photos = s.photos || [];
  if (s.photos.length >= MAX) throw bad(`사진은 ${MAX}장까지 올릴 수 있어요.`);
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${store.id()}${TYPES[m[1]]}`;
  fs.writeFileSync(path.join(DIR, file), buf);
  const left = s.photos.filter((p) => p.side === 'left').length;
  const right = s.photos.length - left;
  const photo = { file, caption: String(caption).slice(0, 40), side: side === 'left' || side === 'right' ? side : left <= right ? 'left' : 'right' };
  s.photos.push(photo);
  store.save();
  return photo;
}

function update(file, { caption, side, move }) {
  const s = store.load().settings;
  const i = (s.photos || []).findIndex((p) => p.file === file);
  if (i === -1) throw Object.assign(new Error('사진을 찾을 수 없어요.'), { status: 404 });
  const p = s.photos[i];
  if (typeof caption === 'string') p.caption = caption.slice(0, 40);
  if (side === 'left' || side === 'right') p.side = side;
  if (move === 'up' && i > 0) [s.photos[i - 1], s.photos[i]] = [s.photos[i], s.photos[i - 1]];
  if (move === 'down' && i < s.photos.length - 1) [s.photos[i + 1], s.photos[i]] = [s.photos[i], s.photos[i + 1]];
  store.save();
  return s.photos;
}

function remove(file) {
  const s = store.load().settings;
  s.photos = (s.photos || []).filter((p) => p.file !== file);
  store.save();
  try { fs.unlinkSync(path.join(DIR, path.basename(file))); } catch { /* 이미 없음 */ }
  return s.photos;
}

// /photos/<파일> 요청에 응답. 파일 이름은 우리가 만든 형식만 받습니다.
function serve(res, name) {
  if (!/^[a-z0-9]+\.(jpg|png|webp|gif)$/.test(name)) return false;
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) return false;
  const type = Object.entries(TYPES).find(([, ext]) => name.endsWith(ext))[0];
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=86400' });
  fs.createReadStream(file).pipe(res);
  return true;
}

module.exports = { list, add, update, remove, serve };
