const assert = require('assert')

async function main() {
  const storage = new Map()
  const modalLog = []
  global.wx = {
    env: { USER_DATA_PATH: 'tmp' },
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getSystemInfoSync() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 3 } },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    stopPullDownRefresh() {},
    navigateTo() {},
    navigateBack() {},
    redirectTo() {},
    setClipboardData() {},
    showModal(options) {
      modalLog.push(options.title)
      if (options.success) options.success({ confirm: true, content: options.content || '' })
    },
    showActionSheet(options) {
      if (options.success) options.success({ tapIndex: 0 })
    }
  }

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

  const palette = require('../miniprogram/data/colors/mard')
  const patternUtils = require('../miniprogram/utils/pattern')
  const inventoryUtils = require('../miniprogram/utils/inventory')

  const library = loadPage('../miniprogram/pages/patterns/patterns')
  library.onShow()
  assert.strictEqual(library.data.patterns.length, 2)
  const firstId = library.data.patterns[0].id
  library.enterSelection({ currentTarget: { dataset: { id: firstId } } })
  assert.strictEqual(library.data.selectedCount, 1)
  library.moveSelected()
  assert.strictEqual(patternUtils.getPatternById(firstId).folderId, 'original')
  library.enterSelection({ currentTarget: { dataset: { id: firstId } } })
  library.selectAllVisible()
  assert.strictEqual(library.data.selectedCount, 2)
  library.bulkDelete()
  assert.strictEqual(patternUtils.getSavedPatterns().length, 0)
  assert.ok(modalLog.some((title) => title.indexOf('删除 2 张') === 0))

  const p1 = patternUtils.savePattern(patternUtils.createPattern({ id: 'ux-1', name: '体验图一', matrix: [['A1', 'A2'], ['A1', 'B7']] }), palette)
  const p2 = patternUtils.savePattern(patternUtils.createPattern({ id: 'ux-2', name: '体验图二', matrix: [['A1', 'C19']] }), palette)
  assert.ok(p1 && p2)

  const inventory = loadPage('../miniprogram/pages/inventory/inventory')
  inventory.onShow()
  inventory.openStockEntry({ currentTarget: { dataset: { tab: 'batch', direction: 1 } } })
  inventory.setData({ entryScope: 'ALL', entryAmount: 500, entryDirection: 1 })
  inventory.confirmStockEntry()
  const stocked = inventoryUtils.getInventory('MARD')
  assert.strictEqual(Object.keys(stocked).length, 221)
  assert.ok(palette.every((item) => stocked[item.code] === 500))
  const transaction = inventoryUtils.getTransactions()[0]
  assert.strictEqual(transaction.items.length, 221)
  assert.strictEqual(inventoryUtils.undoTransaction(transaction.id).ok, true)
  assert.ok(palette.every((item) => inventoryUtils.getInventory('MARD')[item.code] === 0))

  inventory.openConsumptionCalculator()
  inventory.selectAllConsumption()
  assert.strictEqual(inventory.data.selectedConsumptionIds.length, 2)
  inventory.calculateConsumption()
  assert.strictEqual(inventory.data.showShortageSheet, true)
  assert.ok(inventory.data.shortageRows.length >= 3)

  let beadGridDefinition
  global.Component = (definition) => { beadGridDefinition = definition }
  const componentPath = require.resolve('../miniprogram/components/bead-grid/bead-grid')
  delete require.cache[componentPath]
  require(componentPath)
  delete global.Component
  const zoomEvents = []
  let setDataCount = 0
  const grid = Object.assign({
    data: { compact: false, locked: false, zoom: 2, maxZoom: 6 },
    triggerEvent(name, detail) { zoomEvents.push({ name, detail }) },
    setData(next, callback) {
      setDataCount += 1
      this.data = Object.assign({}, this.data, next)
      if (callback) callback()
    }
  }, beadGridDefinition.methods)
  grid.handleTouchStart({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] })
  for (let index = 0; index < 100; index += 1) {
    grid.handleTouchMove({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 101 + index * 2, clientY: 0 }] })
  }
  assert.strictEqual(zoomEvents.length, 0)
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.ok(setDataCount <= 2, 'pinch preview should coalesce UI updates')
  grid.handleTouchEnd({ touches: [] })
  assert.strictEqual(zoomEvents.length, 1)
  assert.strictEqual(zoomEvents[0].detail.zoom, 6)

  delete global.wx
  console.log('UX regression passed: bulk move/delete, all-221 stock adjustment + undo, multi-pattern consumption, and 100-event pinch coalescing.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
