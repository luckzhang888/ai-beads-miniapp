const assert = require('assert')
const palette = require('../miniprogram/data/colors/mard')
const { gridImageToPattern, aiGuidedImageToPattern, trustedDetectedCodes, trustedLegendCodeCounts } = require('../miniprogram/utils/image')
const { guidedGridDisagreesWithLocal, fitDetectedGridToDeclaredDimensions } = require('../miniprogram/utils/ai-grid')
const {
  recognizeKnownGrid,
  classifySampleRows,
  classifySampleRowsAsync,
  hasCellLabel,
  dominantCellColor
} = require('../miniprogram/utils/grid-recognition')

// Canvas test double: exercise the production async pipeline, including
// original-pixel sampling and progress, without a cloud AI service.
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
      let transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }
      const transformStack = []
      const context = {
        clearRect() { draw = null },
        save() { transformStack.push(Object.assign({}, transform)) },
        restore() { transform = transformStack.pop() || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } },
        translate(x, y) { transform.x += x; transform.y += y },
        rotate(radians) { transform.rotation += radians },
        scale(x, y) { transform.scaleX *= x; transform.scaleY *= y },
        fillRect() {},
        drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
          assert.ok(Math.abs(transform.rotation) < 0.0001, 'this test runtime only exercises non-rotated crop rendering')
          draw = {
            sx, sy, sw, sh,
            dx: transform.x + dx * transform.scaleX,
            dy: transform.y + dy * transform.scaleY,
            dw: dw * transform.scaleX,
            dh: dh * transform.scaleY
          }
        },
        getImageData(left, top, outputWidth, outputHeight) {
          assert.ok(draw, 'source image must be drawn before pixel sampling')
          assert.ok(outputWidth <= 4096, 'processor canvas must stay within the dimension limit')
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

async function run({ guideFixture, edgeFixture, convertPage }) {
  const previousWx = global.wx
  try {
    const native = recognizeKnownGrid({ data: new Uint8ClampedArray([
      231, 0, 47, 255, 24, 135, 162, 255, 0, 0, 0, 0
    ]) }, 3, 1, 3, 1, palette, { recognitionMode: 'native-pixel' })
    assert.deepStrictEqual(native.matrix, [['F5', 'C19', '']], 'one-pixel cells must retain their own colour and alpha')

    const watermarkPixels = new Uint8ClampedArray(12 * 12 * 4)
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const overlay = x === 5 || y === 6
        watermarkPixels.set((overlay ? [244, 62, 52] : [252, 252, 252]).concat([255]), (y * 12 + x) * 4)
      }
    }
    const cleanedWatermark = dominantCellColor({ data: watermarkPixels }, 12, 12, 0, 0, 12, 12)
    assert.strictEqual(cleanedWatermark.overlaySuppressed, true,
      'minority red watermark strokes must be removed before cell colour reading')
    assert.ok(Math.min.apply(null, cleanedWatermark.rgb) >= 248)
    const antialiasedWatermarkPixels = new Uint8ClampedArray(12 * 12 * 4)
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const overlay = x === 5 || y === 6
        antialiasedWatermarkPixels.set((overlay ? [245, 205, 200] : [252, 252, 252]).concat([255]),
          (y * 12 + x) * 4)
      }
    }
    const cleanedAntialiasedWatermark = dominantCellColor(
      { data: antialiasedWatermarkPixels }, 12, 12, 0, 0, 12, 12)
    assert.strictEqual(cleanedAntialiasedWatermark.overlaySuppressed, true,
      'downscaled pale-red guide fringes must be removed before label detection')
    assert.ok(Math.min.apply(null, cleanedAntialiasedWatermark.rgb) >= 248)
    assert.strictEqual(cleanedAntialiasedWatermark.neutralInkRatio, 0,
      'a red guide fringe must not become neutral label evidence')
    const realRedPixels = new Uint8ClampedArray(12 * 12 * 4)
    for (let index = 0; index < 12 * 12; index += 1) realRedPixels.set([220, 45, 55, 255], index * 4)
    const realRed = dominantCellColor({ data: realRedPixels }, 12, 12, 0, 0, 12, 12)
    assert.strictEqual(realRed.overlaySuppressed, false, 'a genuine predominantly red bead must be preserved')

    const overlayOnlySamples = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) => {
      if (row === column) {
        return {
          rgb: [252, 252, 252], inkRatio: 0.12, lightInkRatio: 0,
          neutralInkRatio: 0, whiteRatio: 0.8, overlaySuppressed: true
        }
      }
      return {
        rgb: [24, 135, 162], inkRatio: 0.08, lightInkRatio: 0,
        neutralInkRatio: 0.06, whiteRatio: 0, overlaySuppressed: false
      }
    }))
    const overlayOnlyResult = classifySampleRows(overlayOnlySamples, palette, {
      hasCellLabels: true, expectedBeadCount: 12
    })
    assert.strictEqual(overlayOnlyResult.beadCount, 12)
    assert.ok(overlayOnlyResult.matrix.every((row, index) => !row[index]),
      'overlay-only white background cells must not survive exact-count calibration')

    const codes = Array.from({ length: 5 }, (_, row) => Array(5).fill(row < 3 ? 'A1' : 'C19'))
    codes[1][1] = 'F5'
    const rareSamples = codes.map((row) => row.map((code) => ({
      rgb: palette.find((item) => item.code === code).rgb,
      inkRatio: 0.08, lightInkRatio: 0, whiteRatio: 0, sampleCount: 64
    })))
    assert.deepStrictEqual(classifySampleRows(rareSamples, palette).matrix, codes,
      'a single real bead must not be erased by neighbour smoothing')

    const background = [246, 246, 246]
    const backgroundSamples = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, column) => {
      const onRing = row >= 1 && row <= 3 && column >= 1 && column <= 3 && !(row === 2 && column === 2)
      return {
        rgb: onRing ? palette.find((item) => item.code === 'G14').rgb : background,
        inkRatio: 0, lightInkRatio: 0, whiteRatio: onRing ? 0 : 0.7, sampleCount: 64
      }
    }))
    const topologyResult = classifySampleRows(backgroundSamples, palette, { hasCellLabels: true })
    assert.strictEqual(topologyResult.blankCount, 16,
      'light background connected to the grid edge must not be counted as beads even when AI incorrectly claims labels')
    assert.ok(topologyResult.matrix[2][2],
      'an enclosed light cell must remain an intentional white bead instead of becoming a hole')
    assert.strictEqual(topologyResult.backgroundTopologyApplied, true)

    assert.equal(hasCellLabel({ rgb: [249, 165, 121], inkRatio: 0, lightInkRatio: 0.08, whiteRatio: 0 }), true,
      'light labels on mid-tone A12/A19 cells must be detected')
    assert.equal(hasCellLabel({ rgb: [222, 181, 138], inkRatio: 0.44, lightInkRatio: 0, whiteRatio: 0 }), true,
      'dense two-character labels next to compressed grid lines must not become blank cells')
    const constrained = classifySampleRows([[{
      rgb: [225, 179, 131], inkRatio: 0.08, lightInkRatio: 0, whiteRatio: 0, sampleCount: 64
    }]], palette, { hasCellLabels: true, allowedCodes: ['G9', 'A17'] })
    assert.deepStrictEqual(constrained.matrix, [['G9']], 'AI-read labels must constrain ambiguous local colour matching')

    const declaredSamples = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) => ({
      rgb: palette.find((item) => item.code === ['F5', 'C19', 'G9', 'M12'][(row + column) % 4]).rgb,
      inkRatio: 0.08 + row * 0.01, lightInkRatio: 0, whiteRatio: 0, sampleCount: 64
    })))
    const declared = classifySampleRows(declaredSamples, palette, {
      hasCellLabels: true, expectedBeadCount: 12, expectedColorCount: 2
    })
    assert.strictEqual(declared.beadCount, 12, 'an explicit title total must calibrate false occupied cells')
    assert.strictEqual(declared.usedColorCount, 2, 'an explicit title colour count must merge compression variants')
    assert.strictEqual(declared.expectedBeadCountApplied, true)
    assert.strictEqual(declared.expectedColorCountApplied, true)
    const exactCounts = classifySampleRows(declaredSamples, palette, {
      hasCellLabels: true, expectedBeadCount: 12, expectedColorCount: 2,
      expectedCodeCounts: { F5: 7, C19: 5 }
    })
    assert.deepStrictEqual(exactCounts.stats.map((item) => [item.code, item.required]), [['F5', 7], ['C19', 5]],
      'complete legend quotas must control both the allowed codes and each exact count')
    assert.strictEqual(exactCounts.expectedCodeCountsApplied, true)
    assert.strictEqual(exactCounts.chartColorCalibrationApplied, true,
      'complete legend quotas must learn colour centres from this chart instead of trusting fixed screen RGB')
    assert.ok(exactCounts.chartColorCenters.every((item) => ['F5', 'C19'].includes(item.code)))
    assert.ok(Array.isArray(exactCounts.reviewCells))
    assert.ok(Number.isInteger(exactCounts.uncertainCellCount))
    const signatureFor = (code) => Array.from({ length: 64 }, (_, index) => {
      if (code === 'H6') return index % 8 <= 2 ? 230 : 0
      return index % 8 >= 5 ? 230 : 0
    })
    const labeledCodes = Array.from({ length: 12 }, (_, index) => index % 2 ? 'H7' : 'H6')
    const ambiguousLabels = [labeledCodes.map((code, index) => ({
      rgb: index < 4 ? palette.find((item) => item.code === code).rgb : [25, 23, 25],
      inkRatio: 0.12, lightInkRatio: 0, whiteRatio: 0, sampleCount: 144,
      labelSignature: signatureFor(code)
    }))]
    const labelRefined = classifySampleRows(ambiguousLabels, palette, {
      hasCellLabels: true,
      expectedBeadCount: 12,
      expectedColorCount: 2,
      expectedCodeCounts: { H6: 6, H7: 6 }
    })
    assert.deepStrictEqual(labelRefined.matrix[0], labeledCodes,
      'enlarged per-cell label signatures must separate colour pairs that are ambiguous by RGB alone')
    assert.strictEqual(labelRefined.labelTileRefinementApplied, true)
    assert.strictEqual(labelRefined.labelTemplateCount, 2)
    assert.deepStrictEqual(trustedLegendCodeCounts({
      declaredColorCount: 2, declaredBeadCount: 12,
      legendEntries: [{ code: 'F5', count: 7 }, { code: 'C19', count: 5 }]
    }), Object.assign(Object.create(null), { F5: 7, C19: 5 }))

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

    const unreliableLegendWarning = '底部图例色号可读，格内色号因分辨率过小无法辨认；detectedCodes来自底部图例而非逐格读取'
    assert.deepStrictEqual(trustedDetectedCodes({ detectedCodes: ['B7', 'E8'], warnings: [unreliableLegendWarning] }), [],
      'AI-admitted legend guesses must not constrain the local palette')
    assert.deepStrictEqual(trustedDetectedCodes({ detectedCodes: ['B7', 'E8', 'G9'], warnings: [] }), [],
      'a partial model-read code list must never collapse a larger chart palette')
    assert.deepStrictEqual(trustedDetectedCodes({
      declaredColorCount: 3,
      legendCodes: ['B7', 'E8', 'G9'],
      legendEntries: []
    }), ['B7', 'E8', 'G9'], 'a complete magnified legend may safely constrain the palette even without counts')
    global.wx = createCanvasRuntime(guideFixture)
    const largeGuided = await aiGuidedImageToPattern('fixture.png', palette, {
      imageType: 'bead_pattern', hasGrid: true, rows: 106, columns: 99,
      confidence: 0.9, hasLabels: true, detectedCodes: ['B7', 'E8'],
      warnings: [unreliableLegendWarning], rotation: 0,
      grid: { left: 0.02, top: 0.06, right: 0.98, bottom: 0.97 },
      perspective: { topLeft: [0.02, 0.06], topRight: [0.98, 0.06], bottomLeft: [0.02, 0.97], bottomRight: [0.98, 0.97] }
    })
    assert.deepStrictEqual([largeGuided.width, largeGuided.height, largeGuided.usedColorCount, largeGuided.beadCount],
      [99, 106, 15, 6813], 'AI-guided large charts must reuse the precise red-guide detector')
    assert.strictEqual(largeGuided.localGridKind, 'guide-grid')
    assert.match(largeGuided.warning, /已改用本地色块匹配/)

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
      confidence: 0.95, hasLabels: false, detectedCodes: guidedCodes.flat(), warnings: [], grid: { left: 0, top: 0, right: 1, bottom: 1 },
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

    const whitePixels = new Uint8ClampedArray(2 * 2 * 4)
    for (let index = 0; index < 4; index += 1) whitePixels.set([255, 255, 255, 255], index * 4)
    global.wx = createCanvasRuntime({ width: 2, height: 2, imageData: { data: whitePixels } })
    convertPage.setData({ selectedSize: 48 })
    const photoPattern = await convertPage.processAiPhotoImage('fixture.png', {
      cropMode: 'ratio', optimizePreset: 'natural', qualityMode: 'full', removeBackground: true,
      transform: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, mirrored: false }
    })
    assert.deepStrictEqual([photoPattern.width, photoPattern.height, photoPattern.beadCount], [48, 48, 2304],
      'a no-grid photo must keep all cells even when the global background-removal default is enabled')

    global.wx = createCanvasRuntime(edgeFixture)
    const edgeAnalysis = {
      imageType: 'bead_pattern', hasGrid: true, rows: 30, columns: 30,
      confidence: 0.9, hasLabels: false, detectedCodes: [], warnings: [],
      grid: { left: 0.03, top: 0.03, right: 0.97, bottom: 0.97 },
      perspective: { topLeft: [0.03, 0.03], topRight: [0.97, 0.03], bottomLeft: [0.03, 0.97], bottomRight: [0.97, 0.97] }
    }
    const edgeGuided = await aiGuidedImageToPattern('fixture.png', palette, edgeAnalysis)
    assert.strictEqual(edgeGuided.localGridRefined, true,
      'matching local and AI dimensions must use the detected line pixels for precise sampling')
    assert.deepStrictEqual([edgeGuided.width, edgeGuided.height], [30, 30])

    const fitted = fitDetectedGridToDeclaredDimensions({
      ok: true, x: 20, y: 10, cellWidth: 10, cellHeight: 10, columns: 98, rows: 106
    }, {
      rows: 106, columns: 99, grid: { left: 20 / 1030, top: 10 / 1080, right: 1010 / 1030, bottom: 1070 / 1080 }
    }, 1030, 1080)
    assert.deepStrictEqual([fitted.columns, fitted.rows, fitted.detectedColumns], [99, 106, 98],
      'a detected grid area must be re-divided by the trusted title dimensions')

    const coarseAiBounds = fitDetectedGridToDeclaredDimensions({
      ok: true, x: 31.4, y: 171.4, cellWidth: 29.6, cellHeight: 29.6, columns: 78, rows: 93,
      guideColumns: 16, guideRows: 19, firstGuideX: 61, lastGuideX: 2312,
      firstGuideY: 201, lastGuideY: 2905
    }, {
      rows: 93, columns: 77, grid: { left: 0.01, top: 0.07, right: 0.99, bottom: 0.94 }
    }, 2374, 3072)
    assert.ok(Math.abs(coarseAiBounds.cellWidth - 30.0133333333) < 0.0001)
    assert.ok(Math.abs(coarseAiBounds.cellHeight - 30.0444444444) < 0.0001)
    assert.ok(Math.abs(coarseAiBounds.x - 30.9866666667) < 0.0001,
      'the first-cell boundary must be derived from the first guide and full-span pitch')
    assert.ok(Math.abs(coarseAiBounds.y - 170.9555555556) < 0.0001,
      'full-span guide regression must prevent cumulative row drift')

    global.wx = createCanvasRuntime(edgeFixture)
    const titleDimensions = Object.assign({}, edgeAnalysis, { columns: 31, dimensionSource: 'title' })
    const titleGuided = await aiGuidedImageToPattern('fixture.png', palette, titleDimensions)
    assert.deepStrictEqual([titleGuided.width, titleGuided.height], [31, 30],
      'a title-declared dimension must not be overwritten by one missing local border line')
    assert.strictEqual(titleGuided.gridAreaRepaired, true)
    assert.strictEqual(titleGuided.aiDimensionsCorrected, false)

    global.wx = createCanvasRuntime(edgeFixture)
    const fluctuatingAnalysis = Object.assign({}, edgeAnalysis, { rows: 32, columns: 31 })
    const correctedGuided = await aiGuidedImageToPattern('fixture.png', palette, fluctuatingAnalysis)
    assert.strictEqual(correctedGuided.localGridRefined, true)
    assert.strictEqual(correctedGuided.aiDimensionsCorrected, true,
      'a reliable local grid must correct small non-deterministic AI dimension errors')
    assert.deepStrictEqual([correctedGuided.width, correctedGuided.height], [30, 30])
    assert.deepStrictEqual(correctedGuided.aiOriginalDimensions, { rows: 32, columns: 31 })

    const localGrid = { ok: true, rows: 29, columns: 28, cellWidth: 40, cellHeight: 40, confidence: 0.88 }
    assert.strictEqual(guidedGridDisagreesWithLocal({ rows: 40, columns: 40, rotation: 0 }, localGrid, 1170, 1178), true)
    assert.strictEqual(guidedGridDisagreesWithLocal({
      rows: 93, columns: 77, rotation: 0, dimensionSource: 'title'
    }, localGrid, 1170, 1178), false, 'red guide lines must not override title-declared dimensions')
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
    convertPage.setData({ imagePath: 'fixture.png', recognitionProgress: 0, recognitionCropEnabled: false })
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
    convertPage.processPreparedLocalImage = async (path, options, onProgress) => {
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
    assert.strictEqual(convertPage.data.recognitionResult.recognitionMode, 'ai-no-grid')
    assert.strictEqual(convertPage.data.recognitionResult.needsCalibration, true)
    assert.strictEqual(convertPage.data.recognitionResult.exactRecognition, false)
    convertPage.editRecognitionCrop()
    assert.strictEqual(convertPage.data.stage, 'classify')
    assert.strictEqual(convertPage.data.recognitionCropEnabled, true)
    assert.strictEqual(convertPage.data.cropMode, 'cover')
    convertPage.setData({ imagePath: 'fixture.png', recognitionProgress: 0, recognitionCropEnabled: false })
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
