const assert = require('assert')
const fs = require('fs')
const path = require('path')
const palette = require('../miniprogram/data/colors/mard')
const { rgbToLab, deltaE2000 } = require('../miniprogram/utils/lab')
const { preparePalette, findNearestColor, cleanupMatrix, shouldTreatAsBlank, matchImageData, mergeSimilarColors } = require('../miniprogram/utils/color-match')
const { calculatePatternDimensions, recommendPatternSize, normalizeTransform } = require('../miniprogram/utils/image')
const { buildPageRanges } = require('../miniprogram/utils/export')
const {
  detectGuideGridGeometry,
  detectGenericGridGeometry,
  recognizeGuideGrid,
  recognizeGenericGrid,
  recognizePixelGrid,
  nativePixelLikelihood,
  prepareRecognitionPalette,
  classifySampleRows
} = require('../miniprogram/utils/grid-recognition')
const { extractUrls, unwrapImageUrl, selectBestUrl, extractHtmlImageUrls, validateDownload } = require('../miniprogram/utils/link')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  getSystemInfoSync() { return { windowWidth: 375, windowHeight: 720, pixelRatio: 2 } },
  showToast() {},
  showModal() {},
  showActionSheet() {},
  showLoading() {},
  hideLoading() {},
  navigateTo() {},
  navigateBack() {},
  stopPullDownRefresh() {}
}

const patternUtils = require('../miniprogram/utils/pattern')
const inventoryUtils = require('../miniprogram/utils/inventory')
const activityUtils = require('../miniprogram/utils/activity')

const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'))
const inventoryStyles = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/inventory/inventory.wxss'), 'utf8')
const patternStyles = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/patterns/patterns.wxss'), 'utf8')
const patternMarkup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/patterns/patterns.wxml'), 'utf8')
assert.strictEqual(appConfig.resizable, true, 'iPad must be allowed to resize into the full available window')
assert.strictEqual(appConfig.window.pageOrientation, 'auto', 'tablet preview must follow device orientation')
assert.match(inventoryStyles, /@media \(min-width: 900px\)[\s\S]*repeat\(6/)
assert.match(patternStyles, /\.selection-bar \{ left: 184px;/)
assert.ok(patternMarkup.indexOf('class="upload-button"') < patternMarkup.indexOf('class="summary-card"'), 'upload button must be in the top toolbar')
assert.match(patternStyles, /\.library-toolbar\s*\{[^}]*position:\s*absolute;[^}]*top:[^}]*right:/, 'upload button must sit at the mobile top right')
assert.doesNotMatch(patternStyles, /\.upload-button\s*\{[^}]*position:\s*fixed/, 'upload button must not cover pattern cards')

function approximately(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' is not within ' + tolerance + ' of ' + expected)
}

