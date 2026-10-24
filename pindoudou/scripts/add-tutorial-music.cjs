/* =========================================================================
   给新手教程视频加轻快背景音乐（开发用，不进构建产物）
   做法：
   1. 用纯代码合成一段 40 秒的轻快循环（马林巴 + 拨弦 + 贝斯 + 轻打击），
      不依赖任何外部音频文件，避免版权问题；
   2. 用 ffmpeg 把音乐压到视频里（视频流直接复制，只重编 AAC 音轨），
      开头 1.4 秒淡入、结尾 2.2 秒淡出，时长跟视频对齐。

   前置：先跑 scripts/make-tutorial-videos.cjs 生成无声视频
   用法：node scripts/add-tutorial-music.cjs              # 桌面 + 手机全部
        node scripts/add-tutorial-music.cjs mobile       # 只处理手机端
        node scripts/add-tutorial-music.cjs --music-only # 只生成 .tmp/tutorial-music.wav

   产物：直接覆盖 public/tutorials/<device>/*.mp4（音轨替换成背景音乐）
   ========================================================================= */
const fs = require('fs')
const path = require('path')
const { spawnSync, execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'tutorials')
const MUSIC = path.join(ROOT, '.tmp', 'tutorial-music.wav')

/* ---------------------------------------------------------------- ffmpeg */
function findFfmpeg() {
  const works = p => {
    try { execFileSync(p, ['-version'], { stdio: 'ignore' }); return true } catch { return false }
  }
  if (process.env.FFMPEG && works(process.env.FFMPEG)) return process.env.FFMPEG
  const dir = path.join(ROOT, '..', 'tools', 'ffmpeg-py', 'imageio_ffmpeg', 'binaries')
  try {
    const hit = fs.readdirSync(dir).find(f => /^ffmpeg.*\.exe$/i.test(f))
    if (hit && works(path.join(dir, hit))) return path.join(dir, hit)
  } catch { /* 没装 */ }
  if (works('ffmpeg')) return 'ffmpeg'
  return ''
}
const FFMPEG = findFfmpeg()
if (!FFMPEG) throw new Error('找不到 ffmpeg，设置 FFMPEG 环境变量指向可执行文件')

/* ---------------------------------------------------------------- 合成音乐
   104 BPM、C 大调，和弦走 C - G - Am - F。
   所有声音都是正弦 / 噪声加包络现场算出来的，固定随机种子保证每次一样。 */
const SR = 44100
const SECONDS = 40
const N = SR * SECONDS
const TAU = Math.PI * 2
const L = new Float32Array(N)
const R = new Float32Array(N)

