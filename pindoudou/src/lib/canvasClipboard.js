/* 操作台画布的剪贴板。
   网页图片走系统给的 image/*。两张操作台之间要带走「正在改的格子」，
   不能只贴一张重算过的图 —— 重算会把已经改过的色号换掉。
   自定义类型在有的浏览器里过不了粘贴事件，所以同一份内容再写进 text/html
   的 data-douwan-canvas。读的时候两种都认。 */

const CLIP_TYPE = 'application/x-douwan-canvas'
const HTML_KEY = 'data-douwan-canvas="'
const PLAIN_PREFIX = '豆玩图纸'

function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step))
  }
  return btoa(bin)
}

function b64ToUtf8(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** 从粘贴事件里取出豆玩图纸 JSON。没有就返回空串。 */
export function readCanvasPayload(dt) {
  if (!dt || typeof dt.getData !== 'function') return ''
  const direct = safeGet(dt, CLIP_TYPE) || safeGet(dt, 'web application/x-douwan-canvas')
  if (direct && direct.includes('"variants"')) return direct
  return payloadFromHtml(safeGet(dt, 'text/html'))
}

export function payloadFromHtml(html) {
  if (!html) return ''
  const at = html.indexOf(HTML_KEY)
  if (at < 0) return ''
  const start = at + HTML_KEY.length
  const end = html.indexOf('"', start)
  if (end <= start) return ''
  try {
    return b64ToUtf8(html.slice(start, end).replace(/\s+/g, ''))
  } catch {
    return ''
  }
}

function safeGet(dt, type) {
  try { return dt.getData(type) || '' } catch { return '' }
}

/** 粘贴事件里的图片文件。网页「复制图片」通常落在这里。 */
export function imageFileFromData(dt) {
  if (!dt) return null
  const files = dt.files
  if (files) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (f && /^image\//.test(f.type)) return f
    }
  }
  const items = dt.items
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item && item.kind === 'file' && /^image\//.test(item.type || '')) {
        const f = typeof item.getAsFile === 'function' ? item.getAsFile() : null
        if (f) return f
      }
    }
  }
  return null
}

/** 剪贴板 HTML 里的图片地址。豆玩自己的图纸 HTML 不算。 */
export function imageUrlFromHtml(html) {
  if (!html || html.includes(HTML_KEY)) return ''
  const m = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html)
  if (!m) return ''
  const src = m[1]
  if (src.startsWith('data:image/')) return src
  if (/^https?:\/\//i.test(src)) return src
  return ''
}

export function plainCanvasLabel(dt) {
  const text = safeGet(dt, 'text/plain')
  return text.startsWith(PLAIN_PREFIX) ? text : ''
}

/** 系统给的文件名经常是 image.png。这种换成「粘贴的图片」，作品名才看得懂。 */
export function namedPasteFile(file) {
  if (!file) return file
  const raw = String(file.name || '').trim()
  const generic = !raw || /^(image|blob|pasted)(\.|$)/i.test(raw)
  if (!generic) return file
  const type = file.type || 'image/png'
  const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '')
  return new File([file], `粘贴的图片.${ext || 'png'}`, { type })
}

export async function fileFromImageUrl(url) {
  if (!url) return null
  let res
  try {
    res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(15000) })
  } catch {
    throw new Error('这张图跨域读不到，请在图片上右键「复制图片」再粘贴')
  }
  if (!res.ok) throw new Error('图片读取失败')
  const blob = await res.blob()
  if (!/^image\//.test(blob.type)) throw new Error('剪贴板里不是图片')
  return namedPasteFile(new File([blob], 'image.png', { type: blob.type }))
}

/**
 * 把图纸 JSON 写进剪贴板。必须在用户按键里同步调用。
 * 返回 false 表示浏览器没让写。
 */
export function copyCanvasRecord(json, label) {
  if (!json) return false
  const html = `<div ${HTML_KEY}${utf8ToB64(json)}"></div>`
  const plain = label && label.startsWith(PLAIN_PREFIX) ? label : `${PLAIN_PREFIX}${label ? ' ' + label : ''}`
  const holder = document.createElement('textarea')
  holder.value = plain
  holder.setAttribute('readonly', '')
  holder.setAttribute('aria-hidden', 'true')
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  const prev = document.activeElement
  document.body.appendChild(holder)
  holder.focus()
  holder.select()
  let wrote = false
  const onCopy = e => {
    if (!e.clipboardData) return
    e.preventDefault()
    e.stopPropagation()
    try { e.clipboardData.setData('text/plain', plain) } catch { /* 这一种写不进就靠别的 */ }
    try { e.clipboardData.setData('text/html', html) } catch { /* 同上 */ }
    try { e.clipboardData.setData(CLIP_TYPE, json) } catch { /* 同上 */ }
    wrote = true
  }
  document.addEventListener('copy', onCopy, true)
  let commanded = false
  try { commanded = document.execCommand('copy') } catch { commanded = false }
  document.removeEventListener('copy', onCopy, true)
  holder.remove()
  if (prev && typeof prev.focus === 'function') {
    try { prev.focus() } catch { /* 焦点还回去失败不影响已经写进剪贴板的内容 */ }
  }
  return !!(commanded && wrote)
}