assert.strictEqual(palette.length, 221)
assert.deepStrictEqual([...new Set(palette.map((item) => item.series))], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M'])
assert.strictEqual(palette.some((item) => /^[PQRTYZ]/.test(item.code)), false)
const white = rgbToLab([255, 255, 255])
approximately(white[0], 100, 0.02)
approximately(white[1], 0, 0.03)
approximately(white[2], 0, 0.03)
assert.strictEqual(deltaE2000(white, white), 0)

const prepared = preparePalette(palette)
assert.strictEqual(findNearestColor([24, 135, 162], prepared).code, 'C19')
assert.strictEqual(findNearestColor([231, 0, 47], prepared).code, 'F5')
assert.deepStrictEqual(calculatePatternDimensions(800, 400, 48, 'ratio'), { width: 96, height: 48 })
assert.deepStrictEqual(calculatePatternDimensions(800, 400, 48, 'cover'), { width: 48, height: 48 })
assert.strictEqual(recommendPatternSize(1400, 900), 48)
assert.strictEqual(shouldTreatAsBlank(250, 249, 251, 255, { removeBackground: true, whiteThreshold: 245 }), true)
assert.strictEqual(shouldTreatAsBlank(250, 180, 180, 255, { removeBackground: true, whiteThreshold: 245 }), false)
assert.strictEqual(shouldTreatAsBlank(20, 20, 20, 0, {}), true)
assert.deepStrictEqual(normalizeTransform({ scale: 10, offsetX: -4, rotation: 90, mirrored: true }), {
  scale: 4, offsetX: -4, offsetY: 0, rotation: 90, mirrored: true
})
const recognitionPalette = prepareRecognitionPalette(palette)
assert.strictEqual(findNearestColor([210, 176, 180], recognitionPalette).code, 'E21')
assert.strictEqual(findNearestColor([240, 240, 240], recognitionPalette).code, 'H17')
assert.strictEqual(findNearestColor([255, 255, 255], recognitionPalette).code, 'H2')
assert.strictEqual(findNearestColor([219, 179, 136], recognitionPalette).code, 'G9')

function syntheticGuideChart() {
  const columns = 22
  const rows = 22
  const cell = 10
  const x0 = 20
  const y0 = 20
  const width = 250
  const height = 260
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255
    data[offset + 1] = 255
    data[offset + 2] = 255
    data[offset + 3] = 255
  }
  const fillRect = (left, top, right, bottom, rgb) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4
        data[offset] = rgb[0]
        data[offset + 1] = rgb[1]
        data[offset + 2] = rgb[2]
      }
    }
  }
  const chartColors = [[210, 176, 180], [240, 240, 240], [71, 69, 76]]
  for (let index = 0; index < 60; index += 1) {
    const x = index % columns
    const y = Math.floor(index / columns)
    const rgb = chartColors[index % chartColors.length]
    fillRect(x0 + x * cell + 1, y0 + y * cell + 1, x0 + (x + 1) * cell, y0 + (y + 1) * cell, rgb)
    const ink = Math.max.apply(null, rgb) < 130 ? [255, 255, 255] : [45, 45, 45]
    fillRect(x0 + x * cell + 4, y0 + y * cell + 4, x0 + x * cell + 6, y0 + y * cell + 7, ink)
  }
  for (let x = 0; x < columns; x += 1) {
    fillRect(x0 + x * cell + 4, y0 + rows * cell + 3, x0 + x * cell + 7, y0 + rows * cell + 7, [40, 40, 40])
  }
  for (let index = 1; index <= 21; index += 5) {
    fillRect(x0 + index * cell, 0, x0 + index * cell + 1, height, [230, 35, 35])
    fillRect(0, y0 + index * cell, width, y0 + index * cell + 1, [230, 35, 35])
  }
  return { imageData: { data }, width, height }
}

const guideFixture = syntheticGuideChart()
const guideGeometry = detectGuideGridGeometry(guideFixture.imageData, guideFixture.width, guideFixture.height)
assert.strictEqual(guideGeometry.ok, true)
assert.strictEqual(guideGeometry.columns, 22)
assert.strictEqual(guideGeometry.rows, 22)
const guideResult = recognizeGuideGrid(guideFixture.imageData, guideFixture.width, guideFixture.height, palette)
assert.strictEqual(guideResult.ok, true)
assert.strictEqual(guideResult.width, 22)
assert.strictEqual(guideResult.height, 22)
assert.strictEqual(guideResult.beadCount, 60)
assert.strictEqual(guideResult.usedColorCount, 3)

function syntheticLargeGuideChart() {
  const columns = 99
  const rows = 106
  const beadCount = 6813
  const cell = 10
  const x0 = 20
  const y0 = 20
  const width = x0 * 2 + columns * cell
  const height = y0 * 2 + rows * cell
  const data = new Uint8ClampedArray(width * height * 4)
  const fillRect = (left, top, right, bottom, rgb) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4
        data[offset] = rgb[0]
        data[offset + 1] = rgb[1]
        data[offset + 2] = rgb[2]
        data[offset + 3] = 255
      }
    }
  }
  fillRect(0, 0, width, height, [255, 255, 255])
  const chartColors = palette.slice(0, 15).map((item) => item.rgb)
  for (let index = 0; index < beadCount; index += 1) {
    const column = index % columns
    const row = Math.floor(index / columns)
    const rgb = chartColors[index % chartColors.length]
    fillRect(x0 + column * cell + 1, y0 + row * cell + 1, x0 + (column + 1) * cell, y0 + (row + 1) * cell, rgb)
    const ink = Math.max.apply(null, rgb) < 130 ? [255, 255, 255] : [35, 35, 35]
    fillRect(x0 + column * cell + 4, y0 + row * cell + 4, x0 + column * cell + 6, y0 + row * cell + 7, ink)
  }
  for (let row = 0; row < rows; row += 1) {
    fillRect(x0 + columns * cell + 4, y0 + row * cell + 4, x0 + columns * cell + 6, y0 + row * cell + 7, [35, 35, 35])
  }
  for (let column = 0; column < columns; column += 1) {
    fillRect(x0 + column * cell + 4, y0 + rows * cell + 4, x0 + column * cell + 6, y0 + rows * cell + 7, [35, 35, 35])
  }
  for (let index = 1; index < columns; index += 5) {
    fillRect(x0 + index * cell, 0, x0 + index * cell + 1, height, [230, 35, 35])
  }
  for (let index = 1; index < rows; index += 5) {
    fillRect(0, y0 + index * cell, width, y0 + index * cell + 1, [230, 35, 35])
  }
  return { imageData: { data }, width, height }
}