/* 固定种子：重跑脚本得到同一段音乐，方便对比和回滚 */
let seed = 20261024
function rand() {
  seed = (seed + 0x6D2B79F5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const midiFreq = m => 440 * Math.pow(2, (m - 69) / 12)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function panGain(pan) {
  const p = (clamp(pan, -1, 1) + 1) / 2
  return [Math.cos(p * Math.PI / 2), Math.sin(p * Math.PI / 2)]
}

/* 单音：harmonics = [[倍频, 振幅], ...]，pluck 是指数衰减，pad 是持续音 */
function voice(start, dur, freq, amp, opts = {}) {
  const {
    harmonics = [[1, 1]], attack = 0.005, decay = 0.35, release = 0.06,
    pan = 0, type = 'pluck', detune = 0
  } = opts
  const [gl, gr] = panGain(pan)
  const i0 = Math.max(0, Math.floor(start * SR))
  const n = Math.floor(dur * SR)
  const phase = rand() * TAU
  for (let i = 0; i < n; i++) {
    const idx = i0 + i
    if (idx >= N) break
    const t = i / SR
    let env
    if (type === 'pad') {
      const at = attack > 0 ? Math.min(1, t / attack) : 1
      const rel = t > dur - release ? Math.max(0, (dur - t) / release) : 1
      env = at * rel
    } else {
      const at = attack > 0 ? Math.min(1, t / attack) : 1
      const rel = t > dur - release ? Math.max(0, (dur - t) / release) : 1
      env = at * Math.exp(-Math.max(0, t - attack) / decay) * rel
    }
    if (env < 1e-4) continue
    let v = 0
    for (const [mult, a] of harmonics) {
      v += Math.sin(TAU * freq * mult * (1 + detune) * t + phase) * a
    }
    v *= amp * env
    L[idx] += v * gl
    R[idx] += v * gr
  }
}

function kick(start, amp) {
  const i0 = Math.max(0, Math.floor(start * SR))
  const n = Math.floor(0.24 * SR)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const idx = i0 + i
    if (idx >= N) break
    const t = i / SR
    const f = 44 + 78 * Math.exp(-t * 26)
    phase += TAU * f / SR
    const v = Math.sin(phase) * Math.exp(-t * 13) * amp
    L[idx] += v
    R[idx] += v
  }
}

function shaker(start, amp, pan = 0.5) {
  const [gl, gr] = panGain(pan)
  const i0 = Math.max(0, Math.floor(start * SR))
  const n = Math.floor(0.07 * SR)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const idx = i0 + i
    if (idx >= N) break
    const t = i / SR
    const raw = rand() * 2 - 1
    /* 一阶差分把噪声提亮，像沙锤而不是「噗」 */
    const v = (raw - prev) * 0.5 * Math.exp(-t * 62) * amp
    prev = raw
    L[idx] += v * gl
    R[idx] += v * gr
  }
}

function rim(start, amp) {
  const i0 = Math.max(0, Math.floor(start * SR))
  const n = Math.floor(0.06 * SR)
  for (let i = 0; i < n; i++) {
    const idx = i0 + i
    if (idx >= N) break
    const t = i / SR
    const v = (Math.sin(TAU * 1500 * t) * 0.7 + (rand() * 2 - 1) * 0.3) * Math.exp(-t * 90) * amp
    L[idx] += v * 0.8
    R[idx] += v * 0.8
  }
}

const BPM = 112
const BEAT = 60 / BPM
const EIGHTH = BEAT / 2
const BAR = BEAT * 4

const CHORDS = [
  { root: 36, tones: [60, 64, 67, 71] }, // Cmaj7
  { root: 43, tones: [55, 59, 62, 64] }, // G6
  { root: 45, tones: [57, 60, 64, 67] }, // Am7
  { root: 41, tones: [53, 57, 60, 64] }  // Fmaj7
]
const PROG = [0, 0, 1, 1, 2, 2, 3, 3]
/* 8 小节主旋律：每项 [第几个八分音符, MIDI, 占几个八分音符] */
const MELODY = [
  [[0, 76, 2], [2, 79, 1], [3, 81, 1], [4, 79, 2], [6, 76, 2]],
  [[0, 74, 1], [1, 76, 1], [2, 79, 2], [4, 76, 2], [6, 72, 2]],
  [[0, 74, 2], [2, 79, 1], [3, 83, 1], [4, 81, 2], [6, 79, 2]],
  [[0, 76, 1], [1, 74, 1], [2, 71, 2], [4, 74, 2], [6, 76, 2]],
  [[0, 72, 2], [2, 76, 1], [3, 81, 1], [4, 79, 2], [6, 76, 2]],
  [[0, 74, 1], [1, 72, 1], [2, 69, 2], [4, 72, 2], [6, 74, 2]],
  [[0, 77, 2], [2, 81, 1], [3, 84, 1], [4, 81, 2], [6, 77, 2]],
  [[0, 76, 1], [1, 74, 1], [2, 72, 2], [4, 69, 2], [6, 67, 2]]
]

