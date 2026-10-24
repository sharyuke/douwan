// 卡通化参数网格测试：固定工作流模板，遍历 checkpoint × denoise，逐个提交并保存输出。
// 用法: node comfy-cartoon-grid.cjs <inputImageName> <outDir> [baseUrl]
const fs = require('fs');
const path = require('path');

const BASE = process.argv[4] || 'http://127.0.0.1:8188';
const inputImage = process.argv[2];
const outDir = process.argv[3];
if (!inputImage || !outDir) {
  console.error('usage: node comfy-cartoon-grid.cjs <inputImageName> <outDir> [baseUrl]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POS = 'anime style illustration, cel shading, flat colors, clean bold lineart, japanese animation key visual, same subject, same pose, same composition, detailed';
const NEG = 'photo, photorealistic, 3d render, realistic, blurry, deformed, extra limbs, watermark, text, logo, signature';

const COMBOS = [];
for (const ckpt of [
  'Anything-V3.0-pruned-fp16.safetensors',
  'v1-5-pruned-emaonly.ckpt',
]) {
  for (const denoise of [0.5, 0.65, 0.8]) {
    COMBOS.push({ ckpt, denoise, steps: 26, cfg: 8.0, seed: 20261015 });
  }
}

function build({ ckpt, denoise, steps, cfg, seed }, prefix) {
  return {
    3: { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['10', 0] } },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: POS, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: NEG, clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: prefix, images: ['8', 0] } },
    10: { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['4', 2] } },
    11: { class_type: 'LoadImage', inputs: { image: inputImage, upload: 'image' } },
  };
}

async function get(p) {
  const r = await fetch(BASE + p, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
}

async function runOne(combo, prefix) {
  const body = { prompt: build(combo, prefix), client_id: 'douwan-grid' };
  const pr = await fetch(BASE + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const pj = await pr.json();
  if (!pr.ok) throw new Error(JSON.stringify(pj).slice(0, 400));
  const id = pj.prompt_id;
  const t0 = Date.now();
  let entry = null;
  for (let i = 0; i < 600; i++) {
    await sleep(1000);
    const h = await get('/history/' + id);
    if (h[id]) { entry = h[id]; break; }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!entry) return { ...combo, ok: false, err: 'timeout', secs };
  if (entry.status.status_str !== 'success') {
    const m = (entry.status.messages || []).find((x) => x[0] === 'execution_error');
    return { ...combo, ok: false, err: m ? m[1].exception_message.slice(0, 160) : 'error', secs };
  }
  const files = [];
  for (const nid of Object.keys(entry.outputs || {})) {
    for (const img of entry.outputs[nid].images || []) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
      const r = await fetch(`${BASE}/view?${q}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const dest = path.join(outDir, img.filename);
      fs.writeFileSync(dest, buf);
      files.push(img.filename);
    }
  }
  const st = await get('/system_stats');
  const dev = (st.devices || [])[0] || {};
  return { ...combo, ok: true, secs, files, vramFreeMB: Math.round((dev.vram_free || 0) / 1048576), vramTotalMB: Math.round((dev.vram_total || 0) / 1048576) };
}

(async () => {
  const results = [];
  for (let i = 0; i < COMBOS.length; i++) {
    const c = COMBOS[i];
    const tag = `${c.ckpt.split('.')[0].replace(/[^a-zA-Z0-9]/g, '')}_d${String(c.denoise).replace('.', '')}`;
    process.stdout.write(`[${i + 1}/${COMBOS.length}] ${c.ckpt} denoise=${c.denoise} ... `);
    try {
      const r = await runOne(c, 'grid_' + tag);
      results.push(r);
      console.log(r.ok ? `ok ${r.secs}s vram_free=${r.vramFreeMB}/${r.vramTotalMB}MB ${r.files.join(',')}` : `FAIL ${r.secs}s ${r.err}`);
    } catch (e) {
      console.log('ERROR ' + e.message);
      results.push({ ...c, ok: false, err: e.message });
    }
  }
  fs.writeFileSync(path.join(outDir, 'grid-results.json'), JSON.stringify(results, null, 2));
  console.log('\n=== summary ===');
  for (const r of results) {
    console.log(`${r.ckpt} d=${r.denoise} steps=${r.steps} cfg=${r.cfg} -> ${r.ok ? 'OK ' + r.secs + 's ' + r.vramFreeMB + 'MB free ' + r.files.join(',') : 'FAIL ' + r.err}`);
  }
})();
