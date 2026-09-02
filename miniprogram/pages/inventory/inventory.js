const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const { getCurrentPattern, getSavedPatterns } = require('../../utils/pattern')
const {
  getInventory,
  setStock,
  adjustStock,
  batchAdjustStock,
  parseInventoryCsv,
  buildRefillList,
  getShortageList,
  getTransactions,
  summarizeTransaction,
  undoTransaction,
  getInventorySettings,
  saveInventorySettings
} = require('../../utils/inventory')

const SERIES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M', 'P', 'Q', 'R', 'T', 'Y', 'Z']
const SERIES_LABELS = { P: 'P（珠光）', Q: 'Q（温变）', R: 'R（果冻）', T: 'T（透明）', Y: 'Y（夜光）', Z: 'Z（光变）' }

function naturalCodeNumber(code) {
  return Number(String(code).replace(/\D/g, '')) || 0
}

Page({
  data: {
    paletteMap: createPaletteMap(mardPalette),
    query: '',
    activeSeries: 'ALL',
    seriesOptions: [{ code: 'ALL', label: '全部' }].concat(SERIES.map((code) => ({ code, label: SERIES_LABELS[code] || code }))),
    rows: [],
    groups: [],
    totalStock: 0,
    colorCount: mardPalette.length,
    lowCount: 0,
    sortMode: 'default',
    viewMode: 'series',
    expandedSeries: 'A',
    lowStock: 100,
    showLowOnly: false,
    activeBrand: 'MARD',
    brandOptions: ['MARD'],
    shortageCount: 0,
    transactions: [],
    showStockEntry: false,
    entryTab: 'batch',
    entryDirection: 1,
    batchSeries: 'ALL',
    batchRows: [],
    batchSelectedCount: 0,
    batchTotalAmount: 0,
    entryRows: [{ code: '', amount: '' }, { code: '', amount: '' }, { code: '', amount: '' }],
    csvItems: [],
    csvFileName: '',
    packageOptions: [
      { count: 24, label: '24色' },
      { count: 48, label: '48色' },
      { count: 72, label: '72色' },
      { count: 96, label: '96色' },
      { count: 120, label: '120色' },
      { count: 144, label: '144色' },
      { count: 168, label: '168色' },
      { count: 192, label: '192色' },
      { count: 216, label: '216色' },
      { count: 221, label: '221全实色' },
      { count: 295, label: '295全色', unavailable: false }
    ],
    selectedPackage: 221,
    packageAmount: 1000,
    packageReplaceExisting: false,
    showShortageSheet: false,
    shortageRows: [],
    shortagePatternName: '',
    refillTarget: 1000,
    refillUnit: 500,
    showConsumptionSheet: false,
    consumptionPatterns: [],
    selectedConsumptionIds: []
  },

  onShow() {
    this.refresh()
  },

  buildRows() {
    const inventory = getInventory(this.data.activeBrand)
    return mardPalette.map((item) => Object.assign({}, item, {
      stock: Number(inventory[item.code] || 0),
      low: Number(inventory[item.code] || 0) < this.data.lowStock
    }))
  },

  refresh() {
    const settings = getInventorySettings()
    const currentPattern = getCurrentPattern()
    const shortageCount = currentPattern
      ? getShortageList(currentPattern.stats || [], currentPattern.brand || 'MARD').length
      : 0
    const patterns = getSavedPatterns()
    const patternMap = patterns.reduce((result, item) => {
      result[item.id] = item
      return result
    }, {})
    const transactions = getTransactions().slice(0, 8).map((item) => {
      const summary = summarizeTransaction(item)
      const patternId = item.metadata && item.metadata.patternId ? item.metadata.patternId : ''
      const pattern = patternMap[patternId]
      return Object.assign({}, summary, {
        id: item.id,
        itemCount: item.items.length,
        timeLabel: new Date(item.createdAt).toLocaleString(),
        undone: item.undone,
        patternName: item.metadata && item.metadata.patternName ? item.metadata.patternName : '',
        previewMatrix: pattern ? pattern.matrix : []
      })
    })
    this.data.lowStock = Number(settings.lowStock) || 0
    this.data.activeBrand = settings.activeBrand || 'MARD'
    this.allRows = this.buildRows()
    const totalStock = this.allRows.reduce((sum, item) => sum + item.stock, 0)
    const lowCount = this.allRows.filter((item) => item.low).length
    this.setData({
      totalStock,
      colorCount: this.allRows.length,
      lowCount,
      lowStock: this.data.lowStock,
      activeBrand: this.data.activeBrand,
      shortageCount,
      transactions
    })
    this.applyFilter()
  },

  applyFilter() {
    const keyword = String(this.data.query || '').trim().toLowerCase()
    const activeSeries = this.data.activeSeries
    let rows = (this.allRows || this.buildRows()).filter((item) => {
      const seriesOk = activeSeries === 'ALL' || item.series === activeSeries
      const searchOk = !keyword || item.code.toLowerCase().indexOf(keyword) >= 0
      const lowOk = !this.data.showLowOnly || item.low
      return seriesOk && searchOk && lowOk
    })

    if (this.data.sortMode === 'asc') {
      rows = rows.slice().sort((a, b) => a.stock - b.stock || naturalCodeNumber(a.code) - naturalCodeNumber(b.code))
    } else if (this.data.sortMode === 'desc') {
      rows = rows.slice().sort((a, b) => b.stock - a.stock || naturalCodeNumber(a.code) - naturalCodeNumber(b.code))
    }

    const groups = SERIES.map((series) => {
      const items = rows.filter((item) => item.series === series)
      return {
        series,
        label: SERIES_LABELS[series] || (series + '系列'),
        items,
        colorCount: items.length,
        totalStock: items.reduce((sum, item) => sum + item.stock, 0),
        expanded: this.data.expandedSeries === series
      }
    }).filter((group) => group.colorCount > 0)

    this.setData({ rows, groups })
  },

  onSearchInput(event) {
    this.setData({ query: event.detail.value })
    this.applyFilter()
  },

  selectSeries(event) {
    const series = event.currentTarget.dataset.series
    this.setData({
      activeSeries: series,
      expandedSeries: series === 'ALL' ? this.data.expandedSeries : series
    })
    this.applyFilter()
  },

  setSort(event) {
    this.setData({ sortMode: event.currentTarget.dataset.sort })
    this.applyFilter()
  },

  setView(event) {
    this.setData({ viewMode: event.currentTarget.dataset.view })
  },

  toggleLowOnly() {
    this.setData({ showLowOnly: !this.data.showLowOnly })
    this.applyFilter()
  },

  setLowStockThreshold() {
    wx.showModal({
      title: '设置低库存阈值',
      editable: true,
      content: String(this.data.lowStock),
      placeholderText: '例如 100',
      success: (result) => {
        if (!result.confirm) return
        const lowStock = Math.max(0, Math.floor(Number(result.content) || 0))
        saveInventorySettings({ lowStock })
        this.refresh()
      }
    })
  },

  selectBrand(event) {
    const activeBrand = event.currentTarget.dataset.brand
    saveInventorySettings({ activeBrand })
    this.setData({ activeBrand }, () => this.refresh())
  },

  toggleSeries(event) {
    const series = event.currentTarget.dataset.series
    this.setData({ expandedSeries: this.data.expandedSeries === series ? '' : series })
    this.applyFilter()
  },

  adjust(event) {
    const code = event.currentTarget.dataset.code
    const delta = Number(event.currentTarget.dataset.delta)
    adjustStock(code, delta, this.data.activeBrand, { source: 'inventory-card' })
    this.refresh()
  },

  setExactStock(event) {
    const code = event.currentTarget.dataset.code
    setStock(code, event.detail.value, this.data.activeBrand, { source: 'inventory-input' })
    this.refresh()
  },

  quickTransaction(event) {
    const direction = Number(event.currentTarget.dataset.direction)
    wx.showModal({
      title: direction > 0 ? '补豆入库' : '手动出库',
      content: '输入格式：色号 数量，例如 A1 500',
      editable: true,
      placeholderText: 'A1 500',
      confirmText: '确认',
      success: (result) => {
        if (!result.confirm) return
        const parts = String(result.content || '').trim().toUpperCase().split(/\s+/)
        const code = parts[0]
        const amount = Math.max(0, Math.floor(Number(parts[1] || 0)))
        if (!code || !amount || !mardPalette.some((item) => item.code === code)) {
          wx.showToast({ title: '请输入有效色号和数量', icon: 'none' })
          return
        }
        adjustStock(code, direction * amount, this.data.activeBrand, { source: 'quick-transaction' })
        this.refresh()
        wx.showToast({ title: '库存已更新', icon: 'success' })
      }
    })
  },

  batchTransaction() {
    wx.showModal({
      title: '批量调整库存',
      content: '输入：A1 +500, B7 -20, C19 +100',
      editable: true,
      placeholderText: 'A1 +500, B7 -20',
      confirmText: '执行',
      success: (result) => {
        if (!result.confirm) return
        const items = String(result.content || '')
          .toUpperCase()
          .split(/[,，;；]+/)
          .map((part) => part.trim().split(/\s+/))
          .map((parts) => ({ code: parts[0], delta: Number(parts[1]), brand: this.data.activeBrand }))
          .filter((item) => mardPalette.some((color) => color.code === item.code) && Number.isFinite(item.delta) && item.delta !== 0)
        if (!items.length) {
          wx.showToast({ title: '没有识别到有效调整项', icon: 'none' })
          return
        }
        batchAdjustStock(items, { source: 'batch-input' })
        this.refresh()
        wx.showToast({ title: '已批量更新 ' + items.length + ' 项', icon: 'success' })
      }
    })
  },

  openStockEntry(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {}
    const direction = Number(dataset.direction)
    const entryTab = dataset.tab || 'batch'
    if (entryTab === 'batch') this._batchAmounts = {}
    this.setData({
      showStockEntry: true,
      entryTab,
      entryDirection: direction === -1 ? -1 : 1
    }, () => {
      if (entryTab === 'batch') this.refreshBatchRows()
    })
  },

  openAiEntry() {
    wx.navigateTo({ url: '/pages/convert/convert?mode=recognize' })
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/records/records' })
  },

  closeStockEntry() { this.setData({ showStockEntry: false }) },
  noop() {},

  selectEntryTab(event) {
    const entryTab = event.currentTarget.dataset.tab
    this.setData({ entryTab }, () => {
      if (entryTab === 'batch') {
        if (!this._batchAmounts) this._batchAmounts = {}
        this.refreshBatchRows()
      }
    })
  },
  selectEntryDirection(event) { this.setData({ entryDirection: Number(event.currentTarget.dataset.direction) < 0 ? -1 : 1 }) },
  refreshBatchRows() {
    const amounts = this._batchAmounts || {}
    const batchSeries = this.data.batchSeries || 'ALL'
    const batchRows = mardPalette
      .filter((item) => batchSeries === 'ALL' || item.series === batchSeries)
      .map((item) => Object.assign({}, item, { amount: amounts[item.code] ? String(amounts[item.code]) : '' }))
    const selectedCodes = Object.keys(amounts).filter((code) => Number(amounts[code]) > 0)
    const batchTotalAmount = selectedCodes.reduce((sum, code) => sum + Number(amounts[code] || 0), 0)
    this.setData({ batchRows, batchSelectedCount: selectedCodes.length, batchTotalAmount })
  },
  updateBatchAmountView(code, amount, visibleIndex) {
    const amounts = this._batchAmounts || {}
    const selectedCodes = Object.keys(amounts).filter((itemCode) => Number(amounts[itemCode]) > 0)
    const updates = {
      batchSelectedCount: selectedCodes.length,
      batchTotalAmount: selectedCodes.reduce((sum, itemCode) => sum + Number(amounts[itemCode] || 0), 0)
    }
    let index = Number(visibleIndex)
    if (!Number.isInteger(index) || !this.data.batchRows[index] || this.data.batchRows[index].code !== code) {
      index = this.data.batchRows.findIndex((item) => item.code === code)
    }
    if (index >= 0) updates['batchRows[' + index + '].amount'] = amount ? String(amount) : ''
    this.setData(updates)
  },
  selectBatchSeries(event) {
    const series = event.currentTarget.dataset.series
    const batchSeries = series === 'ALL' || SERIES.indexOf(series) >= 0 ? series : 'ALL'
    this.setData({ batchSeries }, () => this.refreshBatchRows())
  },
  inputBatchAmount(event) {
    const code = event.currentTarget.dataset.code
    const visibleIndex = event.currentTarget.dataset.index
    const amount = Math.max(0, Math.floor(Number(event.detail.value) || 0))
    if (!this._batchAmounts) this._batchAmounts = {}
    if (amount) this._batchAmounts[code] = amount
    else delete this._batchAmounts[code]
    this.updateBatchAmountView(code, amount, visibleIndex)
  },
  quickBatchAmount(event) {
    const code = event.currentTarget.dataset.code
    const visibleIndex = event.currentTarget.dataset.index
    const increment = Math.max(0, Math.floor(Number(event.currentTarget.dataset.amount) || 0))
    if (!code || !increment) return
    if (!this._batchAmounts) this._batchAmounts = {}
    this._batchAmounts[code] = Number(this._batchAmounts[code] || 0) + increment
    this.updateBatchAmountView(code, this._batchAmounts[code], visibleIndex)
  },
  clearBatchEntries() {
    this._batchAmounts = {}
    this.refreshBatchRows()
  },
  selectPackage(event) {
    const count = Number(event.currentTarget.dataset.count) || 221
    if (count > mardPalette.length) return
    this.setData({ selectedPackage: count })
  },
  inputPackageAmount(event) { this.setData({ packageAmount: Math.max(0, Math.floor(Number(event.detail.value) || 0)) }) },
  togglePackageReplace(event) { this.setData({ packageReplaceExisting: Boolean(event.detail.value) }) },

  inputEntryRow(event) {
    const index = Number(event.currentTarget.dataset.index)
    const field = event.currentTarget.dataset.field
    const rows = this.data.entryRows.slice()
    if (!rows[index]) return
    rows[index] = Object.assign({}, rows[index], { [field]: event.detail.value })
    this.setData({ entryRows: rows })
  },

  quickEntryRow(event) {
    const index = Number(event.currentTarget.dataset.index)
    const rows = this.data.entryRows.slice()
    if (!rows[index]) return
    rows[index] = Object.assign({}, rows[index], { amount: String(event.currentTarget.dataset.amount) })
    this.setData({ entryRows: rows })
  },

  addEntryRow() {
    this.setData({ entryRows: this.data.entryRows.concat({ code: '', amount: '' }) })
  },

  removeEntryRow(event) {
    const index = Number(event.currentTarget.dataset.index)
    const rows = this.data.entryRows.filter((item, rowIndex) => rowIndex !== index)
    this.setData({ entryRows: rows.length ? rows : [{ code: '', amount: '' }] })
  },

  chooseCsvFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0]
        if (!file) return
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (content) => {
            const validCodes = new Set(mardPalette.map((item) => item.code))
            const csvItems = parseInventoryCsv(content.data, this.data.activeBrand).filter((item) => validCodes.has(item.code))
            if (!csvItems.length) {
              wx.showToast({ title: '文件中没有有效 MARD 色号', icon: 'none' })
              return
            }
            this.setData({ csvItems, csvFileName: file.name || '库存文件.csv' })
          },
          fail: () => wx.showToast({ title: '文件读取失败', icon: 'none' })
        })
      }
    })
  },

  downloadCsvTemplate() {
    const filePath = wx.env.USER_DATA_PATH + '/豆仓入库模板.csv'
    wx.getFileSystemManager().writeFile({
      filePath,
      data: '\uFEFF色号,入库数量\nA1,500\nB7,1000\nC19,1200',
      encoding: 'utf8',
      success: () => {
        if (typeof wx.shareFileMessage === 'function') {
          wx.shareFileMessage({ filePath, fileName: '豆仓入库模板.csv', fail: () => wx.setClipboardData({ data: '色号,入库数量\nA1,500\nB7,1000\nC19,1200' }) })
        } else {
          wx.setClipboardData({ data: '色号,入库数量\nA1,500\nB7,1000\nC19,1200' })
        }
      },
      fail: () => wx.showToast({ title: '模板生成失败', icon: 'none' })
    })
  },

  confirmStockEntry() {
    let items = []
    let source = this.data.entryTab
    if (this.data.entryTab === 'batch') {
      const amounts = this._batchAmounts || {}
      items = Object.keys(amounts).map((code) => ({
        code,
        delta: this.data.entryDirection * Math.max(0, Number(amounts[code]) || 0),
        brand: this.data.activeBrand
      })).filter((item) => item.delta !== 0)
    } else if (this.data.entryTab === 'manual') {
      const validCodes = new Set(mardPalette.map((item) => item.code))
      items = this.data.entryRows.map((row) => ({
        code: String(row.code || '').trim().toUpperCase(),
        delta: this.data.entryDirection * Math.max(0, Number(row.amount) || 0),
        brand: this.data.activeBrand
      })).filter((item) => validCodes.has(item.code) && item.delta !== 0)
    } else if (this.data.entryTab === 'csv') {
      items = this.data.csvItems.map((item) => Object.assign({}, item, { delta: this.data.entryDirection * Math.abs(Number(item.delta || 0)) }))
    } else if (this.data.entryTab === 'package') {
      const packageCount = Number(this.data.selectedPackage) || 0
      if (packageCount > mardPalette.length) {
        wx.showToast({ title: '当前色卡不支持该套装', icon: 'none' })
        return
      }
      const amount = Number(this.data.packageAmount || 0)
      if (this.data.entryDirection > 0 && this.data.packageReplaceExisting) {
        const inventory = getInventory(this.data.activeBrand)
        items = mardPalette.map((item, index) => ({
          brand: this.data.activeBrand,
          code: item.code,
          delta: (index < packageCount ? amount : 0) - Number(inventory[item.code] || 0)
        })).filter((item) => item.delta !== 0)
      } else {
        items = mardPalette.slice(0, packageCount).map((item) => ({
          brand: this.data.activeBrand,
          code: item.code,
          delta: this.data.entryDirection * amount
        }))
      }
    }
    if (!items.length) {
      wx.showToast({ title: '请填写有效的库存数量', icon: 'none' })
      return
    }
    const directionText = this.data.entryDirection > 0 ? '增加' : '减少'
    wx.showModal({
      title: directionText + ' ' + items.length + ' 个色号？',
      content: '减少库存时最低为 0；本次操作可在库存记录中撤销。',
      confirmText: '确认执行',
      success: (result) => {
        if (!result.confirm) return
        batchAdjustStock(items, { source: 'stock-entry-' + source })
        if (source === 'batch') this._batchAmounts = {}
        this.setData({ showStockEntry: false })
        this.refresh()
        wx.showToast({ title: '已更新 ' + items.length + ' 个色号', icon: 'success' })
      }
    })
  },

  buildCombinedStats(patterns) {
    const totals = {}
    ;(patterns || []).forEach((pattern) => {
      ;(pattern.stats || []).forEach((item) => {
        if (!totals[item.code]) totals[item.code] = Object.assign({}, item, { required: 0 })
        totals[item.code].required += Number(item.required || 0)
      })
    })
    return Object.keys(totals).map((code) => totals[code])
  },

  openShortageSheet(name, stats) {
    this._shortageStats = stats || []
    const shortageRows = buildRefillList(stats, this.data.activeBrand, this.data.refillTarget, this.data.refillUnit)
    this.setData({ showShortageSheet: true, shortagePatternName: name, shortageRows })
  },

  showShortageList() {
    const pattern = getCurrentPattern()
    if (!pattern) {
      wx.showToast({ title: '请先打开一张图纸', icon: 'none' })
      return
    }
    this.openShortageSheet(pattern.name, pattern.stats || [])
  },

  closeShortageSheet() { this.setData({ showShortageSheet: false }) },
  inputRefillTarget(event) {
    this.setData({ refillTarget: Math.max(0, Math.floor(Number(event.detail.value) || 0)) }, () => this.rebuildShortageSheet())
  },
  setRefillUnit(event) {
    this.setData({ refillUnit: Number(event.currentTarget.dataset.unit) || 500 }, () => this.rebuildShortageSheet())
  },
  rebuildShortageSheet() {
    const selected = this._shortageStats || (getCurrentPattern() && getCurrentPattern().stats) || []
    this.setData({ shortageRows: buildRefillList(selected, this.data.activeBrand, this.data.refillTarget, this.data.refillUnit) })
  },
  copyShortage(event) {
    const mode = event.currentTarget.dataset.mode
    const text = this.data.shortageRows.map((item) => {
      if (mode === 'codes') return item.code
      if (mode === 'stock') return item.code + ' 当前 ' + item.stock
      return item.code + ' 补 ' + item.refill
    }).join(mode === 'codes' ? ',' : '\n')
    wx.setClipboardData({ data: text })
  },

  openConsumptionCalculator() {
    const consumptionPatterns = getSavedPatterns().map((item) => Object.assign({}, item, {
      colorCount: (item.stats || []).length,
      beadCount: (item.stats || []).reduce((sum, color) => sum + Number(color.required || 0), 0),
      selected: false
    }))
    this.setData({ showConsumptionSheet: true, consumptionPatterns, selectedConsumptionIds: [] })
  },
  closeConsumptionSheet() { this.setData({ showConsumptionSheet: false }) },
  toggleConsumptionPattern(event) {
    const id = event.currentTarget.dataset.id
    const selected = new Set(this.data.selectedConsumptionIds)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    const ids = Array.from(selected)
    this.setData({
      selectedConsumptionIds: ids,
      consumptionPatterns: this.data.consumptionPatterns.map((item) => Object.assign({}, item, { selected: selected.has(item.id) }))
    })
  },
  selectAllConsumption() {
    const allSelected = this.data.selectedConsumptionIds.length === this.data.consumptionPatterns.length
    const ids = allSelected ? [] : this.data.consumptionPatterns.map((item) => item.id)
    const selected = new Set(ids)
    this.setData({ selectedConsumptionIds: ids, consumptionPatterns: this.data.consumptionPatterns.map((item) => Object.assign({}, item, { selected: selected.has(item.id) })) })
  },
  calculateConsumption() {
    const selected = new Set(this.data.selectedConsumptionIds)
    const patterns = getSavedPatterns().filter((item) => selected.has(item.id))
    if (!patterns.length) {
      wx.showToast({ title: '请至少选择一张图纸', icon: 'none' })
      return
    }
    const stats = this.buildCombinedStats(patterns)
    this._shortageStats = stats
    this.setData({ showConsumptionSheet: false }, () => this.openShortageSheet(patterns.length + ' 张图纸合计', stats))
  },

  undoStockTransaction(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '撤销库存操作',
      content: '库存会恢复到执行该操作之前的数量。',
      success: (result) => {
        if (!result.confirm) return
        const undone = undoTransaction(id)
        if (!undone.ok) {
          wx.showToast({ title: '该操作无法撤销', icon: 'none' })
          return
        }
        this.refresh()
        wx.showToast({ title: '库存操作已撤销', icon: 'success' })
      }
    })
  }
})