for (let cycle = 0; cycle < 2; cycle++) {
  for (let bar = 0; bar < 8; bar++) {
    const t0 = (cycle * 8 + bar) * BAR
    const chord = CHORDS[PROG[bar]]

    /* 铺底和弦：每两小节一次，慢起慢收 */
    if (bar % 2 === 0) {
      chord.tones.forEach((tone, i) => {
        voice(t0, BAR * 2, midiFreq(tone - 12), 0.024, {
          type: 'pad', attack: 0.55, release: 1.1,
          pan: [-0.35, -0.12, 0.12, 0.35][i], harmonics: [[1, 1], [2, 0.12]]
        })
      })
    }

    /* 贝斯：每小节根音两下，第 4 拍后半拍补一个五度 */
    voice(t0, BEAT * 0.9, midiFreq(chord.root), 0.12, {
      decay: 0.5, harmonics: [[1, 1], [2, 0.14]]
    })
    voice(t0 + BEAT * 2, BEAT * 0.85, midiFreq(chord.root), 0.1, {
      decay: 0.45, harmonics: [[1, 1], [2, 0.14]]
    })
    voice(t0 + BEAT * 3.5, BEAT * 0.5, midiFreq(chord.root + 7), 0.06, {
      decay: 0.3, harmonics: [[1, 1], [2, 0.1]]
    })

    /* 拨弦扫和弦：第 1、3 拍各一次，错开 22ms 像真的扫弦 */
    for (const beat of [0, 2]) {
      chord.tones.forEach((tone, i) => {
        voice(t0 + beat * BEAT + i * 0.022, 0.55, midiFreq(tone), 0.07, {
          decay: 0.32, pan: -0.28, harmonics: [[1, 1], [2, 0.42], [3, 0.22], [4, 0.1], [5, 0.05]]
        })
      })
    }

    /* 马林巴主旋律：长音为主，留出呼吸 */
    for (const [slot, note, len] of MELODY[bar]) {
      const jitter = (rand() - 0.5) * 0.008
      voice(t0 + slot * EIGHTH + jitter, len * EIGHTH * 0.95, midiFreq(note), 0.11, {
        decay: 0.5, pan: 0.28,
        harmonics: [[1, 1], [2, 0.32], [3, 0.14], [4, 0.05]]
      })
    }

    /* 高音琶音只走正拍，音色更亮，负责手机外放的「轻快」感 */
    for (const slot of [0, 2, 4, 6]) {
      const tone = chord.tones[(slot / 2) % chord.tones.length]
      voice(t0 + slot * EIGHTH, 0.45, midiFreq(tone + 24), 0.032, {
        decay: 0.4, pan: 0.55, harmonics: [[1, 1], [2, 0.22], [3, 0.1]]
      })
    }

    /* 第二遍加一层更高的铃铛，画面重复时不至于完全一样 */
    if (cycle === 1) {
      for (const slot of [2, 6]) {
        voice(t0 + slot * EIGHTH, 0.7, midiFreq(chord.tones[0] + 36), 0.03, {
          decay: 0.5, pan: 0.5, harmonics: [[1, 1], [3, 0.18]]
        })
      }
    }

    /* 轻打击：底鼓不抢拍，沙锤走反拍，第 2、4 拍加一点木鱼边 */
    kick(t0, 0.12)
    kick(t0 + BEAT * 2, 0.09)
    if (bar % 4 === 3) kick(t0 + BEAT * 3.5, 0.06)
    for (const slot of [1, 3, 5, 7]) {
      shaker(t0 + slot * EIGHTH, slot === 1 || slot === 5 ? 0.06 : 0.04, 0.45)
    }
    for (const beat of [1, 3]) rim(t0 + beat * BEAT, 0.03)
  }
}

/* 一点点交叉延迟，让声音有空间但不糊 */
{
  const delay = Math.round(0.19 * SR)
  const wet = 0.1
  const l0 = Float32Array.from(L)
  const r0 = Float32Array.from(R)
  for (let i = delay; i < N; i++) {
    L[i] += r0[i - delay] * wet
    R[i] += l0[i - delay] * wet
  }
}

