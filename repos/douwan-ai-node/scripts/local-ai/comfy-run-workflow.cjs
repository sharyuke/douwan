// 豆玩本地 AI 节点 —— ComfyUI 通用工作流驱动（测试与联调用）
//
// 设计目标：让工作流 JSON 自带参数表（__douwan.params），驱动只按表打补丁，
// 这样换工作流不用改代码，后端（Go）也能读同一份表来做参数校验。
//
// 用法:
//   node comfy-run-workflow.cjs <workflow.json> <outDir> [--param value ...] [--base URL] [--input <本地图片>]
//
// 例:
//   node comfy-run-workflow.cjs workflows/local-ai/txt2img-api.json out --positive "a red panda" --steps 24
//   node comfy-run-workflow.cjs workflows/local-ai/cartoonize-api.json out --input photo.png --denoise 0.75
//
// 退出码: 0 成功 / 1 运行失败 / 2 参数错误
const fs = require('fs');
const path = require('path');

function parseArgv(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { opts[key] = true; } else { opts[key] = next; i++; }
    } else positional.push(a);
  }
  return { positional, opts };
}

const { positional, opts } = parseArgv(process.argv.slice(2));
const [wfPath, outDir] = positional;
if (!wfPath || !outDir) {
  console.error('usage: node comfy-run-workflow.cjs <workflow.json> <outDir> [--param value ...] [--base URL] [--input file]');
  process.exit(2);
}
const BASE = (opts.base || process.env.COMFY_BASE_URL || 'http://127.0.0.1:8188').replace(/\/+$/, '');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(p) {
  const r = await fetch(BASE + p, { signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

async function uploadImage(file, subfolder) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type }), path.basename(file));
  fd.append('type', 'input');
  fd.append('overwrite', 'true');
  if (subfolder) fd.append('subfolder', subfolder);
  const r = await fetch(BASE + '/upload/image', { method: 'POST', body: fd });
  const t = await r.text();
  if (!r.ok) throw new Error(`/upload/image -> ${r.status} ${t.slice(0, 300)}`);
  const j = JSON.parse(t);
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

function coerce(spec, raw, key) {
  if (spec.type === 'int') {
    const v = Number.parseInt(raw, 10);
    if (!Number.isFinite(v)) throw new Error(`参数 ${key} 需要整数，收到 ${raw}`);
    return v;
  }
  if (spec.type === 'float') {
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v)) throw new Error(`参数 ${key} 需要小数，收到 ${raw}`);
    return v;
  }
  return String(raw);
}

function validate(spec, value, key) {
  const errs = [];
  if (spec.type === 'int' || spec.type === 'float') {
    if (spec.min !== undefined && value < spec.min) errs.push(`< ${spec.min}`);
    if (spec.max !== undefined && value > spec.max) errs.push(`> ${spec.max}`);
  }
  if (spec.enum && !spec.enum.includes(value)) errs.push(`不在枚举 ${spec.enum.join('|')} 内`);
  if (typeof value === 'string' && spec.max_len && value.length > spec.max_len) errs.push(`超过 ${spec.max_len} 字符`);
  return errs;
}

(async () => {
  const raw = fs.readFileSync(wfPath, 'utf8');
  const workflow = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const meta = workflow.__douwan;
  if (!meta) throw new Error('工作流缺少 __douwan 元数据段（参数表）');
  const params = meta.params || {};
  delete workflow.__douwan;

  const applied = {};
  for (const [key, spec] of Object.entries(params)) {
    let value;
    if (key === 'image' && opts.input) {
      value = await uploadImage(path.resolve(String(opts.input)), opts.subfolder || 'douwan');
    } else if (opts[key] !== undefined) {
      value = coerce(spec, opts[key], key);
    } else if (spec.default !== undefined) {
      value = spec.default;
    } else if (spec.required) {
      throw new Error(`缺少必填参数 --${key}（${spec.desc || ''}）`);
    } else {
      continue;
    }
    const errs = validate(spec, value, key);
    if (errs.length) throw new Error(`参数 ${key}=${value} 非法: ${errs.join(', ')}`);
    // 尺寸类参数自动向下取整到 multiple_of（例如 513 -> 512），这是 SD 的要求，不是用户错误
    if (spec.multiple_of && typeof value === 'number') value = value - (value % spec.multiple_of);
    workflow[spec.node].inputs[spec.field] = value;
    applied[key] = key === 'image' ? path.basename(String(value)) : value;
  }

  console.log(`工作流: ${meta.name || path.basename(wfPath)} (${meta.kind || '?'})  模型: ${meta.model || '-'}`);
  console.log('参数:', JSON.stringify(applied));

  const stats0 = await getJson('/system_stats');
  const dev0 = (stats0.devices || [])[0] || {};

  const pr = await fetch(BASE + '/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: 'douwan-run-' + Date.now() }),
  });
  const pj = await pr.json();
  if (!pr.ok) throw new Error(`/prompt -> ${pr.status} ${JSON.stringify(pj).slice(0, 800)}`);
  const promptId = pj.prompt_id;
  console.log('prompt_id =', promptId);

  const t0 = Date.now();
  let entry = null;
  const deadline = Date.now() + 15 * 60 * 1000;   // 15 分钟硬上限
  while (Date.now() < deadline) {
    await sleep(1000);
    const h = await getJson('/history/' + promptId);
    if (h[promptId]) { entry = h[promptId]; break; }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!entry) {
    const q = await getJson('/queue');
    throw new Error(`超时 ${secs}s；队列=${JSON.stringify(q).slice(0, 400)}`);
  }
  if (entry.status.status_str !== 'success') {
    const m = (entry.status.messages || []).find((x) => x[0] === 'execution_error');
    throw new Error(`执行失败: ${m ? JSON.stringify(m[1]).slice(0, 800) : JSON.stringify(entry.status).slice(0, 800)}`);
  }

  const saved = [];
  for (const nid of Object.keys(entry.outputs || {})) {
    for (const img of entry.outputs[nid].images || []) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
      const r = await fetch(`${BASE}/view?${q}`);
      if (!r.ok) throw new Error(`/view -> ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const dest = path.join(outDir, img.filename);
      fs.writeFileSync(dest, buf);
      const w = buf.length >= 24 ? buf.readUInt32BE(16) : 0;
      const h = buf.length >= 24 ? buf.readUInt32BE(20) : 0;
      saved.push({ file: img.filename, bytes: buf.length, width: w, height: h, type: img.type || 'output' });
      console.log(`saved ${dest}  ${buf.length} bytes  ${w}x${h}`);
    }
  }
  if (saved.length === 0) throw new Error('执行成功但没有任何图片输出（检查 SaveImage 节点）');

  const stats1 = await getJson('/system_stats');
  const dev1 = (stats1.devices || [])[0] || {};
  const mb = (v) => Math.round((v || 0) / 1048576);
  console.log(`elapsed = ${secs}s`);
  console.log(`vram_total=${mb(dev1.vram_total)}MB  free_before=${mb(dev0.vram_free)}MB  free_after=${mb(dev1.vram_free)}MB`);
  fs.writeFileSync(path.join(outDir, `run-${meta.name || 'workflow'}-${promptId.slice(0, 8)}.json`),
    JSON.stringify({ workflow: meta.name, prompt_id: promptId, seconds: Number(secs), params: applied, outputs: saved,
      vram: { total_mb: mb(dev1.vram_total), free_before_mb: mb(dev0.vram_free), free_after_mb: mb(dev1.vram_free) } }, null, 2));
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
