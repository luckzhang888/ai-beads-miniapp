const mardPalette = require('../../data/colors/mard')
const { getInventory, setStock, adjustStock } = require('../../utils/inventory')

const SERIES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M']
const LOW_STOCK = 100

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
    expandedSeries: 'A'
  },

  onShow() {
    this.refresh()
  },

  buildRows() {
    const inventory = getInventory()
    return mardPalette.map((item) => Object.assign({}, item, {
      stock: Number(inventory[item.code] || 0),
      low: Number(inventory[item.code] || 0) < LOW_STOCK
    }))
  },

  refresh() {
    this.allRows = this.buildRows()
    const totalStock = this.allRows.reduce((sum, item) => sum + item.stock, 0)
    const lowCount = this.allRows.filter((item) => item.low).length
    this.setData({
      totalStock,
      colorCount: this.allRows.length,
      lowCount
    })
    this.applyFilter()
  },

  applyFilter() {
    const keyword = String(this.data.query || '').trim().toLowerCase()
    const activeSeries = this.data.activeSeries
    let rows = (this.allRows || this.buildRows()).filter((item) => {
      const seriesOk = activeSeries === 'ALL' || item.series === activeSeries
      const searchOk = !keyword || item.code.toLowerCase().indexOf(keyword) >= 0
      return seriesOk && searchOk
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

  toggleSeries(event) {
    const series = event.currentTarget.dataset.series
    this.setData({ expandedSeries: this.data.expandedSeries === series ? '' : series })
    this.applyFilter()
  },

  adjust(event) {
    const code = event.currentTarget.dataset.code
    const delta = Number(event.currentTarget.dataset.delta)
    adjustStock(code, delta)
    this.refresh()
  },

  setExactStock(event) {
    const code = event.currentTarget.dataset.code
    setStock(code, event.detail.value)
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
        adjustStock(code, direction * amount)
        this.refresh()
        wx.showToast({ title: '库存已更新', icon: 'success' })
      }
    })
  }
})
