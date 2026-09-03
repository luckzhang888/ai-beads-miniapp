const assert = require('assert')
const INDEX_KEY = 'savedPatternIndex:v2'
const RECORD_PREFIX = 'savedPatternRecord:v2:'
const LEGACY_KEY = 'savedPatterns:v1'
const CURRENT_KEY = 'currentPattern:v1'
const storage = new Map()
let failWrite = () => false
let failRemove = () => false
let writeCount = 0
let keyLimit = Infinity
let totalLimit = Infinity
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const bytes = (value) => Buffer.byteLength(JSON.stringify(value))
const snapshot = () => clone(Array.from(storage.entries()).sort(([a], [b]) => a.localeCompare(b)))
const recordKeys = () => Array.from(storage.keys()).filter((key) => key.startsWith(RECORD_PREFIX))

global.wx = {
  getStorageSync(key) { return clone(storage.get(key)) },
  setStorageSync(key, value) {
    writeCount += 1
    const total = Array.from(storage.entries()).reduce((sum, [storedKey, data]) => sum + (storedKey === key ? 0 : bytes(data)), 0)
    if (failWrite(key, value, writeCount) || bytes(value) > keyLimit || total + bytes(value) > totalLimit) {
      throw new Error('setStorageSync:fail quota exceeded (injected)')
    }
    storage.set(key, clone(value))
  },
  removeStorageSync(key) {
    if (failRemove(key)) throw new Error('removeStorageSync:fail (injected)')
    storage.delete(key)
  },
  getStorageInfoSync() { return { keys: Array.from(storage.keys()) } },
  showModal() {}
}

function reload() {
  delete require.cache[require.resolve('../miniprogram/utils/pattern')]
  delete require.cache[require.resolve('../miniprogram/utils/pattern-storage')]
  return require('../miniprogram/utils/pattern')
}

let patterns = reload()
function reset() {
  storage.clear()
  failWrite = () => false
  failRemove = () => false
  keyLimit = Infinity
  totalLimit = Infinity
  writeCount = 0
  patterns = reload()
}

function drawing(id, size = 2) {
  return Object.assign(patterns.createPattern({
    id, name: '图纸 ' + id, tags: ['原图'],
    matrix: Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x + y) % 3 ? 'A1' : 'B7')),
    completedCellIndices: [0], viewState: { zoom: 3, scrollLeft: 20 },
    inventoryConsumed: true, lastConsumeTransactionId: 'stock-original'
  }), { folderId: 'keep-folder', sourceUrl: 'https://example.com/original.png' })
}

function expectFailure(fn) {
  assert.throws(fn, (error) => error.code === 'PATTERN_STORAGE_ERROR' && error.message.includes('不要清空小程序数据'))
}

// Upgrading a real v1 list must preserve every field of all 50 legacy drawings.
const legacy = Array.from({ length: 50 }, (_, index) => drawing('legacy-' + index, 16))
storage.set(LEGACY_KEY, clone(legacy))
storage.set(CURRENT_KEY, clone(legacy[7]))
const beforeRead = snapshot()
assert.deepStrictEqual(patterns.getSavedPatterns(), legacy)
assert.deepStrictEqual(snapshot(), beforeRead, 'reads must not migrate or clean up data')
const fiftyFirst = patterns.savePattern(drawing('number-51'))
assert.strictEqual(patterns.getSavedPatterns().length, 51)
legacy.forEach((item) => assert.deepStrictEqual(patterns.getPatternById(item.id), item))
assert.deepStrictEqual(patterns.getCurrentPattern(), fiftyFirst)
assert.ok(!storage.has(LEGACY_KEY) && !storage.has(CURRENT_KEY))
patterns = reload()
assert.strictEqual(patterns.getSavedPatterns().length, 51, 'data survives an app restart')

// Inject a failure at EVERY write of the migration (51 records + one index).
for (let failedStep = 1; failedStep <= 52; failedStep += 1) {
  reset()
  storage.set(LEGACY_KEY, clone(legacy))
  storage.set(CURRENT_KEY, clone(legacy[7]))
  const before = snapshot()
  failWrite = (key, value, count) => count === failedStep
  expectFailure(() => patterns.savePattern(drawing('migration-failure')))
  assert.deepStrictEqual(snapshot(), before, 'migration failure at write ' + failedStep + ' must retain v1 exactly')
  patterns = reload()
  assert.deepStrictEqual(patterns.getSavedPatterns(), legacy)
  assert.deepStrictEqual(patterns.getCurrentPattern(), legacy[7])
}

