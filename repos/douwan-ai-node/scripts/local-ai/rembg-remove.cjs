// 豆玩本地 AI 节点 —— rembg 抠图调用（固定 model=u2net）
//
// 为什么不直接用 curl：必须保证 `model` 字段一定被带上。
// rembg 2.0.85 的 /api/remove 默认 model=bria-rmbg（商业授权），省略就等于未授权使用商业模型。
//
// 用法:
//   node rembg-remove.cjs <输入图> [输出图] [--a] [--af 240] [--ab 10] [--ae 10] [--mask] [--base URL]
// 退出码: 0 成功 / 1 失败 / 2 参数错误
const fs = require('fs');
const path = require('path');

const BASE = (process.env.REMBG_BASE_URL || 'http://127.0.0.1:7000').replace(/\/+$/, '');
// 豆玩只允许 u2net（Apache-2.0 / MIT 系）。改成别的模型前必须先过 docs/local-ai-models.md §7。
const MODEL = process.env.REMBG_MODEL || 'u2net';
const ALLOWED_MODELS = new Set(['u2net', 'u2netp', 'silueta', 'u2net_human_seg', 'u2net_cloth_seg']);

const argv = process.argv.slice(2);
const opts = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) opts[k] = true; else { opts[k] = v; i++; }
  } else pos.push(a);
}
const [input, outputArg] = pos;
if (!input) {
  console.error('usage: node rembg-remove.cjs <输入图> [输出图] [--a] [--af 240] [--ab 10] [--ae 10] [--mask] [--base URL]');
  process.exit(2);
}
if (!ALLOWED_MODELS.has(MODEL)) {
  console.error(`拒绝执行：模型 ${MODEL} 不在豆玩白名单内（${[...ALLOWED_MODELS].join(', ')}）。`);
  console.error('其余模型许可未核验；bria-rmbg 是商业授权模型，禁止使用。见 docs/local-ai-models.md §7。');
  process.exit(2);
}
if (!fs.existsSync(input)) { console.error(`输入文件不存在: ${input}`); process.exit(2); }

const output = outputArg || path.join(path.dirname(input), path.basename(input).replace(/\.[^.]+$/, '') + '-nobg.png');

// 只解码 PNG 头与 IDAT（用于自证「确实拿到了带 alpha 的图」，不依赖第三方图像库）
function pngInfo(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return { png: false };
  return {
    png: true,
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
    hasAlphaChannel: buf[25] === 4 || buf[25] === 6,
  };
}

function alphaRatio(buf) {
  const zlib = require('zlib');
  const info = pngInfo(buf);
  if (!info.png || !info.hasAlphaChannel || info.bitDepth !== 8) return null;
  let off = 8;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = info.colorType === 6 ? 4 : 2;
  const stride = info.width * bpp;
  const prev = Buffer.alloc(stride);
  let pos2 = 0, transparent = 0, total = 0;
  for (let y = 0; y < info.height; y++) {
    const filter = raw[pos2++];
    const line = Buffer.from(raw.subarray(pos2, pos2 + stride));
    pos2 += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      line[i] = v;
    }
    for (let x = 0; x < info.width; x++) {
      total++;
      if (line[x * bpp + (bpp - 1)] < 8) transparent++;
    }
    line.copy(prev);
  }
  return +(transparent / total).toFixed(4);
}

(async () => {
  const buf = fs.readFileSync(input);
  const ext = path.extname(input).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), path.basename(input));   // 字段名固定 file
  fd.append('model', MODEL);                                            // 必传，见文件头
  if (opts.a) {
    fd.append('a', 'true');
    for (const k of ['af', 'ab', 'ae']) if (opts[k] !== undefined) fd.append(k, String(opts[k]));
  }
  if (opts.mask) fd.append('om', 'true');
  if (opts.ppm) fd.append('ppm', 'true');

  const t0 = Date.now();
  const r = await fetch(BASE + '/api/remove', { method: 'POST', body: fd, signal: AbortSignal.timeout(300000) });
  const out = Buffer.from(await r.arrayBuffer());
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.ok) {
    console.error(`FAIL HTTP ${r.status} ${out.toString('utf8').slice(0, 400)}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, out);
  const info = pngInfo(out);
  const ratio = alphaRatio(out);
  console.log(`model=${MODEL}  ${secs}s  ${out.length} bytes  ${info.width}x${info.height}  ` +
    `colorType=${info.colorType} alpha=${info.hasAlphaChannel} 透明占比=${ratio === null ? 'n/a' : ratio}`);
  console.log(`saved ${output}`);
  if (!info.hasAlphaChannel) { console.error('警告：输出没有 alpha 通道，抠图可能失败'); process.exit(1); }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
