const assert = require('assert')
const fs = require('fs')
const path = require('path')

function applyDataUpdate(data, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
  let target = data
  for (let index = 0; index < parts.length - 1; index += 1) {
    target = target[parts[index]]
  }
  target[parts[parts.length - 1]] = value
}

async function main() {
  const storage = new Map()
  const modalLog = []
  const modalDetails = []
  const toastLog = []
  const navigationLog = []
  let actionSheetTapIndex = 0
  let storageFailure = () => false
  const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  global.wx = {
    env: { USER_DATA_PATH: 'tmp' },
    getStorageSync(key) { return copy(storage.get(key)) },
    setStorageSync(key, value) {
      if (storageFailure(key, value)) throw new Error('setStorageSync:fail injected quota error')
      storage.set(key, copy(value))
    },
    removeStorageSync(key) { storage.delete(key) },
    getSystemInfoSync() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 3 } },
    showToast(options) { toastLog.push(options.title) },
    showLoading() {},
    hideLoading() {},
    stopPullDownRefresh() {},
    navigateTo(options) { navigationLog.push(options.url) },
    navigateBack() {},
    redirectTo(options) { navigationLog.push(options.url) },
    setClipboardData() {},
    showModal(options) {
      assert.ok(!options.confirmText || Array.from(options.confirmText).length <= 4, 'showModal confirmText must not exceed 4 characters')
      modalLog.push(options.title)
      modalDetails.push(options)
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
        Object.keys(next).forEach((key) => applyDataUpdate(this.data, key, next[key]))
        if (callback) callback()
      }
    })
  }

  const palette = require('../miniprogram/data/colors/mard')
  const patternUtils = require('../miniprogram/utils/pattern')
  const inventoryUtils = require('../miniprogram/utils/inventory')
  const activityUtils = require('../miniprogram/utils/activity')

  const library = loadPage('../miniprogram/pages/patterns/patterns')
  library.onShow()
  assert.strictEqual(library.data.patterns.length, 2)
  assert.strictEqual(library.data.stats.total, 2)
  assert.strictEqual(library.data.stats.folders, 2)
  assert.strictEqual(library.moveFolderTo('favorites', 0), true)
  assert.deepStrictEqual(storage.get('aiDoucangFolders:v1').map((item) => item.id), ['favorites', 'original'])
  library.moveFolderStep({ currentTarget: { dataset: { folderId: 'favorites', delta: 1 } } })
  assert.deepStrictEqual(storage.get('aiDoucangFolders:v1').map((item) => item.id), ['original', 'favorites'])
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
  library.refresh()
  library.inboundSelectedPatterns([p1])
  const patternInbound = inventoryUtils.getTransactions()[0]
  assert.strictEqual(patternInbound.metadata.source, 'pattern-management-inbound')
  assert.strictEqual(inventoryUtils.getInventory('MARD').A1, 2)
  library.outboundSelectedPatterns([p1])
  assert.strictEqual(patternUtils.getPatternById(p1.id).inventoryConsumed, true)
  assert.strictEqual(inventoryUtils.getInventory('MARD').A1, 0)
  library.undoSelectedOutbound([patternUtils.getPatternById(p1.id)])
  assert.strictEqual(patternUtils.getPatternById(p1.id).inventoryConsumed, false)
  assert.strictEqual(inventoryUtils.getInventory('MARD').A1, 2)
  assert.strictEqual(inventoryUtils.undoTransaction(patternInbound.id).ok, true)
  actionSheetTapIndex = 2
  library.refresh()
  library.enterSelection({ currentTarget: { dataset: { id: p2.id } } })
  library.setSelectedStatus()
  assert.strictEqual(patternUtils.getPatternById(p2.id).status, '已拼')
  actionSheetTapIndex = 0

  const inventory = loadPage('../miniprogram/pages/inventory/inventory')
  inventory.onShow()
  inventory.openAiEntry()
  assert.strictEqual(navigationLog[navigationLog.length - 1], '/pages/convert/convert?mode=recognize')
  inventory.openStockEntry({ currentTarget: { dataset: { tab: 'batch', direction: 1 } } })
  assert.strictEqual(inventory.data.batchRows.length, 295)
  inventory.selectBatchSeries({ currentTarget: { dataset: { series: 'A' } } })
  assert.strictEqual(inventory.data.batchRows.length, 26)
  assert.ok(inventory.data.batchRows.every((item) => item.series === 'A'))
  inventory.selectBatchSeries({ currentTarget: { dataset: { series: 'P' } } })
  assert.strictEqual(inventory.data.batchRows.length, 23)
  assert.ok(inventory.data.batchRows.every((item) => item.series === 'P'))
  inventory.selectBatchSeries({ currentTarget: { dataset: { series: 'ALL' } } })
  assert.strictEqual(inventory.data.batchRows.length, 295)
  const inventoryTemplate = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/inventory/inventory.wxml'), 'utf8')
  assert.ok(inventoryTemplate.includes('data-series="{{item.code}}"'))
  assert.ok(inventoryTemplate.includes('{{item.label}}'))
  const batchUpdates = []
  const updateInventoryData = inventory.setData.bind(inventory)
  inventory.setData = (next, callback) => {
    batchUpdates.push(next)
    updateInventoryData(next, callback)
  }
  inventory.inputBatchAmount({ currentTarget: { dataset: { code: 'A1', index: 0 } }, detail: { value: '500' } })
  const inputUpdate = batchUpdates[batchUpdates.length - 1]
  assert.strictEqual(Object.prototype.hasOwnProperty.call(inputUpdate, 'batchRows'), false)
  assert.strictEqual(inputUpdate['batchRows[0].amount'], '500')
  inventory.quickBatchAmount({ currentTarget: { dataset: { code: 'A2', index: 1, amount: '1000' } } })
  assert.strictEqual(inventory.data.batchSelectedCount, 2)
  assert.strictEqual(inventory.data.batchTotalAmount, 1500)
  inventory.confirmStockEntry()
  assert.strictEqual(inventoryUtils.getInventory('MARD').A1, 500)
  assert.strictEqual(inventoryUtils.getInventory('MARD').A2, 1000)
  const batchTransaction = inventoryUtils.getTransactions()[0]
  assert.strictEqual(batchTransaction.items.length, 2)
  assert.strictEqual(inventoryUtils.undoTransaction(batchTransaction.id).ok, true)

  inventory.openStockEntry({ currentTarget: { dataset: { tab: 'package', direction: 1 } } })
  assert.strictEqual(inventory.data.packageOptions.find((item) => item.count === 295).unavailable, false)
  inventory.selectPackage({ currentTarget: { dataset: { count: 295 } } })
  assert.strictEqual(inventory.data.selectedPackage, 295)
  inventory.setData({ selectedPackage: 295, packageAmount: 500, entryDirection: 1 })
  inventory.confirmStockEntry()
  const stocked = inventoryUtils.getInventory('MARD')
  assert.strictEqual(Object.keys(stocked).length, 295)
  assert.ok(palette.every((item) => stocked[item.code] === 500))
  const transaction = inventoryUtils.getTransactions()[0]
  assert.strictEqual(transaction.items.length, 295)
  assert.strictEqual(inventoryUtils.undoTransaction(transaction.id).ok, true)
  assert.ok(palette.every((item) => inventoryUtils.getInventory('MARD')[item.code] === 0))

  inventory.openConsumptionCalculator()
  inventory.selectAllConsumption()
  assert.strictEqual(inventory.data.selectedConsumptionIds.length, 2)
  inventory.calculateConsumption()
  assert.strictEqual(inventory.data.showShortageSheet, true)
  assert.ok(inventory.data.shortageRows.length >= 3)

  activityUtils.recordActivity('bead-session', { patternId: p1.id, patternName: p1.name, durationMs: 125000, title: '拼豆计时' })
  activityUtils.recordActivity('pattern-progress', { patternId: p1.id, patternName: p1.name, title: '更新拼豆进度', description: '完成度 25%' })
  const records = loadPage('../miniprogram/pages/records/records')
  records.onShow()
  assert.ok(records.data.recordCount >= 2)
  records.selectFilter({ currentTarget: { dataset: { value: 'in' } } })
  assert.ok(records.data.visibleRecords.every((item) => item.direction === 'in'))
  records.selectFilter({ currentTarget: { dataset: { value: 'timer' } } })
  assert.strictEqual(records.data.visibleRecords.length, 1)
  assert.strictEqual(records.data.visibleRecords[0].durationLabel, '2分05秒')

  let beadGridDefinition
  global.Component = (definition) => { beadGridDefinition = definition }
  const componentPath = require.resolve('../miniprogram/components/bead-grid/bead-grid')
  delete require.cache[componentPath]
  require(componentPath)
  delete global.Component
  const zoomEvents = []
  let nativeSetDataCount = 0
  const grid = Object.assign({
    data: { compact: false, locked: false, zoom: 2, maxZoom: 6, scrollLeft: 0, scrollTop: 0, controlledScale: 2, controlledX: 0, controlledY: 0 },
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

  // Storage failures must leave pages usable and must never show save success.
  const originalError = console.error
  let expectedErrors = 0
  try {
    console.error = () => { expectedErrors += 1 }
    const failPatternWrites = (key) => key.startsWith('savedPatternRecord:v2:') || key === 'savedPatternIndex:v2'
    const editor = loadPage('../miniprogram/pages/editor/editor')
    editor.onLoad({ id: p1.id })
    editor.setData({ matrix: [['F5', 'A1'], ['A1', 'B7']], dirty: true })
    const originalDrawing = patternUtils.getPatternById(p1.id)
    storageFailure = failPatternWrites
    const beforeToast = toastLog.length
    assert.strictEqual(editor.persist(true), null)
    assert.strictEqual(editor.data.dirty, true)
    assert.strictEqual(editor.data.matrix[0][0], 'F5', 'failed save retains edits in the open editor')
    assert.deepStrictEqual(patternUtils.getPatternById(p1.id), originalDrawing)
    assert.strictEqual(toastLog.length, beforeToast)
    assert.strictEqual(modalLog[modalLog.length - 1], '图纸存储失败')
    storageFailure = () => false
    assert.ok(editor.persist(true))
    assert.strictEqual(editor.data.dirty, false)
    assert.strictEqual(patternUtils.getPatternById(p1.id).matrix[0][0], 'F5')

    const workspace = loadPage('../miniprogram/pages/pattern/pattern')
    workspace.onLoad({ id: p1.id })
    workspace.onShow()
    workspace.setData({ highlightCode: 'A1', working: true })
    storageFailure = failPatternWrites
    workspace.progressUndoStack = Array.from({ length: 20 }, () => [0])
    const undoBefore = copy(workspace.progressUndoStack)
    const progressBefore = copy(workspace.data.completedIndices)
    assert.strictEqual(workspace.applyProgressTargets([0]), false)
    assert.deepStrictEqual(workspace.progressUndoStack, undoBefore)
    workspace.undoProgress()
    assert.deepStrictEqual(workspace.progressUndoStack, undoBefore)
    workspace.completeSelectedColor()
    assert.deepStrictEqual(workspace.data.completedIndices, progressBefore)
    assert.strictEqual(workspace.data.working, true)
    assert.notStrictEqual(toastLog[toastLog.length - 1], '该色格子已完成')
    const beforeGestureDialogs = modalLog.length
    workspace.persistViewState()
    await new Promise((resolve) => setTimeout(resolve, 220))
    workspace.persistViewState()
    await new Promise((resolve) => setTimeout(resolve, 220))
    assert.strictEqual(modalLog.length, beforeGestureDialogs + 1, 'repeated failed view saves show only one warning')

    library.refresh()
    library.enterSelection({ currentTarget: { dataset: { id: p1.id } } })
    library.selectAllVisible()
    const statusesBefore = patternUtils.getSavedPatterns().map((item) => item.status)
    actionSheetTapIndex = 3
    library.setSelectedStatus()
    assert.deepStrictEqual(patternUtils.getSavedPatterns().map((item) => item.status), statusesBefore)
    assert.strictEqual(library.data.selectionMode, true)
    assert.strictEqual(library.data.selectedCount, 2)

    const importer = loadPage('../miniprogram/pages/convert/convert')
    const result = { matrix: [['A1', 'F5']], width: 2, height: 1, stats: [], usedColorCount: 2, beadCount: 2 }
    importer.setData({ recognitionResult: result })
    const countBeforeImport = patternUtils.getSavedPatterns().length
    const navBeforeImport = navigationLog.length
    importer.saveRecognitionResult({ currentTarget: { dataset: { target: 'detail' } } })
    assert.strictEqual(importer.data.recognitionSaving, false)
    assert.strictEqual(importer.data.recognitionResult, result, 'failed import remains available for retry')
    assert.strictEqual(patternUtils.getSavedPatterns().length, countBeforeImport)
    assert.strictEqual(navigationLog.length, navBeforeImport)

    importer.getImageInfo = async () => ({ width: 2, height: 1 })
    let processed = 0
    importer.processCurrentImage = async () => { processed += 1; return result }
    storageFailure = (key) => key.startsWith('savedPatternRecord:v2:') && processed >= 2
    await importer.processBatchImages(['first.png', 'second.png', 'third.png'])
    assert.strictEqual(processed, 2, 'batch must stop on storage failure instead of continuing to fail')
    assert.strictEqual(patternUtils.getSavedPatterns().length, countBeforeImport + 1)
    assert.strictEqual(importer.data.batchImporting, false)
    assert.ok(modalDetails[modalDetails.length - 1].content.includes('已保存 1/3 张'))
    assert.strictEqual(navigationLog.length, navBeforeImport)

    // A secondary activity write failure is not an import failure.
    storageFailure = (key) => key === 'beadActivities:v1'
    importer.saveRecognitionResult({ currentTarget: { dataset: { target: 'detail' } } })
    assert.strictEqual(patternUtils.getSavedPatterns().length, countBeforeImport + 2)
    assert.strictEqual(navigationLog.length, navBeforeImport + 1)
    assert.strictEqual(modalLog[modalLog.length - 1], '图纸已保存')
    assert.ok(expectedErrors >= 8)
  } finally {
    console.error = originalError
    storageFailure = () => false
  }

  delete global.wx
  console.log('UX regression passed: folders, bulk actions, 295-color series, stock + undo, consumption, native 100-event pinch, and storage-failure feedback/retry in editor, progress and imports.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
