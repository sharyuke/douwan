// rembg 本地服务冒烟测试 + 契约打印
//  - 读取 http://127.0.0.1:7000/openapi.json，打印真实路由与 multipart 字段名（禁止猜测接口）
//  - 对每张输入图调用抠图接口，落盘 PNG，并检查输出是否真的带透明 alpha 通道
// 用法: node rembg-test.cjs <outDir> <input1> [input2 ...]
const fs = require('fs');
const path = require('path');

const BASE = process.env.REMBG_BASE_URL || 'http://127.0.0.1:7000';
// rembg 2.0.85 的 /api/remove 默认 model=bria-rmbg（商业授权模型，不能用），
// 豆玩付费流程只允许 u2net（Apache-2.0），所以必须显式传 model。
const MODEL = process.env.REMBG_MODEL || 'u2net';
const outDir = process.argv[2];
const inputs = process.argv.slice(3);
if (!outDir || inputs.length === 0) {
  console.error('usage: node rembg-test.cjs <outDir> <input1> [input2 ...]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

function pngInfo(buf) {
  // 解析 PNG 头部与 IHDR/颜色类型（判断是否带 alpha：colorType 4=gray+alpha, 6=RGBA）
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return { png: false };
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const hasAlphaChannel = colorType === 4 || colorType === 6;
  return { png: true, width: w, height: h, bitDepth, colorType, hasAlphaChannel };
}

function alphaStats(buf) {
  // 统计 alpha 通道：透明像素比例 + 四角 alpha 值（用最简 PNG 解码：仅支持无损 zlib，这里用 zlib 解 IDAT）
  const zlib = require('zlib');
  const info = pngInfo(buf);
  if (!info.png || !info.hasAlphaChannel) return null;
  // 收集 IDAT
  let off = 8;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = info.colorType === 6 ? 4 : 2; // RGBA 或 GrayA，8bit
  let transparent = 0, total = 0;
  const corners = [];
  const stride = info.width * bpp;
  const prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < info.height; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    // 反滤波（PNG 标准 5 种）
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
      const alpha = line[x * bpp + (bpp - 1)];
      total++;
      if (alpha < 8) transparent++;
      if ((y === 0 || y === info.height - 1) && (x === 0 || x === info.width - 1)) corners.push(alpha);
    }
    line.copy(prev);
  }
  return { transparentRatio: +(transparent / total).toFixed(4), corners };
}

(async () => {
  // 1) 打印真实契约
  const spec = await (await fetch(BASE + '/openapi.json')).json();
  console.log('=== OpenAPI: rembg ' + (spec.info?.version || '?') + ' ===');
  for (const [p, methods] of Object.entries(spec.paths || {})) {
    for (const [m, op] of Object.entries(methods)) {
      const formFields = op.requestBody?.content?.['multipart/form-data']?.schema?.properties;
      const bodySchema = op.requestBody?.content?.['application/octet-stream']?.schema;
      const params = (op.parameters || []).map((x) => `${x.name}:${x.in}`).join(', ');
      console.log(`  ${m.toUpperCase()} ${p}  params=[${params}]` +
        (formFields ? `  multipart=[${Object.keys(formFields).join(',')}]` : '') +
        (bodySchema ? '  body=application/octet-stream' : ''));
    }
  }

  // 2) 找抠图路由（从真实 schema 推断，不硬编码猜测字段）
  const entry = Object.entries(spec.paths).find(([p, m]) => m.post && /remove|matting|segment/i.test(p));
  if (!entry) { console.error('未找到抠图 POST 路由，请人工检查 /api 文档'); process.exit(1); }
  const [route, methods] = entry;
  const formProps = methods.post.requestBody?.content?.['multipart/form-data']?.schema?.properties || {};
  const fileField = Object.keys(formProps).find((k) => /file|image|input/i.test(k)) || 'file';
  const ext = new URL(BASE).origin + route;
  console.log(`\n使用路由: POST ${route}  文件字段: ${fileField}`);

  // 3) 逐张跑
  console.log('\n=== 抠图测试 ===');
  for (const input of inputs) {
    const base = path.basename(input);
    const buf = fs.readFileSync(input);
    const type = base.toLowerCase().endsWith('.png') ? 'image/png' : base.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    const fd = new FormData();
    fd.append(fileField, new Blob([buf], { type }), base);
    // 显式指定模型：不传就是服务端默认 bria-rmbg（商业授权），豆玩只允许 u2net。
    fd.append('model', MODEL);
    const t0 = Date.now();
    let r, out;
    try {
      r = await fetch(ext, { method: 'POST', body: fd, signal: AbortSignal.timeout(300000) });
      out = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      console.log(`  ${base} -> FAIL 请求异常 ${e.message}`);
      continue;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!r.ok) {
      console.log(`  ${base} -> FAIL HTTP ${r.status} ${out.toString('utf8').slice(0, 200)}`);
      continue;
    }
    const dest = path.join(outDir, base.replace(/\.[^.]+$/, '') + '-nobg.png');
    fs.writeFileSync(dest, out);
    const info = pngInfo(out);
    const stats = alphaStats(out);
    console.log(`  ${base} -> OK ${secs}s  ${out.length} bytes  PNG=${info.png} ${info.width}x${info.height} ` +
      `colorType=${info.colorType} alpha通道=${info.hasAlphaChannel} 透明像素占比=${stats ? stats.transparentRatio : 'n/a'} 四角alpha=${stats ? JSON.stringify(stats.corners) : 'n/a'}`);
    console.log(`      保存: ${dest}`);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
