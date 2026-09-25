/**
 * 生成应用图标 build/icon.png（512x512，纯 Node 实现，无第三方依赖）
 * 设计：深色圆角底 + 琥珀金电影胶片环 + 三格胶片孔
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SIZE = 512
const buf = Buffer.alloc(SIZE * SIZE * 4)

// ── CRC32 ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

// ── 绘制工具 ────────────────────────────────────────────
const set = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  const na = a / 255
  buf[i] = Math.round(buf[i] * (1 - na) + r * na)
  buf[i + 1] = Math.round(buf[i + 1] * (1 - na) + g * na)
  buf[i + 2] = Math.round(buf[i + 2] * (1 - na) + b * na)
  buf[i + 3] = Math.max(buf[i + 3], a)
}

// 圆角矩形（超采样抗锯齿）
function roundRect(x0, y0, x1, y1, rad, color, alpha = 255) {
  const [r, g, b] = color
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const cx = Math.min(Math.max(x + 0.5, x0 + rad), x1 - rad)
      const cy = Math.min(Math.max(y + 0.5, y0 + rad), y1 - rad)
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const cov = Math.max(0, Math.min(1, rad - d + 0.5))
      if (cov > 0) set(x, y, r, g, b, alpha * cov)
    }
  }
}

function ring(cx, cy, radius, width, color, alpha = 255, from = 0, to = Math.PI * 2) {
  const [r, g, b] = color
  const outer = radius + width / 2
  const inner = radius - width / 2
  for (let y = Math.floor(cy - outer - 2); y <= Math.ceil(cy + outer + 2); y++) {
    for (let x = Math.floor(cx - outer - 2); x <= Math.ceil(cx + outer + 2); x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d > outer + 1 || d < inner - 1) continue
      let ang = Math.atan2(dy, dx)
      if (ang < 0) ang += Math.PI * 2
      if (from <= to) { if (ang < from || ang > to) continue }
      const cov = Math.min(1, outer - d + 0.5) * Math.min(1, d - inner + 0.5)
      if (cov > 0) set(x, y, r, g, b, alpha * Math.max(0, Math.min(1, cov)))
    }
  }
}

function disc(cx, cy, radius, color, alpha = 255) {
  const [r, g, b] = color
  for (let y = Math.floor(cy - radius - 2); y <= Math.ceil(cy + radius + 2); y++) {
    for (let x = Math.floor(cx - radius - 2); x <= Math.ceil(cx + radius + 2); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const cov = Math.max(0, Math.min(1, radius - d + 0.5))
      if (cov > 0) set(x, y, r, g, b, alpha * cov)
    }
  }
}

// ── 合成 ────────────────────────────────────────────────
const AMBER = [224, 167, 94]
const AMBER_D = [184, 118, 58]
const DARK = [12, 14, 20]

// 1. 深色圆角底
roundRect(18, 18, SIZE - 18, SIZE - 18, 104, DARK, 255)
// 2. 内侧微亮层
roundRect(30, 30, SIZE - 30, SIZE - 30, 92, [20, 24, 34], 255)

// 3. 外圈琥珀环（按纵向渐变，避免放射状毛刺）
const cx = SIZE / 2, cy = SIZE / 2
{
  const rMid = 178, halfW = 11
  const outer = rMid + halfW, inner = rMid - halfW
  for (let y = Math.floor(cy - outer - 2); y <= Math.ceil(cy + outer + 2); y++) {
    for (let x = Math.floor(cx - outer - 2); x <= Math.ceil(cx + outer + 2); x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d > outer + 1 || d < inner - 1) continue
      const cov = Math.max(0, Math.min(1, outer - d + 0.5)) * Math.max(0, Math.min(1, d - inner + 0.5))
      if (cov <= 0) continue
      const t = Math.max(0, Math.min(1, (y - (cy - outer)) / (outer * 2)))
      const col = [
        Math.round(AMBER[0] + (AMBER_D[0] - AMBER[0]) * t),
        Math.round(AMBER[1] + (AMBER_D[1] - AMBER[1]) * t),
        Math.round(AMBER[2] + (AMBER_D[2] - AMBER[2]) * t),
      ]
      set(x, y, col[0], col[1], col[2], 255 * cov)
    }
  }
}

// 4. 胶片孔（左右两列小方孔）
for (let i = 0; i < 5; i++) {
  const y = 152 + i * 52
  roundRect(72, y, 104, y + 26, 7, AMBER, 235)
  roundRect(SIZE - 104, y, SIZE - 72, y + 26, 7, AMBER, 235)
}

// 5. 中心：镜头光圈叶片（8 片三角）
const R = 92
for (let k = 0; k < 8; k++) {
  const a0 = (k / 8) * Math.PI * 2 + 0.22
  const a1 = ((k + 1) / 8) * Math.PI * 2 + 0.05
  const rIn = 46
  for (let t = 0; t <= 1; t += 0.004) {
    const ang = a0 + (a1 - a0) * t
    for (let rr = rIn; rr <= R; rr += 0.5) {
      const x = Math.round(cx + Math.cos(ang) * rr - 0.5)
      const y = Math.round(cy + Math.sin(ang) * rr - 0.5)
      const fade = 1 - (rr - rIn) / (R - rIn) * 0.35
      set(x, y, AMBER[0], AMBER[1], AMBER[2], 200 * fade)
    }
  }
}

// 6. 中心亮点
disc(cx, cy, 34, [14, 16, 22], 255)
disc(cx, cy, 22, AMBER, 255)
disc(cx - 7, cy - 8, 8, [255, 232, 196], 200)

// ── 编码 PNG ────────────────────────────────────────────
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const outDir = path.join(__dirname, '..', 'build')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'icon.png'), png)
console.log('icon.png written:', png.length, 'bytes ->', path.join(outDir, 'icon.png'))
