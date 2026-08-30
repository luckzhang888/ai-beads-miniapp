const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const { getSavedPatterns } = require('../../utils/pattern')
const { getTransactions, summarizeTransaction, undoTransaction } = require('../../utils/inventory')

function pad(value) {
  return Number(value) < 10 ? ('0' + value) : String(value)
}

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

function sourceLabel(source) {
  const value = String(source || '')
  if (value.indexOf('stock-entry-batch') === 0) return '按色号批量录入'
  if (value.indexOf('stock-entry-manual') === 0) return '手动录入'
  if (value.indexOf('stock-entry-csv') === 0) return '文件导入'
  if (value.indexOf('stock-entry-package') === 0) return '套装入库'
  if (value === 'pattern-management-inbound') return '图纸用量入库'
  if (value === 'pattern-management-outbound') return '图纸领料出库'
  if (value === 'inventory-card') return '库存卡片快捷调整'
  if (value === 'inventory-input') return '库存数量修正'
  if (value === 'quick-transaction') return '快捷出入库'
  if (value === 'batch-input') return '批量文本录入'
  return value ? '库存操作' : '作品库存联动'
}

Page({
  data: {
    paletteMap: createPaletteMap(mardPalette),
    filters: [
      { value: 'all', label: '全部' },
      { value: 'in', label: '入库' },
      { value: 'out', label: '出库' },
      { value: 'adjust', label: '调整' }
    ],
    activeFilter: 'all',
    records: [],
    visibleRecords: [],
    inboundTotal: 0,
    outboundTotal: 0,
    recordCount: 0,
    expandedId: ''
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const patterns = getSavedPatterns()
    const patternMap = patterns.reduce((result, item) => {
      result[item.id] = item
      return result
    }, {})
    const colorMap = this.data.paletteMap
    const records = getTransactions().map((transaction) => {
      const summary = summarizeTransaction(transaction)
      const metadata = transaction.metadata || {}
      const pattern = metadata.patternId ? patternMap[metadata.patternId] : null
      const items = (transaction.items || []).map((item, index) => ({
        key: item.code + '-' + index,
        code: item.code,
        delta: Number(item.delta) || 0,
        deltaLabel: (Number(item.delta) > 0 ? '+' : '') + String(Number(item.delta) || 0),
        hex: colorMap[item.code] && colorMap[item.code].hex ? colorMap[item.code].hex : '#e5e2e8'
      }))
      const expanded = this.data.expandedId === transaction.id
      return Object.assign({}, summary, {
        id: transaction.id,
        timeLabel: formatTime(transaction.createdAt),
        sourceLabel: sourceLabel(metadata.source),
        patternId: metadata.patternId || '',
        patternName: metadata.patternName || '',
        previewMatrix: pattern ? pattern.matrix : [],
        items,
        visibleItems: expanded ? items : items.slice(0, 12),
        hiddenCount: Math.max(0, items.length - 12),
        expanded,
        undone: Boolean(transaction.undone)
      })
    })
    const activeRecords = records.filter((item) => !item.undone)
    this.setData({
      records,
      inboundTotal: activeRecords.reduce((sum, item) => sum + item.inbound, 0),
      outboundTotal: activeRecords.reduce((sum, item) => sum + item.outbound, 0),
      recordCount: records.length
    }, () => this.applyFilter())
  },

  applyFilter() {
    const active = this.data.activeFilter
    const visibleRecords = this.data.records.filter((item) => active === 'all' || item.direction === active)
    this.setData({ visibleRecords })
  },

  selectFilter(event) {
    this.setData({ activeFilter: event.currentTarget.dataset.value || 'all' }, () => this.applyFilter())
  },

  toggleDetails(event) {
    const id = event.currentTarget.dataset.id
    this.setData({ expandedId: this.data.expandedId === id ? '' : id }, () => this.refresh())
  },

  openPattern(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(id) })
  },

  undoRecord(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '撤销库存记录',
      content: '库存会恢复到本次操作之前，原记录将保留并标记为已撤销。',
      confirmText: '撤销',
      success: (result) => {
        if (!result.confirm) return
        const undone = undoTransaction(id)
        if (!undone.ok) {
          wx.showToast({ title: '该记录无法撤销', icon: 'none' })
          return
        }
        this.refresh()
        wx.showToast({ title: '库存已恢复', icon: 'success' })
      }
    })
  }
})
