const mardPalette = require('../../data/colors/mard')
const { getCurrentPattern } = require('../../utils/pattern')
const {
  getInventory,
  setStock,
  adjustStock,
  batchAdjustStock,
  getShortageList,
  getTransactions,
  undoTransaction,
  getInventorySettings,
  saveInventorySettings
} = require('../../utils/inventory')

const SERIES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M']

function naturalCodeNumber(code) {
  return Number(String(code).replace(/\D/g, '')) || 0
}

Page({
  data: {
    query: '',
    activeSeries: 'ALL',
    seriesOptions: ['ALL'].concat(SERIES),
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
    transactions: []
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
    const transactions = getTransactions().slice(0, 8).map((item) => ({
      id: item.id,
      typeLabel: { set: '修正库存', adjust: '库存调整', batch: '批量调整', consume: '作品扣减' }[item.type] || item.type,
      itemCount: item.items.length,
      timeLabel: new Date(item.createdAt).toLocaleString(),
      undone: item.undone,
      patternName: item.metadata && item.metadata.patternName ? item.metadata.patternName : ''
    }))
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

  showShortageList() {
    const pattern = getCurrentPattern()
    if (!pattern) {
      wx.showToast({ title: '请先打开一张图纸', icon: 'none' })
      return
    }
    const shortage = getShortageList(pattern.stats || [], pattern.brand || 'MARD')
    if (!shortage.length) {
      wx.showToast({ title: '当前图纸库存充足', icon: 'success' })
      return
    }
    const text = pattern.name + ' 缺豆清单\n' + shortage.map((item) => item.code + ' 缺 ' + item.missing + ' 粒').join('\n')
    wx.showModal({
      title: '缺豆清单（' + shortage.length + ' 色）',
      content: text,
      confirmText: '复制清单',
      success(result) { if (result.confirm) wx.setClipboardData({ data: text }) }
    })
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