const largeGuideFixture = syntheticLargeGuideChart()
const largeGuideGeometry = detectGuideGridGeometry(largeGuideFixture.imageData, largeGuideFixture.width, largeGuideFixture.height)
assert.strictEqual(largeGuideGeometry.ok, true, JSON.stringify(largeGuideGeometry))
assert.strictEqual(largeGuideGeometry.columns, 99)
assert.strictEqual(largeGuideGeometry.rows, 106)
const largeGuideResult = recognizeGuideGrid(largeGuideFixture.imageData, largeGuideFixture.width, largeGuideFixture.height, palette)
assert.strictEqual(largeGuideResult.width, 99)
assert.strictEqual(largeGuideResult.height, 106)
assert.strictEqual(largeGuideResult.beadCount, 6813)
assert.strictEqual(largeGuideResult.usedColorCount, 15)

function syntheticGridChart(options) {
  const settings = Object.assign({ columns: 12, rows: 10, cell: 12, x0: 14, y0: 16, gridLines: true }, options || {})
  const width = settings.x0 * 2 + settings.columns * settings.cell + (settings.gridLines ? 1 : 0)
  const height = settings.y0 * 2 + settings.rows * settings.cell + (settings.gridLines ? 1 : 0)
  const data = new Uint8ClampedArray(width * height * 4)
  const setPixel = (x, y, rgb) => {
    const offset = (y * width + x) * 4
    data[offset] = rgb[0]
    data[offset + 1] = rgb[1]
    data[offset + 2] = rgb[2]
    data[offset + 3] = 255
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) setPixel(x, y, [250, 250, 250])
  }
  const colors = [[213, 79, 91], [57, 146, 193], [238, 182, 67], [88, 171, 119]]
  for (let row = 0; row < settings.rows; row += 1) {
    for (let column = 0; column < settings.columns; column += 1) {
      const rgb = colors[(row + column) % colors.length]
      const inset = settings.gridLines ? 1 : 0
      for (let y = settings.y0 + row * settings.cell + inset; y < settings.y0 + (row + 1) * settings.cell; y += 1) {
        for (let x = settings.x0 + column * settings.cell + inset; x < settings.x0 + (column + 1) * settings.cell; x += 1) setPixel(x, y, rgb)
      }
    }
  }
  if (settings.gridLines) {
    for (let column = 0; column <= settings.columns; column += 1) {
      const x = settings.x0 + column * settings.cell
      for (let y = settings.y0; y <= settings.y0 + settings.rows * settings.cell; y += 1) setPixel(x, y, [92, 92, 92])
    }
    for (let row = 0; row <= settings.rows; row += 1) {
      const y = settings.y0 + row * settings.cell
      for (let x = settings.x0; x <= settings.x0 + settings.columns * settings.cell; x += 1) setPixel(x, y, [92, 92, 92])
    }
  }
  return { imageData: { data }, width, height, settings }
}

const regularFixture = syntheticGridChart()
assert.strictEqual(detectGuideGridGeometry(regularFixture.imageData, regularFixture.width, regularFixture.height).ok, false)
const regularResult = recognizeGenericGrid(regularFixture.imageData, regularFixture.width, regularFixture.height, palette)
assert.strictEqual(regularResult.ok, true, JSON.stringify(regularResult))
assert.strictEqual(regularResult.width, regularFixture.settings.columns)
assert.strictEqual(regularResult.height, regularFixture.settings.rows)
assert.strictEqual(regularResult.beadCount, regularFixture.settings.columns * regularFixture.settings.rows)
assert.strictEqual(regularResult.recognitionMode, 'regular-grid')

