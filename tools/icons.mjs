// Genera le icone PNG della PWA senza dipendenze: rasterizzazione analitica + zlib.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

// Colore del disegno in coordinate normalizzate (centro 0,0; lato -0.5..0.5).
function shade(x, y) {
  const r = Math.hypot(x, y)
  const a = Math.atan2(y, x)
  if (r > 0.36) return hex('#0f1216')
  if (r > 0.25) {
    // pneumatico con scanalature
    const groove = Math.abs(r - 0.33) < 0.006
    return hex(groove ? '#0b0c0e' : '#2a2d33')
  }
  // peso rosso sulla balconata, a ore 12
  if (r > 0.215 && Math.abs(a + Math.PI / 2) < 0.28) return hex('#e2452f')
  if (r > 0.205) return hex('#c9ced5')
  if (r < 0.05) return r < 0.025 ? hex('#5d636c') : hex('#d5d9de')
  // cinque finestre tra le razze
  const k = ((a / (Math.PI * 2 / 5)) % 1 + 1) % 1
  if (r > 0.08 && r < 0.18 && Math.abs(k - 0.5) < 0.3) return hex('#15181d')
  return hex('#d5d9de')
}

function png(size) {
  const ss = 4
  const rows = []
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3)
    for (let px = 0; px < size; px++) {
      let R = 0, G = 0, B = 0
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const [r, g, b] = shade((px + (sx + 0.5) / ss) / size - 0.5, (py + (sy + 0.5) / ss) / size - 0.5)
          R += r; G += g; B += b
        }
      const n = ss * ss
      row[1 + px * 3] = R / n; row[2 + px * 3] = G / n; row[3 + px * 3] = B / n
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const s of [192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s))
console.log('icone generate')