/* 归一化到 -6 dBFS 峰值；再算一下 RMS 方便判断「会不会太吵」 */
let peak = 0
let sum = 0
for (let i = 0; i < N; i++) {
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  sum += L[i] * L[i] + R[i] * R[i]
}
const gain = peak > 0 ? 0.65 / peak : 1
for (let i = 0; i < N; i++) { L[i] *= gain; R[i] *= gain }
const rms = Math.sqrt(sum / (N * 2)) * gain
const db = v => (v > 0 ? 20 * Math.log10(v) : -Infinity)

function writeWav(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const bytes = N * 2 * 2
  const buf = Buffer.alloc(44 + bytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + bytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2 * 2, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(bytes, 40)
  let o = 44
  for (let i = 0; i < N; i++) {
    buf.writeInt16LE(Math.round(clamp(L[i], -1, 1) * 32767), o); o += 2
    buf.writeInt16LE(Math.round(clamp(R[i], -1, 1) * 32767), o); o += 2
  }
  fs.writeFileSync(file, buf)
}

function makeMusic() {
  writeWav(MUSIC)
  console.log(`♪ ${path.relative(ROOT, MUSIC)}  ${SECONDS}s · 峰值 ${db(0.65).toFixed(1)} dBFS · RMS ${db(rms).toFixed(1)} dBFS`)
}

/* ---------------------------------------------------------------- 混流 */
function durationOf(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr || '')
  if (!m) throw new Error('读不到视频时长：' + file)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function hasAudio(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  return /Stream #\d+:\d+.*Audio:/.test(r.stderr || '')
}

function mixOne(file) {
  const dur = durationOf(file)
  const fadeOut = Math.max(0.8, dur - 2.2)
  const tmp = file.replace(/\.mp4$/, '.music.mp4')
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', file, '-i', MUSIC,
    '-filter_complex',
    `[1:a]highpass=f=35,volume=0.9,afade=t=in:st=0:d=1.4,afade=t=out:st=${fadeOut.toFixed(2)}:d=2.2[a]`,
    '-map', '0:v:0', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', '-shortest', tmp
  ]
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  if (r.status !== 0) {
    try { fs.unlinkSync(tmp) } catch { /* 没生成 */ }
    throw new Error(`混流失败：${path.basename(file)}\n${(r.stderr || '').slice(-800)}`)
  }
  fs.renameSync(tmp, file)
  if (!hasAudio(file)) throw new Error('混流后没有音轨：' + file)
  const after = durationOf(file)
  if (Math.abs(after - dur) > 0.2) throw new Error(`时长变了：${path.basename(file)} ${dur} → ${after}`)
  return { dur, after, size: fs.statSync(file).size }
}

/* ---------------------------------------------------------------- 主流程 */
const args = process.argv.slice(2)
const musicOnly = args.includes('--music-only')
const devices = args.filter(a => a === 'desktop' || a === 'mobile')
const queue = devices.length ? devices : ['desktop', 'mobile']

makeMusic()
if (musicOnly) process.exit(0)

let count = 0
for (const device of queue) {
  const dir = path.join(OUT, device)
  if (!fs.existsSync(dir)) throw new Error('缺少目录：' + dir)
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).sort()
  if (!files.length) throw new Error('没有视频：' + dir)
  console.log(`\n▶ ${device === 'mobile' ? '手机' : '桌面'}端 ${files.length} 段`)
  for (const name of files) {
    const file = path.join(dir, name)
    const info = mixOne(file)
    count++
    console.log(`  ✓ ${device}/${name}  ${info.dur.toFixed(1)}s · ${(info.size / 1024 / 1024).toFixed(2)} MB`)
  }
}

console.log(`\n完成：${count} 段视频已加背景音乐`)