function cropFixture(source, left, top, width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = ((top + y) * source.width + left + x) * 4
      data.set(source.imageData.data.subarray(from, from + 4), (y * width + x) * 4)
    }
  }
  return { imageData: { data }, width, height }
}

const edgeSource = syntheticGridChart({ columns: 30, rows: 30, cell: 10, x0: 0, y0: 0 })
const edgeCropped = cropFixture(edgeSource, 3, 0, edgeSource.width - 7, edgeSource.height - 4)
const edgeGeometry = detectGenericGridGeometry(edgeCropped.imageData, edgeCropped.width, edgeCropped.height)
assert.strictEqual(edgeGeometry.ok, true, JSON.stringify(edgeGeometry))
assert.deepStrictEqual([edgeGeometry.columns, edgeGeometry.rows], [30, 30],
  'a screenshot cropped through its outside cells must retain the complete grid dimensions')
assert.deepStrictEqual(edgeGeometry.clippedEdges, { left: true, right: true, top: true, bottom: true })

const pixelFixture = syntheticGridChart({ columns: 14, rows: 11, cell: 7, x0: 0, y0: 0, gridLines: false })
const pixelResult = recognizePixelGrid(pixelFixture.imageData, pixelFixture.width, pixelFixture.height, palette)
assert.strictEqual(pixelResult.ok, true, JSON.stringify(pixelResult))
assert.strictEqual(pixelResult.width, pixelFixture.settings.columns)
assert.strictEqual(pixelResult.height, pixelFixture.settings.rows)
assert.strictEqual(pixelResult.recognitionMode, 'pixel-grid')
assert.strictEqual(nativePixelLikelihood(pixelFixture.imageData, pixelFixture.width, pixelFixture.height).ok, true)

const largeChartColors = palette.slice(0, 15).map((item) => item.rgb)
const largeChartSamples = Array.from({ length: 106 }, (_, row) => Array.from({ length: 99 }, (_, column) => ({
  rgb: largeChartColors[(row + column) % largeChartColors.length],
  inkRatio: 0.08,
  lightInkRatio: 0.08,
  whiteRatio: 0,
  sampleCount: 64
})))
const largeChartStartedAt = Date.now()
const largeChartResult = classifySampleRows(largeChartSamples, palette, {}, { recognitionMode: 'guide-grid', confidence: 0.95 })
const largeChartElapsed = Date.now() - largeChartStartedAt
assert.strictEqual(largeChartResult.width, 99)
assert.strictEqual(largeChartResult.height, 106)
assert.strictEqual(largeChartResult.beadCount, 99 * 106)
assert.strictEqual(largeChartResult.usedColorCount, 15)
assert.strictEqual(largeChartResult.uniqueSampleColorCount, 15, 'repeated chart colours must be matched only once')
assert.ok(largeChartElapsed < 2500, '99x106 colour matching took ' + largeChartElapsed + 'ms')

const shareText = '复制这段内容打开图纸：https://cdn.example.com/charts/demo.png，提取色号。'
assert.deepStrictEqual(extractUrls(shareText), ['https://cdn.example.com/charts/demo.png'])
assert.strictEqual(
  unwrapImageUrl('https://example.com/proxy?url=https%3A%2F%2Fcdn.example.com%2Foriginal.jpg'),
  'https://cdn.example.com/original.jpg'
)
assert.strictEqual(selectBestUrl('page https://example.com/post/1 image https://cdn.example.com/a.webp'), 'https://cdn.example.com/a.webp')
assert.deepStrictEqual(
  extractHtmlImageUrls('<meta property="og:image" content="/images/chart.png"><img data-src="thumb.jpg">', 'https://example.com/posts/1'),
  ['https://example.com/images/chart.png', 'https://example.com/posts/thumb.jpg']
)
assert.strictEqual(validateDownload({ statusCode: 200, tempFilePath: 'tmp', header: { 'Content-Type': 'image/png' } }).ok, true)
assert.strictEqual(validateDownload({ statusCode: 200, tempFilePath: 'tmp', header: { 'Content-Type': 'text/html' } }).reason, 'not-image-response')
const blankResult = matchImageData({ data: new Uint8ClampedArray([
  255, 255, 255, 255,
  61, 175, 128, 255
]) }, 2, 1, palette, { removeBackground: true, whiteThreshold: 245 })
assert.strictEqual(blankResult.matrix[0][0], '')
assert.ok(blankResult.matrix[0][1])
assert.deepStrictEqual(cleanupMatrix([
  ['B7', 'B7', 'B7'],
  ['B7', 'F5', 'B7'],
  ['B7', 'B7', 'B7']
], 1), [
  ['B7', 'B7', 'B7'],
  ['B7', 'B7', 'B7'],
  ['B7', 'B7', 'B7']
])

