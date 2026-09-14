const test = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../src/app')
const { MAX_BYTES } = require('../src/routes/recognize')
const { createDeepSeekProvider } = require('../src/services/vision/deepseek')
const { validateAiAnalysis, parseAiJson } = require('../src/services/vision/normalize')

const validAnalysis = {
  imageType: 'bead_pattern', hasGrid: true, rows: 48, columns: 43,
  rotation: 0, confidence: 0.94, hasLabels: true, background: 'white',
  grid: { left: 0.05, top: 0.08, right: 0.95, bottom: 0.94 },
  perspective: { topLeft: [0.05, 0.08], topRight: [0.95, 0.08],
    bottomLeft: [0.05, 0.94], bottomRight: [0.95, 0.94] }, warnings: []
}
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 0])
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const gif = Buffer.from('GIF89a______', 'ascii')
const webp = Buffer.from('RIFF____WEBP', 'ascii')

async function withApp(provider, callback) {
  const server = createApp(provider).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try { return await callback(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise((resolve) => server.close(resolve)) }
}

async function postImage(baseUrl, buffer, name = 'image.jpg') {
  const form = new FormData()
  if (buffer) form.append('image', new Blob([buffer]), name)
  form.append('mode', 'auto')
  form.append('expectedSize', '48')
  form.append('palette', 'MARD')
  const response = await fetch(baseUrl + '/api/v1/beads/analyze', { method: 'POST', body: form })
  return { status: response.status, body: await response.json() }
}

test('healthz does not call provider; image validation and JPEG/PNG routes', async () => {
  const received = []
  await withApp({ model: 'mock', analyze: async (image) => { received.push(image.mimeType); return validAnalysis } }, async (url) => {
    const health = await fetch(url + '/healthz')
    assert.deepEqual(await health.json(), { ok: true })
    assert.equal(received.length, 0)
  })
})

test('API rejects missing, illegal and oversized uploads; accepts JPEG, PNG, GIF and WebP', async () => {
  const received = []
  await withApp({ model: 'mock', analyze: async (image) => { received.push(image.mimeType); return validAnalysis } }, async (url) => {
    const missing = await postImage(url, null)
    assert.equal(missing.status, 400)
    assert.equal(missing.body.error.code, 'IMAGE_REQUIRED')
    const illegal = await postImage(url, Buffer.from('not an image'))
    assert.equal(illegal.status, 415)
    assert.equal(illegal.body.error.code, 'INVALID_IMAGE')
    const oversized = await postImage(url, Buffer.alloc(MAX_BYTES + 1))
    assert.equal(oversized.status, 413)
    assert.equal(oversized.body.error.code, 'IMAGE_TOO_LARGE')
    const jpg = await postImage(url, jpeg)
    assert.equal(jpg.status, 200)
    assert.equal(jpg.body.result.rows, 48)
    const withoutExpectedSize = new FormData()
    withoutExpectedSize.append('image', new Blob([jpeg]), 'image.jpg')
    withoutExpectedSize.append('expectedSize', '')
    const optional = await fetch(url + '/api/v1/beads/analyze', { method: 'POST', body: withoutExpectedSize })
    assert.equal(optional.status, 200, 'an automatically selected size must not bias or invalidate AI analysis')
    const pngResult = await postImage(url, png, 'image.png')
    assert.equal(pngResult.status, 200)
    assert.equal((await postImage(url, gif, 'image.gif')).status, 200)
    assert.equal((await postImage(url, webp, 'image.webp')).status, 200)
    assert.deepEqual(received, ['image/jpeg', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'])
  })
})

test('provider errors and invalid JSON return safe, structured errors', async () => {
  for (const [response, code, status] of [
    [new Response('{}', { status: 500 }), 'AI_PROVIDER_FAILED', 502],
    [new Response('{}', { status: 429 }), 'AI_RATE_LIMITED', 429],
    [new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 }), 'AI_INVALID_RESULT', 502]
  ]) {
    const provider = createDeepSeekProvider({ apiKey: 'test-only', baseUrl: 'https://mock.invalid' }, async () => response)
    await withApp(provider, async (url) => {
      const result = await postImage(url, jpeg)
      assert.equal(result.status, status)
      assert.equal(result.body.error.code, code)
      assert.equal(result.body.ok, false)
    })
  }
  const timeoutProvider = createDeepSeekProvider({ apiKey: 'test-only' }, async () => { throw new DOMException('Aborted', 'AbortError') })
  await withApp(timeoutProvider, async (url) => {
    const result = await postImage(url, png, 'image.png')
    assert.equal(result.status, 504)
    assert.equal(result.body.error.code, 'AI_TIMEOUT')
  })
})

test('DeepSeek request uses vision image_url, original detail and JSON mode', async () => {
  let outbound
  const provider = createDeepSeekProvider({ apiKey: 'test-only', model: 'deepseek-v4-flash-vision-exp' }, async (url, init) => {
    outbound = { url, init, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validAnalysis) } }] }), { status: 200 })
  })
  const analyzed = await provider.analyze({ buffer: png, mimeType: 'image/png' }, { mode: 'auto' })
  assert.equal(analyzed.rows, 48)
  assert.equal(outbound.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(outbound.body.model, 'deepseek-v4-flash-vision-exp')
  assert.deepEqual(outbound.body.response_format, { type: 'json_object' })
  assert.equal(outbound.body.messages[1].content[1].image_url.detail, 'original')
  assert.match(outbound.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/)
})

test('AI analysis parser rejects bad size, confidence, coordinates, fields and crossed corners', () => {
  assert.equal(parseAiJson('```json\n{"ok":true}\n```').ok, true)
  for (const edit of [
    { rows: 5000 }, { columns: -1 }, { confidence: 1.2 },
    { grid: { ...validAnalysis.grid, right: 1.2 } }, { hasLabels: undefined },
    { perspective: { ...validAnalysis.perspective, bottomRight: [0.02, 0.03] } }
  ]) assert.throws(() => validateAiAnalysis({ ...validAnalysis, ...edit }), { code: 'AI_INVALID_RESULT' })
})
