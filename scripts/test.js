const assert = require('assert')
const palette = require('../miniprogram/data/colors/mard')
const { rgbToLab, deltaE2000 } = require('../miniprogram/utils/lab')
const { preparePalette, findNearestColor, cleanupMatrix } = require('../miniprogram/utils/color-match')
const { calculatePatternDimensions, recommendPatternSize } = require('../miniprogram/utils/image')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}

const patternUtils = require('../miniprogram/utils/pattern')
const inventoryUtils = require('../miniprogram/utils/inventory')

function approximately(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' is not within ' + tolerance + ' of ' + expected)
}

assert.strictEqual(palette.length, 221)
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

inventoryUtils.setStock('B7', 10)
assert.strictEqual(inventoryUtils.adjustStock('B7', -3), 7)
const merged = inventoryUtils.mergeStatsWithInventory([{ code: 'B7', required: 9 }])
assert.strictEqual(merged[0].stock, 7)
assert.strictEqual(merged[0].missing, 2)
assert.strictEqual(inventoryUtils.canConsumeStats([{ code: 'B7', required: 8 }]).ok, false)
inventoryUtils.setStock('B7', 12)
assert.strictEqual(inventoryUtils.consumeStats([{ code: 'B7', required: 8 }]).ok, true)
assert.strictEqual(inventoryUtils.getInventory().B7, 4)

delete global.wx
console.log('All unit tests passed: palette, color matching, image sizing, pattern persistence and inventory.')