const pattern = patternUtils.createPattern({
  id: 'unit-pattern',
  name: '单测图纸',
  matrix: [['B7', 'F5'], ['B7', 'H2']],
  tags: ['测试']
})
assert.strictEqual(pattern.width, 2)
assert.strictEqual(pattern.height, 2)
assert.strictEqual(pattern.status, '待拼')
const saved = patternUtils.savePattern(pattern, palette)
assert.strictEqual(patternUtils.getPatternById(saved.id).name, '单测图纸')
assert.strictEqual(patternUtils.getPatternByShareCode(patternUtils.makeShareCode(saved)).id, saved.id)
assert.deepStrictEqual(patternUtils.mirrorHorizontal([['B7', 'F5']]), [['F5', 'B7']])
assert.deepStrictEqual(patternUtils.rotate90([['B7', 'F5'], ['H2', 'C19']]), [['H2', 'B7'], ['C19', 'F5']])
assert.deepStrictEqual(patternUtils.indicesForRow([['B7', ''], ['F5', 'H2']], 0), [0])
assert.deepStrictEqual(patternUtils.indicesForRect([['B7', ''], ['F5', 'H2']], { x: 0, y: 0 }, { x: 1, y: 1 }), [0, 2, 3])
assert.deepStrictEqual(patternUtils.toggleProgressIndices([0], [0, 2]), [0, 2])
assert.deepStrictEqual(patternUtils.toggleProgressIndices([0, 2], [0, 2]), [])
assert.deepStrictEqual(patternUtils.calculateProgress([['B7', ''], ['B7', 'F5']], [0, 2]), {
  total: 3, completed: 2, percent: 67, completedCodes: ['B7']
})
assert.deepStrictEqual(patternUtils.replaceColorInRect([['B7', 'B7'], ['B7', 'B7']], { x: 0, y: 0 }, { x: 0, y: 1 }, 'B7', 'F5'), [['F5', 'B7'], ['F5', 'B7']])

const mergedColors = mergeSimilarColors([['X', 'Y', 'Y']], [
  { code: 'X', rgb: [100, 100, 100] },
  { code: 'Y', rgb: [101, 101, 101] }
], 2, [])
assert.deepStrictEqual(mergedColors.matrix, [['Y', 'Y', 'Y']])
assert.deepStrictEqual(buildPageRanges(128, 70, 60), [
  { x: 0, y: 0, width: 60, height: 60 },
  { x: 60, y: 0, width: 60, height: 60 },
  { x: 120, y: 0, width: 8, height: 60 },
  { x: 0, y: 60, width: 60, height: 10 },
  { x: 60, y: 60, width: 60, height: 10 },
  { x: 120, y: 60, width: 8, height: 10 }
])

