// 上传一张本地图片到 ComfyUI 的 input 目录（官方 /upload/image 接口），返回可被 LoadImage 使用的文件名。
// 用法: node comfy-upload.cjs <localImagePath> [baseUrl] [subfolder]
const fs = require('fs');
const path = require('path');

const BASE = process.argv[3] || 'http://127.0.0.1:8188';
const file = process.argv[2];
const subfolder = process.argv[4] || '';
if (!file) {
  console.error('usage: node comfy-upload.cjs <localImagePath> [baseUrl] [subfolder]');
  process.exit(2);
}
const buf = fs.readFileSync(file);
const ext = path.extname(file).toLowerCase();
const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

(async () => {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type }), path.basename(file));
  fd.append('type', 'input');
  fd.append('overwrite', 'true');
  if (subfolder) fd.append('subfolder', subfolder);
  const r = await fetch(BASE + '/upload/image', { method: 'POST', body: fd });
  const text = await r.text();
  if (!r.ok) throw new Error(`/upload/image -> ${r.status} ${text.slice(0, 500)}`);
  console.log(text);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
