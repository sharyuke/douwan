/* =========================================================================
   极简 PNG 读写（评测脚本共用）
   -------------------------------------------------------------------------
   从 scripts/fidelity/bench.mjs 里原样抽出来的：readPNG / crc32 / writePNG。
   抽出来的理由是 matte-bench.mjs 也要读写 PNG，而这两份实现必须**逐位一致**
   （否则两个评测脚本读到的像素口径不同，数字没法互相印证）。

   限制（刻意保持简单，评测图都是自己生成的）：
     - 只支持 8bit、非隔行；
     - 支持颜色类型 0(灰) / 2(RGB) / 3(调色板) / 4(灰+透明) / 6(RGBA)；
     - filter 0~4 全部支持；
     - 输出统一是 RGBA（Uint8ClampedArray，长度 w*h*4），不透明像素 A=255。
       bench.mjs 的调用点只用到 .data/.width/.height，加一个 channels 字段是纯增量。

   写：writePNG(file, rgb, width, height) —— rgb 是 RGB 排列（每像素 3 字节），
   签名与行为跟 bench.mjs 原来那份完全一致（bench.mjs 的调用点不允许改）。
   ========================================================================= */

import fs from 'node:fs'
import zlib from 'node:zlib'

/**
 * 读 PNG。
 * @param {string} file
 * @returns {{data: Uint8ClampedArray, width: number, height: number, channels: number}}
 *   data 恒为 RGBA 排列（4 通道）；channels 是文件本身的通道数（1/2/3/4）。
 */
export function readPNG(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG: ' + file)
  let off = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  let palette = null
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      palette = Buffer.from(data)
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`只支持 8bit 非隔行 PNG（${file}: depth=${depth} interlace=${interlace}）`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error('不支持的 PNG 颜色类型 ' + colorType)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8ClampedArray(width * height * 4)
  let prev = Buffer.alloc(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const line = Buffer.from(raw.subarray(p, p + stride))
    p += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 255
    }
    prev = line
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (colorType === 3) {
        const idx = line[x] * 3
        out[o] = palette[idx]; out[o + 1] = palette[idx + 1]; out[o + 2] = palette[idx + 2]; out[o + 3] = 255
      } else if (colorType === 0 || colorType === 4) {
        out[o] = line[x * channels]; out[o + 1] = line[x * channels]; out[o + 2] = line[x * channels]
        out[o + 3] = colorType === 4 ? line[x * channels + 1] : 255
      } else {
        out[o] = line[x * channels]
        out[o + 1] = line[x * channels + 1]
        out[o + 2] = line[x * channels + 2]
        out[o + 3] = colorType === 6 ? line[x * channels + 3] : 255
      }
    }
  }
  return { data: out, width, height, channels }
}

/** 标准 CRC32（PNG 分块校验用） */
export function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/**
 * 写 PNG（8bit RGB，颜色类型 2，filter 全 0）。
 * 与 bench.mjs 原来的实现逐字节一致：同样的 IHDR、同样的 zlib level 9、
 * 同样的分块顺序，所以同一份数据写出来的文件是同一个文件。
 * @param {string} file
 * @param {Uint8Array|Uint8ClampedArray} rgb 每像素 3 字节（R,G,B）
 * @param {number} width
 * @param {number} height
 */
export function writePNG(file, rgb, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3
      const d = y * (width * 3 + 1) + 1 + x * 3
      raw[d] = rgb[o]; raw[d + 1] = rgb[o + 1]; raw[d + 2] = rgb[o + 2]
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]))
}
