const assert = require('assert')

async function main() {
  const storage = new Map()
  const modalLog = []
  let actionSheetTapIndex = 0
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
      assert.ok(!options.confirmText || Array.from(options.confirmText).length <= 4, 'showModal confirmText must not exceed 4 characters')
      modalLog.push(options.title)
      if (options.success) options.success({ confirm: true, content: options.content || '' })
    },
    showActionSheet(options) {
      if (options.success) options.success({ tapIndex: actionSheetTapIndex })
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
  library.openFolderManager()
  assert.strictEqual(library.data.showFolderManager, true)
  library.closeFolderManager()
  assert.strictEqual(library.data.showFolderManager, false)
  const firstId = library.data.patterns.find((item) => item.folderId === 'original').id
  library.deleteFolder({ currentTarget: { dataset: { folderId: 'original' } } })
  assert.strictEqual(library.data.folderOptions.some((item) => item.id === 'original'), false)
  assert.strictEqual(patternUtils.getPatternById(firstId).folderId, '')
  assert.strictEqual(storage.get('aiDoucangFolders:v1').some((item) => item.id === 'original'), false)
  actionSheetTapIndex = 1
  library.enterSelection({ currentTarget: { dataset: { id: firstId } } })
  assert.strictEqual(library.data.selectedCount, 1)
  library.moveSelected()
  assert.strictEqual(patternUtils.getPatternById(firstId).folderId, 'favorites')
  storage.set('aiDoucangFolders:v1', [{ id: 'favorites', title: '灵感图集' }, { id: 'empty', title: '空文件夹' }])
  library.refresh()
  assert.strictEqual(library.data.folders.find((item) => item.id === 'empty').cover, null)
  library.deleteFolder({ currentTarget: { dataset: { folderId: 'empty' } } })
  assert.strictEqual(library.data.folderOptions.length, 1)
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
  inventory.openStockEntry({ currentTarget: { dataset: { tab: 'package', direction: 1 } } })
  inventory.setData({ selectedPackage: 221, packageAmount: 500, entryDirection: 1 })
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
  let nativeSetDataCount = 0
  const grid = Object.assign({
    data: { compact: false, locked: false, zoom: 2, maxZoom: 6 },
    triggerEvent(name, detail) { zoomEvents.push({ name, detail }) },
    setData(next, callback) {
      nativeSetDataCount += 1
      this.data = Object.assign({}, this.data, next)
      if (callback) callback()
    }
  }, beadGridDefinition.methods)
  grid.handleNativeTouchStart({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] })
  for (let index = 0; index < 100; index += 1) {
    grid.handleNativeScale({ detail: { scale: 2 + index / 20 } })
  }
  assert.strictEqual(zoomEvents.length, 0)
  grid.handleNativeTouchEnd()
  assert.strictEqual(zoomEvents.length, 1)
  assert.strictEqual(zoomEvents[0].detail.zoom, 6)
  assert.strictEqual(nativeSetDataCount, 0)

  storage.set('aiDoucangFolders:v1', [])
  library.refresh()
  assert.strictEqual(library.data.folders.length, 0)
  library.refresh()
  assert.strictEqual(library.data.folders.length, 0)

  delete global.wx
  console.log('UX regression passed: folder lifecycle, bulk move/delete, 221-color package intake + undo, multi-pattern consumption, and native 100-event pinch.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
