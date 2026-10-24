// 通过 ComfyUI 官方 HTTP API 提交工作流、轮询 history、拉取输出图片。
// 用途：本机（AI 节点）冒烟测试与后端接入前的契约验证。
// 用法: node comfy-run.cjs <workflow.json> <outDir> [baseUrl]
const fs = require('fs');
const path = require('path');

const BASE = process.argv[4] || 'http://127.0.0.1:8188';
const wfPath = process.argv[2];
const outDir = process.argv[3];
if (!wfPath || !outDir) {
  console.error('usage: node comfy-run.cjs <workflow.json> <outDir> [baseUrl]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(pathname, body) {
  const r = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${pathname} -> ${r.status} ${text.slice(0, 600)}`);
  return JSON.parse(text);
}

async function get(pathname) {
  const r = await fetch(BASE + pathname, { signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${pathname} -> ${r.status} ${text.slice(0, 600)}`);
  return JSON.parse(text);
}

(async () => {
  const clientId = 'douwan-smoke-' + Date.now();
  const workflow = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

  const stats0 = await get('/system_stats');
  const prompt = await post('/prompt', { prompt: workflow, client_id: clientId });
  const promptId = prompt.prompt_id;
  console.log('prompt_id =', promptId);

  const started = Date.now();
  let hist = null;
  for (let i = 0; i < 600; i++) {          // 最多等 10 分钟
    await sleep(1000);
    hist = await get('/history/' + promptId);
    if (hist && hist[promptId]) break;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!hist || !hist[promptId]) {
    console.log('TIMEOUT after ' + secs + 's');
    const q = await get('/queue');
    console.log('queue =', JSON.stringify(q));
    process.exit(1);
  }

  const entry = hist[promptId];
  const status = entry.status || {};
  console.log('status =', JSON.stringify(status).slice(0, 400));
  console.log('elapsed =', secs + 's');

  if (status.status_str !== 'success') {
    console.log('MESSAGES =', JSON.stringify(status.messages || []).slice(0, 2000));
    process.exit(1);
  }

  for (const nodeId of Object.keys(entry.outputs || {})) {
    for (const img of entry.outputs[nodeId].images || []) {
      const q = new URLSearchParams({
        filename: img.filename,
        subfolder: img.subfolder || '',
        type: img.type || 'output',
      });
      const r = await fetch(`${BASE}/view?${q}`);
      if (!r.ok) throw new Error(`/view -> ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const dest = path.join(outDir, img.filename);
      fs.writeFileSync(dest, buf);
      // 用 PNG 头读取宽高，确认输出尺寸
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      console.log('saved', dest, buf.length, 'bytes', `${w}x${h}`, 'type=' + (img.type || 'output'));
    }
  }

  const stats1 = await get('/system_stats');
  console.log('vram_before =', JSON.stringify((stats0.devices || [])[0] || {}).slice(0, 300));
  console.log('vram_after  =', JSON.stringify((stats1.devices || [])[0] || {}).slice(0, 300));
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