inventoryUtils.setStock('B7', 10)
assert.strictEqual(inventoryUtils.adjustStock('B7', -3), 7)
const merged = inventoryUtils.mergeStatsWithInventory([{ code: 'B7', required: 9 }])
assert.strictEqual(merged[0].stock, 7)
assert.strictEqual(merged[0].missing, 2)
assert.strictEqual(inventoryUtils.canConsumeStats([{ code: 'B7', required: 8 }]).ok, false)
assert.deepStrictEqual(inventoryUtils.summarizeTransaction({ type: 'batch', items: [{ code: 'A1', delta: 50 }] }), {
  direction: 'in', typeLabel: '入库', inbound: 50, outbound: 0, amountLabel: '+50'
})
assert.deepStrictEqual(inventoryUtils.summarizeTransaction({ type: 'consume', items: [{ code: 'A1', delta: -20 }] }), {
  direction: 'out', typeLabel: '作品出库', inbound: 0, outbound: 20, amountLabel: '-20'
})
assert.deepStrictEqual(inventoryUtils.summarizeTransaction({ type: 'batch', items: [{ code: 'A1', delta: 50 }, { code: 'B7', delta: -20 }] }), {
  direction: 'adjust', typeLabel: '库存调整', inbound: 50, outbound: 20, amountLabel: '+50 / -20'
})
activityUtils.recordActivity('bead-session', { patternId: 'unit-pattern', patternName: '单测图纸', durationMs: 65000 })
assert.strictEqual(activityUtils.formatDuration(65000), '1分05秒')
assert.deepStrictEqual(activityUtils.summarizeActivities(activityUtils.getActivities()), {
  count: 1, sessionCount: 1, durationMs: 65000
})
inventoryUtils.setStock('B7', 12)
assert.strictEqual(inventoryUtils.consumeStats([{ code: 'B7', required: 8 }]).ok, true)
assert.strictEqual(inventoryUtils.getInventory().B7, 4)
inventoryUtils.setStock('F5', 20)
const consumedOnce = inventoryUtils.consumeStats([{ code: 'F5', required: 5 }], { patternId: 'dedupe-pattern', patternName: '防重复' })
assert.strictEqual(consumedOnce.ok, true)
assert.strictEqual(inventoryUtils.consumeStats([{ code: 'F5', required: 5 }], { patternId: 'dedupe-pattern' }).duplicate, true)
assert.strictEqual(inventoryUtils.getInventory().F5, 15)
assert.strictEqual(inventoryUtils.undoTransaction(consumedOnce.transactionId).ok, true)
assert.strictEqual(inventoryUtils.getInventory().F5, 20)
assert.strictEqual(inventoryUtils.consumeStats([{ code: 'F5', required: 5 }], { patternId: 'dedupe-pattern' }).ok, true)
assert.deepStrictEqual(inventoryUtils.parseInventoryCsv('\uFEFF色号,入库数量\nA1,500\nA1,200\nB7,-20\n无效,10'), [
  { brand: 'MARD', code: 'A1', delta: 700 },
  { brand: 'MARD', code: 'B7', delta: -20 }
])
inventoryUtils.setStock('A1', 300)
const refill = inventoryUtils.buildRefillList([{ code: 'A1', required: 450, hex: '#fff' }], 'MARD', 1000, 500)
assert.strictEqual(refill[0].afterUse, -150)
assert.strictEqual(refill[0].refill, 1500)
patternUtils.savePattern(patternUtils.createPattern({ id: 'delete-a', name: '删除A', matrix: [['A1']] }), palette)
patternUtils.savePattern(patternUtils.createPattern({ id: 'delete-b', name: '删除B', matrix: [['A2']] }), palette)
patternUtils.deletePatterns(['delete-a', 'delete-b'])
assert.strictEqual(patternUtils.getPatternById('delete-a'), null)
assert.strictEqual(patternUtils.getPatternById('delete-b'), null)

let beadGridDefinition
global.Component = (definition) => { beadGridDefinition = definition }
require('../miniprogram/components/bead-grid/bead-grid')
delete global.Component
const zoomObserverKey = Object.keys(beadGridDefinition.observers).find((key) => key.split(',').indexOf('zoom') >= 0)
const viewportObserverKey = Object.keys(beadGridDefinition.observers).find((key) => key.split(',').indexOf('scrollLeft') >= 0)
assert.ok(zoomObserverKey)
assert.ok(viewportObserverKey)
assert.strictEqual(Object.keys(beadGridDefinition.observers).find((key) => key.indexOf('matrix') >= 0).indexOf('zoom'), -1)
const zoomEvents = []
const beadGrid = Object.assign({
  data: { compact: false, locked: false, zoom: 2, maxZoom: 6, scrollLeft: 0, scrollTop: 0, controlledScale: 2, controlledX: 0, controlledY: 0 },
  triggerEvent(name, detail) { zoomEvents.push({ name, detail }) },
  setData(next, callback) {
    this.data = Object.assign({}, this.data, next)
    if (callback) callback()
  }
}, beadGridDefinition.methods)
beadGrid.handleNativeTouchStart({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] })
beadGrid.handleNativeScale({ detail: { scale: 3 } })
assert.strictEqual(zoomEvents.length, 0)
beadGrid.handleNativeScale({ detail: { scale: 8 } })
beadGrid.handleNativeChange({ detail: { x: -120, y: -80, source: 'touch' } })
beadGrid.handleNativeTouchEnd()
assert.deepStrictEqual(zoomEvents[0], { name: 'zoomchange', detail: { zoom: 6 } })
assert.deepStrictEqual(zoomEvents[1], { name: 'viewchange', detail: { scrollLeft: 120, scrollTop: 80 } })
assert.strictEqual(beadGrid._pinching, false)
beadGrid.data.zoom = 6
beadGridDefinition.observers[zoomObserverKey].call(beadGrid, 6, 6)
assert.strictEqual(beadGrid.data.controlledScale, 2, 'native pinch result must not be written back into movable-view')
beadGridDefinition.observers[zoomObserverKey].call(beadGrid, 4, 6)
assert.strictEqual(beadGrid.data.controlledScale, 4, 'toolbar zoom must still control movable-view')
beadGrid.data.scrollLeft = 120
beadGrid.data.scrollTop = 80
beadGridDefinition.observers[viewportObserverKey].call(beadGrid, 120, 80)
assert.strictEqual(beadGrid.data.controlledX, 0, 'native pan result must not be written back into movable-view')
beadGridDefinition.observers[viewportObserverKey].call(beadGrid, 40, 20)
assert.strictEqual(beadGrid.data.controlledX, -40)
assert.strictEqual(beadGrid.data.controlledY, -20)

