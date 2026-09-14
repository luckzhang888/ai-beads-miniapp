// Explicit manual smoke test: one real DeepSeek request, never run by CI.
const zlib = require('node:zlib')

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const label = Buffer.from(type)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([label, data])))
  return Buffer.concat([size, label, data, checksum])
}

function syntheticGrid() {
  const size = 384
  const cell = 48
  const colors = [
    [255, 221, 105], [89, 188, 156], [230, 108, 113], [120, 170, 226],
    [255, 171, 91], [180, 139, 212], [239, 193, 202], [126, 203, 205]
  ]
  const raw = Buffer.alloc(size * (1 + size * 3))
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = y * (1 + size * 3) + 1 + x * 3
      const rgb = x % cell < 2 || y % cell < 2
        ? [72, 72, 72]
        : colors[(Math.floor(y / cell) * 3 + Math.floor(x / cell)) % colors.length]
      raw.set(rgb, offset)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ])
}

async function main() {
  const origin = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/$/, '')
  const form = new FormData()
  form.append('image', new Blob([syntheticGrid()], { type: 'image/png' }), 'synthetic-grid.png')
  form.append('mode', 'diagram')
  form.append('palette', 'MARD')
  const response = await fetch(origin + '/api/v1/beads/analyze', { method: 'POST', body: form, signal: AbortSignal.timeout(130000) })
  const body = await response.json()
  console.log(JSON.stringify({ status: response.status, code: body.error && body.error.code,
    provider: body.provider, imageType: body.result && body.result.imageType,
    hasGrid: body.result && body.result.hasGrid, rows: body.result && body.result.rows,
    columns: body.result && body.result.columns }))
  if (!response.ok) process.exitCode = 1
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