// More than 50 nontrivial drawings, with a simulated 1 MiB per-key limit.
reset()
keyLimit = 1024 * 1024
totalLimit = 10 * 1024 * 1024
for (let index = 0; index < 120; index += 1) patterns.savePattern(drawing('large-' + index, 64))
assert.strictEqual(patterns.getSavedPatterns().length, 120)
assert.strictEqual(recordKeys().length, 120)
assert.ok(bytes(patterns.getSavedPatterns()) > keyLimit, 'fixture must exceed the old aggregate-key limit')
assert.ok(Array.from(storage.values()).every((value) => bytes(value) < keyLimit))
assert.strictEqual(patterns.getPatternById('large-0').matrix.length, 64)
const unchangedKey = storage.get(INDEX_KEY).entries.find((entry) => entry.id === 'large-10').key
const oldest = patterns.getPatternById('large-0')
const updated = patterns.savePattern(Object.assign({}, oldest, { name: '更新最旧图纸' }))
assert.strictEqual(patterns.getSavedPatterns().length, 120)
assert.strictEqual(patterns.getSavedPatterns()[0].name, '更新最旧图纸')
assert.strictEqual(storage.get(INDEX_KEY).entries.find((entry) => entry.id === 'large-10').key, unchangedKey)
assert.strictEqual(recordKeys().length, 120, 'superseded records must be reclaimed')
assert.deepStrictEqual(patterns.getCurrentPattern(), updated)
const writesBeforeSelection = writeCount
patterns.setCurrentPattern(updated)
assert.strictEqual(writeCount, writesBeforeSelection, 'selecting the saved current drawing must not write again')
patterns.setCurrentPattern(patterns.getPatternById('large-8'))
patterns = reload()
assert.strictEqual(patterns.getCurrentPattern().id, 'large-8')

// Existing edits and new saves are atomic at both record and index failures.
for (const failIndex of [false, true]) {
  for (const candidate of [drawing('new-failure'), Object.assign({}, updated, { name: 'must-not-replace-old' })]) {
    const before = snapshot()
    failWrite = (key) => failIndex ? key === INDEX_KEY : key.startsWith(RECORD_PREFIX)
    expectFailure(() => patterns.savePattern(candidate))
    assert.deepStrictEqual(snapshot(), before)
    assert.strictEqual(patterns.getCurrentPattern().id, 'large-8')
  }
}
failWrite = () => false
totalLimit = 1 // Fully exhausted storage, not merely the per-key limit.
const fullBefore = snapshot()
expectFailure(() => patterns.savePattern(drawing('no-capacity')))
assert.deepStrictEqual(snapshot(), fullBefore)
totalLimit = Infinity

// Folder moves and bulk status changes commit all drawings together.
reset()
patterns.savePatterns([drawing('batch-a'), drawing('batch-b')])
const batchBefore = snapshot()
writeCount = 0
failWrite = (key, value, count) => count === 2
expectFailure(() => patterns.movePatternsFromFolder('keep-folder', ''))
assert.deepStrictEqual(snapshot(), batchBefore)
writeCount = 0
expectFailure(() => patterns.savePatterns(patterns.getSavedPatterns().map((item) => Object.assign({}, item, { status: '已拼' }))))
assert.deepStrictEqual(snapshot(), batchBefore)
failWrite = () => false
assert.strictEqual(patterns.movePatternsFromFolder('keep-folder', '').updated, 2)
assert.ok(patterns.getSavedPatterns().every((item) => item.folderId === ''))
assert.strictEqual(patterns.getCurrentPattern().folderId, '')
const renamed = patterns.renamePattern('batch-a', '已改名')
assert.strictEqual(renamed.name, '已改名')
const duplicate = patterns.duplicatePattern('batch-a')
assert.notStrictEqual(duplicate.id, renamed.id)
assert.strictEqual(patterns.getSavedPatterns().length, 3)
assert.strictEqual(duplicate.inventoryConsumed, false)