function loadPage(relativePath) {
  let definition
  global.Page = (value) => { definition = value }
  const absolutePath = require.resolve(relativePath)
  delete require.cache[absolutePath]
  require(absolutePath)
  delete global.Page
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(next, callback) {
      this.data = Object.assign({}, this.data, next)
      if (callback) callback()
    }
  })
}

const patternPage = loadPage('../miniprogram/pages/pattern/pattern')
patternPage.onLoad({ id: 'unit-pattern' })
patternPage.onShow()
assert.strictEqual(patternPage.data.pattern.id, 'unit-pattern')
patternPage.setData({ working: true, progressTool: 'cell' })
patternPage.handleCellTap({ detail: { x: 0, y: 0, code: 'B7' } })
assert.deepStrictEqual(patternPage.data.completedIndices, [0])
assert.strictEqual(patternPage.data.progress, 25)

const editorPage = loadPage('../miniprogram/pages/editor/editor')
editorPage.onLoad({ id: 'unit-pattern' })
assert.strictEqual(editorPage.data.showCodes, true)
assert.strictEqual(editorPage.data.candidates.length, 6)

const inventoryPage = loadPage('../miniprogram/pages/inventory/inventory')
inventoryPage.onShow()
assert.strictEqual(inventoryPage.data.colorCount, 221)
assert.ok(Array.isArray(inventoryPage.data.transactions))

