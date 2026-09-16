const MAX_BYTES = 10 * 1024 * 1024

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

function normalizeOptions(event) {
  const mode = event.mode || 'auto'
  if (!['auto', 'diagram', 'pixel', 'photo'].includes(mode) || (event.palette && event.palette !== 'MARD')) return null
  const expectedSize = event.expectedSize === undefined || event.expectedSize === '' ? null : Number(event.expectedSize)
  if (expectedSize !== null && (!Number.isInteger(expectedSize) || expectedSize < 16 || expectedSize > 256)) return null
  return { mode, expectedSize, palette: 'MARD' }
}

module.exports = { detectImageType, normalizeOptions, MAX_BYTES }
