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
    detectedCodes: ['h2', 'G9', 'H2'], background: 'white',
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
  assert.match(request.url, /\/chat\/completions$/)
  assert.equal(request.options.headers.Authorization, 'Bearer test-key')
  const payload = JSON.parse(request.options.body)
  assert.equal(payload.model, 'vision-test')
  assert.match(payload.messages[1].content[1].image_url.url, /^data:image\/png;base64,/)
})

test('analysis validation rejects invented or malformed grids', () => {
  assert.throws(() => validateAiAnalysis(Object.assign(validAnalysis(), { rows: null })), { code: 'AI_INVALID_RESULT' })
})

test('cloud image URL validation only accepts matching Tencent storage objects', () => {
  const fileID = 'cloud://test-env.bucket/ai-inputs/a.png'
  assert.equal(_test.validCloudImageUrl(fileID, 'https://test-env.tcb.qcloud.la/ai-inputs/a.png?sign=1'),
    'https://test-env.tcb.qcloud.la/ai-inputs/a.png?sign=1')
  assert.equal(_test.validCloudImageUrl(fileID, 'http://test-env.tcb.qcloud.la/ai-inputs/a.png'), null)
  assert.equal(_test.validCloudImageUrl(fileID, 'https://127.0.0.1/ai-inputs/a.png'), null)
  assert.equal(_test.validCloudImageUrl(fileID, 'https://test-env.tcb.qcloud.la/ai-inputs/b.png'), null)
})
