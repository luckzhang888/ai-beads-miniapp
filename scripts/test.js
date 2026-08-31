const assert = require('assert')
const fs = require('fs')
const path = require('path')
const palette = require('../miniprogram/data/colors/mard')
const { rgbToLab, deltaE2000 } = require('../miniprogram/utils/lab')
const { preparePalette, findNearestColor, cleanupMatrix, shouldTreatAsBlank, matchImageData, mergeSimilarColors } = require('../miniprogram/utils/color-match')
const { calculatePatternDimensions, recommendPatternSize, normalizeTransform } = require('../miniprogram/utils/image')
const { buildPageRanges } = require('../miniprogram/utils/export')
const { recognizeGuideGrid, prepareRecognitionPalette } = require('../miniprogram/utils/grid-recognition')

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
assert.strictEqual(appConfig.resizable, true, 'iPad must be allowed to resize into the full available window')
assert.strictEqual(appConfig.window.pageOrientation, 'auto', 'tablet preview must follow device orientation')
assert.match(inventoryStyles, /@media \(min-width: 900px\)[\s\S]*repeat\(6/)
assert.match(patternStyles, /\.selection-bar \{ left: 184px;/)

function approximately(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' is not within ' + tolerance + ' of ' + expected)
}

assert.strictEqual(palette.length, 295)
assert.deepStrictEqual(
  ['P', 'Q', 'R', 'T', 'Y', 'Z'].map((series) => palette.filter((item) => item.code[0] === series).length),
  [23, 5, 28, 1, 9, 8]
)
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
assert.strictEqual(recommendPatternSize(1400, 900), 80)
assert.strictEqual(shouldTreatAsBlank(250, 249, 251, 255, { removeBackground: true, whiteThreshold: 245 }), true)
assert.strictEqual(shouldTreatAsBlank(250, 180, 180, 255, { removeBackground: true, whiteThreshold: 245 }), false)
assert.strictEqual(shouldTreatAsBlank(20, 20, 20, 0, {}), true)
assert.deepStrictEqual(normalizeTransform({ scale: 10, offsetX: -4, rotation: 90, mirrored: true }), {
  scale: 4, offsetX: -1, offsetY: 0, rotation: 90, mirrored: true
})
const recognitionPalette = prepareRecognitionPalette(palette)
assert.strictEqual(findNearestColor([210, 176, 180], recognitionPalette).code, 'E21')
assert.strictEqual(findNearestColor([240, 240, 240], recognitionPalette).code, 'H17')

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
const guideResult = recognizeGuideGrid(guideFixture.imageData, guideFixture.width, guideFixture.height, palette)
assert.strictEqual(guideResult.ok, true)
assert.strictEqual(guideResult.width, 22)
assert.strictEqual(guideResult.height, 22)
assert.strictEqual(guideResult.beadCount, 60)
assert.strictEqual(guideResult.usedColorCount, 3)
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
assert.strictEqual(inventoryPage.data.colorCount, 295)
assert.ok(Array.isArray(inventoryPage.data.transactions))

const convertPage = loadPage('../miniprogram/pages/convert/convert')
convertPage.setData({ cropX: 75, cropY: -75, cropScale: 2, cropRotation: 90, cropMirrored: true })
assert.deepStrictEqual(convertPage.processingOptions().transform, {
  offsetX: 0.5, offsetY: -0.5, scale: 2, rotation: 90, mirrored: true
})

delete global.wx
console.log('All unit tests passed: blank detection, crop, palette merge, export paging, progress, inventory transactions and pinch zoom.')
