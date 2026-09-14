const assert = require('assert')
const palette = require('../miniprogram/data/colors/mard')
const { gridImageToPattern, aiGuidedImageToPattern } = require('../miniprogram/utils/image')
const { guidedGridDisagreesWithLocal } = require('../miniprogram/utils/ai-grid')
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

    const guidedPixels = new Uint8ClampedArray(12 * 12 * 4)
    const guidedCodes = [['F5', 'C19'], ['B9', 'G8']]
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const rgb = palette.find((item) => item.code === guidedCodes[Math.floor(y / 6)][Math.floor(x / 6)]).rgb
        guidedPixels.set(rgb.concat([255]), (y * 12 + x) * 4)
      }
    }
    const guidedAnalysis = {
      imageType: 'bead_pattern', hasGrid: true, rows: 2, columns: 2,
      confidence: 0.95, hasLabels: false, warnings: [], grid: { left: 0, top: 0, right: 1, bottom: 1 },
      perspective: { topLeft: [0, 0], topRight: [1, 0], bottomLeft: [0, 1], bottomRight: [1, 1] }
    }
    global.wx = createCanvasRuntime({ width: 12, height: 12, imageData: { data: guidedPixels } })
    const guidedProgress = []
    const guided = await aiGuidedImageToPattern('fixture.png', palette, guidedAnalysis,
      { onProgress: (value) => guidedProgress.push(value) })
    assert.deepStrictEqual([guided.width, guided.height, guided.beadCount], [2, 2, 4])
    assert.deepStrictEqual(guided.matrix, guidedCodes, 'AI geometry must produce a local MARD matrix')
    assert.strictEqual(guided.recognitionMode, 'ai-guided-grid')
    assert.strictEqual(guidedProgress[guidedProgress.length - 1], 100)

    const localGrid = { ok: true, rows: 29, columns: 28, cellWidth: 40, cellHeight: 40, confidence: 0.88 }
    assert.strictEqual(guidedGridDisagreesWithLocal({ rows: 40, columns: 40, rotation: 0 }, localGrid, 1170, 1178), true)
    assert.strictEqual(guidedGridDisagreesWithLocal({ rows: 30, columns: 30, rotation: 0 }, localGrid, 1170, 1178), false)
    assert.strictEqual(guidedGridDisagreesWithLocal({ rows: 40, columns: 40, rotation: 90 }, localGrid, 1170, 1178), false)

    const rotatedPixels = new Uint8ClampedArray(12 * 12 * 4)
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const sourceX = y
        const sourceY = 11 - x
        rotatedPixels.set(guidedPixels.subarray((sourceY * 12 + sourceX) * 4, (sourceY * 12 + sourceX) * 4 + 4),
          (y * 12 + x) * 4)
      }
    }
    global.wx = createCanvasRuntime({ width: 12, height: 12, imageData: { data: rotatedPixels } })
    const rotatedAnalysis = Object.assign({}, guidedAnalysis, { rotation: 90,
      perspective: { topLeft: [1, 0], topRight: [1, 1], bottomLeft: [0, 0], bottomRight: [0, 1] } })
    const rotated = await aiGuidedImageToPattern('fixture.png', palette, rotatedAnalysis)
    assert.deepStrictEqual(rotated.matrix, guidedCodes, 'AI-guided 90-degree rotation must preserve colour order')

    global.wx = {}
    convertPage.setData({ imagePath: 'fixture.png', recognitionProgress: 0 })
    convertPage.requestAiAnalysis = async () => ({ result: guidedAnalysis })
    convertPage.processAiGuidedImage = async (path, analysis, onProgress) => {
      assert.strictEqual(path, 'fixture.png')
      assert.strictEqual(analysis, guidedAnalysis)
      await onProgress(64, '逐格采样')
      assert.strictEqual(convertPage.data.recognitionProgress, 64)
      return Object.assign({}, result, { validation: { ok: false, warnings: ['Missing guides'] } })
    }
    await convertPage.runAiRecognition()
    assert.strictEqual(convertPage.data.recognitionProgress, 100)
    assert.strictEqual(convertPage.data.recognitionSource, 'AI')
    assert.strictEqual(convertPage.data.recognitionResult.exactRecognition, false)
    assert.strictEqual(convertPage.data.recognitionResult.needsReview, true)
    convertPage.aiAnalysisCache = null
    convertPage.setData({ recognitionProgress: 0 })
    convertPage.processAiGuidedImage = async () => {
      const error = new Error('AI dimensions disagree')
      error.code = 'AI_GRID_MISMATCH'
      throw error
    }
    convertPage.processCurrentImage = async (onProgress) => {
      await onProgress(50, '本地校验中')
      assert.ok(convertPage.data.recognitionProgress >= 60, 'AI-to-local fallback must not reset progress')
      return Object.assign({}, result, { validation: { ok: true, warnings: [] } })
    }
    await convertPage.runAiRecognition()
    assert.strictEqual(convertPage.data.recognitionProgress, 100)
    assert.strictEqual(convertPage.data.recognitionSource, '本地')
    assert.strictEqual(convertPage.data.recognitionResult.needsReview, true)
    assert.match(convertPage.data.recognitionResult.warning, /AI 行列估算与本地网格检测不一致/)
    convertPage.aiAnalysisCache = null
    convertPage.setData({ recognitionProgress: 0 })
    convertPage.requestAiAnalysis = async () => ({ result: { imageType: 'photo', hasGrid: false, confidence: 0.88 } })
    convertPage.processAiPhotoImage = async () => Object.assign({}, result)
    await convertPage.runAiRecognition()
    assert.strictEqual(convertPage.data.recognitionResult.recognitionMode, 'ai-photo')
    assert.strictEqual(convertPage.data.recognitionResult.needsCalibration, true)
    assert.strictEqual(convertPage.data.recognitionResult.exactRecognition, false)
    convertPage.requestAiAnalysis = async () => { throw new Error('AI offline') }
    convertPage.aiAnalysisCache = null
    convertPage.setData({ recognitionProgress: 0 })
    await convertPage.runAiRecognition()
    assert.strictEqual(convertPage.data.recognitionProgress, 0)
    assert.strictEqual(convertPage.data.recognitionError, 'AI offline')
    convertPage.processCurrentImage = async () => result
    await convertPage.runLocalRecognition()
    assert.strictEqual(convertPage.data.recognitionSource, '本地')
    assert.strictEqual(convertPage.data.recognitionProgress, 100)
    console.log('Recognition runtime passed: native pixels, guided AI grid/MARD, explicit local fallback, noisy-image UI yields and progress.')
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

module.exports = { run }
