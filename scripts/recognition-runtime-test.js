const assert = require('assert')
const palette = require('../miniprogram/data/colors/mard')
const { gridImageToPattern } = require('../miniprogram/utils/image')
const { recognizeKnownGrid, classifySampleRows, classifySampleRowsAsync } = require('../miniprogram/utils/grid-recognition')

// Canvas test double: exercise the production async pipeline, including resize,
// original-image reuse, row sampling and progress, without a cloud AI service.
function createCanvasRuntime(fixture) {
  const calls = { decodes: 0, canvases: 0, widths: [] }
  return {
    calls,
    getImageInfo({ success }) { success({ path: 'fixture.png', width: fixture.width, height: fixture.height }) },
    createOffscreenCanvas(options) {
      calls.canvases += 1
      let width = options.width
      let height = options.height
      let draw = null
      const context = {
        clearRect() { draw = null },
        drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) { draw = { sx, sy, sw, sh, dx, dy, dw, dh } },
        getImageData(left, top, outputWidth, outputHeight) {
          assert.ok(draw, 'draw must be restored after resizing the canvas')
          assert.ok(outputWidth <= 4096, 'row canvas must stay within the dimension limit')
          calls.widths.push(outputWidth)
          const data = new Uint8ClampedArray(outputWidth * outputHeight * 4)
          for (let y = 0; y < outputHeight; y += 1) {
            for (let x = 0; x < outputWidth; x += 1) {
              const sourceX = Math.floor(draw.sx + (left + x + 0.5 - draw.dx) / draw.dw * draw.sw)
              const sourceY = Math.floor(draw.sy + (top + y + 0.5 - draw.dy) / draw.dh * draw.sh)
              if (sourceX < 0 || sourceY < 0 || sourceX >= fixture.width || sourceY >= fixture.height) continue
              const offset = (sourceY * fixture.width + sourceX) * 4
              data.set(fixture.imageData.data.subarray(offset, offset + 4), (y * outputWidth + x) * 4)
            }
          }
          return { data }
        }
      }
      return {
        get width() { return width },
        set width(value) { width = value; draw = null },
        get height() { return height },
        set height(value) { height = value; draw = null },
        getContext() { return context },
        createImage() {
          const image = { onload: null }
          Object.defineProperty(image, 'src', { set() { calls.decodes += 1; Promise.resolve().then(() => image.onload()) } })
          return image
        }
      }
    }
  }
}

async function run({ guideFixture, convertPage }) {
  const previousWx = global.wx
  try {
    const native = recognizeKnownGrid({ data: new Uint8ClampedArray([
      231, 0, 47, 255, 24, 135, 162, 255, 0, 0, 0, 0
    ]) }, 3, 1, 3, 1, palette, { recognitionMode: 'native-pixel' })
    assert.deepStrictEqual(native.matrix, [['F5', 'C19', '']], 'one-pixel cells must retain their own colour and alpha')

    const codes = Array.from({ length: 5 }, (_, row) => Array(5).fill(row < 3 ? 'A1' : 'C19'))
    codes[1][1] = 'F5'
    const rareSamples = codes.map((row) => row.map((code) => ({
      rgb: palette.find((item) => item.code === code).rgb,
      inkRatio: 0.08, lightInkRatio: 0, whiteRatio: 0, sampleCount: 64
    })))
    assert.deepStrictEqual(classifySampleRows(rareSamples, palette).matrix, codes,
      'a single real bead must not be erased by neighbour smoothing')

    const noisySamples = Array.from({ length: 106 }, (_, row) => Array.from({ length: 99 }, (_, column) => ({
      rgb: [40 + column, 60 + row, 100 + (row + column) % 90],
      inkRatio: 0.08, lightInkRatio: 0, whiteRatio: 0, sampleCount: 64
    })))
    const matchingProgress = []
    let ticks = 0
    const heartbeat = setInterval(() => { ticks += 1 }, 0)
    let asynchronous
    try {
      asynchronous = await classifySampleRowsAsync(noisySamples, palette, {
        onClassificationProgress: (fraction) => matchingProgress.push(fraction)
      })
    } finally { clearInterval(heartbeat) }
    assert.ok(ticks > 0, 'compressed images with many distinct colours must yield to UI events')
    assert.ok(matchingProgress.length >= 2, 'matching must report intermediate progress')
    assert.strictEqual(matchingProgress[matchingProgress.length - 1], 1)
    assert.deepStrictEqual(asynchronous, classifySampleRows(noisySamples, palette), 'batching must preserve all recognition results')

    const runtime = createCanvasRuntime(guideFixture)
    global.wx = runtime
    const progress = []
    const result = await gridImageToPattern('fixture.png', 80, palette, {
      inputMode: 'diagram',
      onProgress: (value, step) => progress.push({ value, step })
    })
    assert.deepStrictEqual([result.width, result.height, result.usedColorCount, result.beadCount], [99, 106, 15, 6813])
    assert.strictEqual(runtime.calls.decodes, 1, 'decode original image once')
    assert.strictEqual(runtime.calls.canvases, 1, 'reuse processor canvas for source sampling')
    assert.ok(progress.filter((item) => item.value > 52 && item.value < 90).length > 10)
    assert.ok(progress.some((item) => item.value > 90 && item.value < 100))
    assert.strictEqual(progress[progress.length - 1].value, 100)
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index].value >= progress[index - 1].value, 'progress cannot move backwards')
    }

    global.wx = { showModal() { throw new Error('recognition unexpectedly failed') } }
    convertPage.setData({ imagePath: 'fixture.png', recognitionProgress: 0 })
    convertPage.processCurrentImage = async (onProgress) => {
      await onProgress(64, '逐格采样')
      assert.strictEqual(convertPage.data.recognitionProgress, 64)
      return Object.assign({}, result, { validation: { ok: false, warnings: ['Missing guides'] } })
    }
    await convertPage.runAiRecognition()
    assert.strictEqual(convertPage.data.recognitionProgress, 100)
    assert.strictEqual(convertPage.data.recognitionResult.exactRecognition, false)
    assert.strictEqual(convertPage.data.recognitionResult.needsReview, true)
    console.log('Recognition runtime passed: native pixels, rare colours, noisy-image UI yields, one decode, 99x106/15/6813 and progress.')
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

module.exports = { run }
