const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const {
  createDemoPattern,
  getSavedPatterns,
  getPatternById,
  savePattern,
  setCurrentPattern
} = require('../../utils/pattern')

const DEMO_SEEDED_KEY = 'aiDoucangDemoSeeded:v1'

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  const pad = (value) => value < 10 ? ('0' + value) : String(value)
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate())
}

function seedPatterns() {
  if (getSavedPatterns().length || wx.getStorageSync(DEMO_SEEDED_KEY)) return
  const first = createDemoPattern(32)
  first.name = '薄荷爱心'
  first.tags = ['原创', '萌系']
  first.status = '待拼'
  savePattern(first, mardPalette)

  const second = createDemoPattern(48)
  second.name = '莓果心愿'
  second.tags = ['爱心', '红色']
  second.status = '已拼'
  second.completedCount = 1
  savePattern(second, mardPalette)
  wx.setStorageSync(DEMO_SEEDED_KEY, true)
}

Page({
  data: {
    paletteMap: createPaletteMap(mardPalette),
    patterns: [],
    visiblePatterns: [],
    folders: [],
    query: '',
    selectedStatus: '全部',
    statuses: ['全部', '待拼', '正在拼', '已拼'],
    stats: { folders: 0, working: 0, pending: 0, total: 0 }
  },

  onShow() {
    seedPatterns()
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh() {
    const patterns = getSavedPatterns().map((item) => {
      const stats = Array.isArray(item.stats) ? item.stats : []
      return Object.assign({}, item, {
        displayTime: formatTime(item.updatedAt),
        colorCount: stats.length,
        beadCount: stats.reduce((sum, color) => sum + Number(color.required || 0), 0),
        status: item.status || (Number(item.completedCount || 0) > 0 ? '已拼' : '待拼')
      })
    })
    const folders = [
      { id: 'original', title: '原创收藏', count: Math.min(2, patterns.length), cover: patterns[0] },
      { id: 'favorites', title: '灵感图集', count: Math.max(0, patterns.length - 1), cover: patterns[1] || patterns[0] }
    ].filter((folder) => folder.cover)
    const stats = {
      folders: folders.length,
      working: patterns.filter((item) => item.status === '正在拼').length,
      pending: patterns.filter((item) => item.status === '待拼').length,
      total: patterns.length
    }
    this.setData({ patterns, folders, stats }, () => this.applyFilter())
  },

  onSearch(event) {
    this.setData({ query: event.detail.value }, () => this.applyFilter())
  },

  selectStatus(event) {
    this.setData({ selectedStatus: event.currentTarget.dataset.status }, () => this.applyFilter())
  },

  applyFilter() {
    const query = String(this.data.query || '').trim().toLowerCase()
    const selectedStatus = this.data.selectedStatus
    const visiblePatterns = this.data.patterns.filter((item) => {
      const tags = Array.isArray(item.tags) ? item.tags : []
      const searchOk = !query || item.name.toLowerCase().indexOf(query) >= 0 ||
        tags.some((tag) => String(tag).toLowerCase().indexOf(query) >= 0)
      const statusOk = selectedStatus === '全部' || item.status === selectedStatus
      return searchOk && statusOk
    })
    this.setData({ visiblePatterns })
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/convert/convert' })
  },

  goInventory() {
    wx.navigateTo({ url: '/pages/inventory/inventory' })
  },

  showComingSoon(event) {
    wx.showToast({ title: event.currentTarget.dataset.name + '即将开放', icon: 'none' })
  },

  openPattern(event) {
    const id = event.currentTarget.dataset.id
    const pattern = getPatternById(id)
    if (!pattern) {
      wx.showToast({ title: '图纸不存在', icon: 'none' })
      this.refresh()
      return
    }
    setCurrentPattern(pattern)
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(id) })
  }
})