const convertPage = loadPage('../miniprogram/pages/convert/convert')
const convertMarkup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/convert/convert.wxml'), 'utf8')
const convertStyles = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/convert/convert.wxss'), 'utf8')
assert.match(convertMarkup, /recognition-preview \{\{!recognitionResult && recognitionCropEnabled \? 'cropped-source'/,
  'recognition progress must preview the confirmed crop instead of the uncropped source')
assert.match(convertMarkup, /mode="\{\{recognitionCropEnabled \? 'scaleToFill' : 'aspectFit'\}\}" style="\{\{recognitionCropEnabled \? recognitionCropImageStyle/,
  'recognition progress must use the exact same transform as the crop confirmation screen')
assert.match(convertMarkup, /bindtap="chooseOriginalFile"/,
  'dense charts must offer uncompressed chat-file import instead of relying on album previews')
assert.match(convertMarkup, /recognitionPreviewMode === 'source'/,
  'recognition results must let the user compare the screen preview with the selected source file')
assert.match(convertMarkup, /grid-match-overlay/,
  'grid recognition must visibly overlay the detected rows and columns before sampling colours')
assert.match(convertMarkup, /confirmGridAndRecognize/,
  'colour recognition must wait for explicit grid confirmation')
assert.match(convertMarkup, /changeGridDimensionInput/,
  'grid row and column counts must support direct numeric editing')
assert.match(convertMarkup, /changeGridEdge/,
  'grid boundaries must provide continuous slider adjustment')
assert.match(convertStyles, /\.classify-crop-frame\s*\{[^}]*inset:\s*0;/,
  'the visible crop frame must match the full exported square without a hidden inset')
assert.strictEqual(convertPage.processAiPhotoImage.toString().includes('removeBackground: false'), true,
  'photo conversion must keep every output cell, including white and pale cells')
convertPage.setData({ cropX: 75, cropY: -75, cropScale: 2, cropRotation: 90, cropMirrored: true })
assert.deepStrictEqual(convertPage.processingOptions().transform, {
  offsetX: 75 / 158, offsetY: -75 / 158, scale: 2, rotation: 90, mirrored: true
})
convertPage.setData({ stage: 'classify', imageInfo: { width: 1080, height: 2340 } })
convertPage.toggleRecognitionCrop()
assert.strictEqual(convertPage.data.recognitionCropEnabled, true)
assert.strictEqual(convertPage.data.cropMode, 'cover')
assert.deepStrictEqual([convertPage.data.outputWidth, convertPage.data.outputHeight],
  [convertPage.data.selectedSize, convertPage.data.selectedSize])
convertPage.updateCropTransform({ cropX: 200, cropY: 999 })
assert.strictEqual(convertPage.data.cropX, 0, 'an unzoomed portrait crop must not slide beyond its horizontal edge')
assert.ok(convertPage.data.cropY > 150, 'a long portrait crop must reach farther than the old fixed drag limit')
const dragStartY = convertPage.data.cropY
convertPage.cropTouchStart({ touches: [{ clientX: 120, clientY: 160 }] })
convertPage.cropTouchMove({ touches: [{ clientX: 120, clientY: 120 }] })
convertPage.cropTouchEnd()
assert.ok(convertPage.data.cropY < dragStartY, 'one-finger movement must reposition the image inside the crop frame')
convertPage.cropTouchStart({ touches: [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }] })
convertPage.cropTouchMove({ touches: [{ clientX: 75, clientY: 100 }, { clientX: 225, clientY: 100 }] })
convertPage.cropTouchEnd()
assert.ok(convertPage.data.cropScale > 1, 'two-finger pinch must resize the image inside the crop frame')
convertPage.changeCropZoom({ detail: { value: 100 } })
assert.strictEqual(convertPage.data.cropScale, 2)
convertPage.nudgeCrop({ currentTarget: { dataset: { x: 1, y: 0 } } })
assert.ok(convertPage.data.cropX > 0)
convertPage.toggleRecognitionCrop()
assert.strictEqual(convertPage.data.recognitionCropEnabled, false)
assert.strictEqual(convertPage.data.cropMode, 'ratio')
global.wx.getImageInfo = ({ success }) => success({ path: 'long.jpg', width: 1080, height: 2340 })
convertPage.setData({ stage: 'classify', selectedMethod: 'recognize', cropMode: 'ratio', recognitionCropEnabled: false })
convertPage.updateRecommendedSize('long.jpg')
assert.strictEqual(convertPage.data.recognitionCropEnabled, true, 'long photos must open directly in manual crop mode')
assert.strictEqual(convertPage.data.cropMode, 'cover')
convertPage.setData({ cropX: 48, cropY: -96, cropScale: 1.8, recognitionProgress: 100 })
convertPage.restartCropFromOriginal()
assert.deepStrictEqual([convertPage.data.cropX, convertPage.data.cropY, convertPage.data.cropScale], [0, 0, 1],
  'restoring the original must clear the previous crop transform')
assert.strictEqual(convertPage.data.stage, 'classify')
assert.strictEqual(convertPage.data.recognitionCropEnabled, true)

let originalFileRequest
let acceptedOriginalPath = ''
global.wx.chooseMessageFile = (options) => {
  originalFileRequest = options
  options.success({ tempFiles: [{ path: 'uncompressed-original.png' }] })
}
const previousAcceptImagePath = convertPage.acceptImagePath
convertPage.acceptImagePath = (path) => { acceptedOriginalPath = path }
convertPage.chooseOriginalFile()
convertPage.acceptImagePath = previousAcceptImagePath
assert.deepStrictEqual(originalFileRequest.extension, ['jpg', 'jpeg', 'png', 'webp'])
assert.strictEqual(acceptedOriginalPath, 'uncompressed-original.png')

delete global.wx
require('./recognition-runtime-test').run({ guideFixture: largeGuideFixture, edgeFixture: edgeCropped, convertPage }).then(() => {
  console.log('All unit tests passed: large-grid recognition/performance, link extraction, blank detection, crop, palette merge, export paging, progress, inventory transactions and pinch zoom.')
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
