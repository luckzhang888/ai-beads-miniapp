const test = require('node:test')
const assert = require('node:assert/strict')
const { detectImageType, normalizeOptions, MAX_BYTES } = require('../image')
const { createDeepSeekProvider } = require('../deepseek')
const { validateAiAnalysis } = require('../normalize')
const { _test } = require('../index')

function validAnalysis() {
  return {
    imageType: 'bead_pattern', hasGrid: true, rows: 30, columns: 30,
    rotation: 0, confidence: 0.92, hasLabels: true,
    detectedCodes: ['h2', 'G9', 'H2', 'P1', 'H24'], legendCodes: ['M12', 'G9'],
    legendEntries: [{ code: 'H2', count: 500 }, { code: 'G9', count: 400 }, { code: 'M12', count: 300 }, { code: 'P1', count: 5 }],
    declaredColorCount: 3, declaredBeadCount: 1200, background: 'white',
    grid: { left: 0.05, top: 0.05, right: 0.95, bottom: 0.95 },
    perspective: null, warnings: []
  }
}

test('cloud image validation accepts supported magic and rejects oversized input', () => {
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)])
  assert.equal(detectImageType(png), 'image/png')
  assert.equal(detectImageType(Buffer.alloc(12)), null)
  assert.equal(MAX_BYTES, 10 * 1024 * 1024)
  assert.deepEqual(normalizeOptions({ mode: 'auto', expectedSize: 48, palette: 'MARD' }),
    { mode: 'auto', expectedSize: 48, palette: 'MARD' })
  assert.equal(normalizeOptions({ mode: 'wrong' }), null)
})

test('cloud DeepSeek provider sends vision request and normalizes response', async () => {
  let request
  const provider = createDeepSeekProvider({ apiKey: 'test-key', model: 'vision-test' }, async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      async json() { return { choices: [{ message: { content: JSON.stringify(validAnalysis()) } }] } }
    }
  })
  const result = await provider.analyze({ buffer: Buffer.from('image'), mimeType: 'image/png' }, { mode: 'auto' })
  assert.equal(result.rows, 30)
  assert.deepEqual(result.detectedCodes, ['H2', 'G9'])
  assert.deepEqual(result.legendCodes, ['M12', 'G9'])
  assert.deepEqual(result.legendEntries, [{ code: 'H2', count: 500 }, { code: 'G9', count: 400 }, { code: 'M12', count: 300 }])
  assert.equal(result.declaredColorCount, 3)
  assert.equal(result.declaredBeadCount, 1200)
  assert.match(request.url, /\/chat\/completions$/)
  assert.equal(request.options.headers.Authorization, 'Bearer test-key')
  const payload = JSON.parse(request.options.body)
  assert.equal(payload.model, 'vision-test')
  assert.match(payload.messages[1].content[1].image_url.url, /^data:image\/png;base64,/)
})

test('analysis validation rejects invented or malformed grids', () => {
  assert.throws(() => validateAiAnalysis(Object.assign(validAnalysis(), { rows: null })), { code: 'AI_INVALID_RESULT' })
  assert.throws(() => validateAiAnalysis(Object.assign(validAnalysis(), { declaredBeadCount: 0 })), { code: 'AI_INVALID_RESULT' })
})

test('cloud upload integrity proves the downloaded object is byte-for-byte identical', () => {
  const buffer = Buffer.from('original-image-bytes')
  const digest = require('node:crypto').createHash('md5').update(buffer).digest('hex')
  assert.deepEqual(_test.verifyUploadIntegrity(buffer, buffer.length, digest), {
    verified: true, supplied: true, mismatch: false, bytes: buffer.length, matchesBytes: true, matchesDigest: true
  })
  const changed = _test.verifyUploadIntegrity(Buffer.from('changed-image-bytes'), buffer.length, digest)
  assert.equal(changed.verified, false)
  assert.equal(changed.supplied, true)
  assert.equal(changed.mismatch, true)
  assert.equal(changed.matchesDigest, false)
  const sizeOnly = _test.verifyUploadIntegrity(buffer, buffer.length, '')
  assert.equal(sizeOnly.verified, false)
  assert.equal(sizeOnly.mismatch, false)
})

test('cloud image URL validation only accepts matching Tencent storage objects', () => {
  const fileID = 'cloud://test-env.bucket/ai-inputs/a.png'
  assert.equal(_test.validCloudImageUrl(fileID, 'https://test-env.tcb.qcloud.la/ai-inputs/a.png?sign=1'),
    'https://test-env.tcb.qcloud.la/ai-inputs/a.png?sign=1')
  assert.equal(_test.validCloudImageUrl(fileID, 'http://test-env.tcb.qcloud.la/ai-inputs/a.png'), null)
  assert.equal(_test.validCloudImageUrl(fileID, 'https://127.0.0.1/ai-inputs/a.png'), null)
  assert.equal(_test.validCloudImageUrl(fileID, 'https://test-env.tcb.qcloud.la/ai-inputs/b.png'), null)
})