// Deletion writes a smaller index before removing records, including current.
const beforeDelete = snapshot()
failWrite = (key) => key === INDEX_KEY
expectFailure(() => patterns.deletePattern(duplicate.id))
assert.deepStrictEqual(snapshot(), beforeDelete)
failWrite = () => false
patterns.deletePattern(duplicate.id)
assert.strictEqual(patterns.getCurrentPattern(), null)
assert.strictEqual(recordKeys().length, 2)
patterns.deletePatterns(['batch-a', 'batch-b'])
assert.deepStrictEqual(patterns.getSavedPatterns(), [])
assert.strictEqual(recordKeys().length, 0)
patterns = reload()
assert.deepStrictEqual(patterns.getSavedPatterns(), [], 'deleting all must not revive legacy drawings')

// Full v1 users can free space without paying for a migration first.
reset()
storage.set(LEGACY_KEY, clone(legacy))
storage.set(CURRENT_KEY, clone(legacy[0]))
failWrite = (key) => key !== LEGACY_KEY
assert.strictEqual(patterns.deletePattern(legacy[0].id).length, 49)
assert.strictEqual(patterns.getCurrentPattern(), null)
assert.ok(!storage.has(INDEX_KEY))

// Post-commit cleanup failure is recoverable and is not a failed save.
reset()
patterns.savePattern(drawing('cleanup'))
const staleKey = recordKeys()[0]
const originalWarn = console.warn
try {
  console.warn = () => {}
  failRemove = (key) => key === staleKey
  patterns.savePattern(Object.assign({}, patterns.getPatternById('cleanup'), { name: '已成功保存' }))
  assert.strictEqual(patterns.getPatternById('cleanup').name, '已成功保存')
  assert.ok(storage.has(staleKey))
} finally { console.warn = originalWarn }
failRemove = () => false
storage.set(RECORD_PREFIX + 'crash-orphan', drawing('orphan'))
patterns = reload()
patterns.savePattern(drawing('after-restart'))
assert.ok(!storage.has(staleKey))
assert.ok(!storage.has(RECORD_PREFIX + 'crash-orphan'))
assert.strictEqual(patterns.getSavedPatterns().length, 2)
assert.strictEqual(recordKeys().length, 2)

// Missing/corrupt data must be surfaced, never interpreted as an empty library.
const goodIndex = clone(storage.get(INDEX_KEY))
storage.set(INDEX_KEY, { version: 2, entries: 'broken' })
expectFailure(() => patterns.getSavedPatterns())
expectFailure(() => patterns.savePattern(drawing('blocked')))
storage.set(INDEX_KEY, goodIndex)
storage.delete(goodIndex.entries[0].key)
expectFailure(() => patterns.getSavedPatterns())

reset()
storage.set(LEGACY_KEY, [drawing('repeated'), drawing('repeated')])
const invalidLegacy = snapshot()
expectFailure(() => patterns.savePattern(drawing('do-not-overwrite-corrupt-legacy')))
assert.deepStrictEqual(snapshot(), invalidLegacy)

// Unsaved current drafts remain supported across migration and restart.
reset()
const draft = drawing('draft-not-in-library')
patterns.setCurrentPattern(draft)
patterns.movePatternsFromFolder('missing-folder', '')
assert.deepStrictEqual(patterns.getCurrentPattern(), draft)
const store = require('../miniprogram/utils/pattern-storage')
store.writePatterns([drawing('saved-beside-draft')], false)
patterns = reload()
assert.deepStrictEqual(patterns.getCurrentPattern(), draft)
assert.strictEqual(patterns.getSavedPatterns().length, 1)
patterns.setCurrentPattern(null)
assert.strictEqual(patterns.getCurrentPattern(), null)

// Rapid imports in the same millisecond must not share an automatically made ID.
reset()
const realNow = Date.now
try {
  Date.now = () => 1234567890
  const a = patterns.createPattern({ matrix: [['A1']] })
  const b = patterns.createPattern({ matrix: [['A2']] })
  assert.notStrictEqual(a.id, b.id)
  patterns.savePatterns([a, b])
  assert.strictEqual(patterns.getSavedPatterns().length, 2)
} finally { Date.now = realNow }
delete global.wx
console.log('Pattern storage regression passed: 120 drawings, 52 migration failure points, atomic add/edit/bulk changes, quota errors, restart, current selection, deletion and orphan recovery.')
