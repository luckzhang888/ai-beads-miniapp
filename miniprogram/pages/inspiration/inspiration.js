const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const { getSavedPatterns, getPatternById, trySavePattern: savePattern, setCurrentPattern } = require('../../utils/pattern')

Page({
  data: {
    paletteMap: createPaletteMap(mardPalette),
    query: '',
    patterns: [],
    visiblePatterns: []
  },

  onShow() { this.refresh() },

  refresh() {
    const patterns = getSavedPatterns().map((item) => Object.assign({}, item, {
      collected: (item.tags || []).indexOf('灵感收藏') >= 0,
      colorCount: (item.stats || []).length,
      beadCount: (item.stats || []).reduce((sum, color) => sum + Number(color.required || 0), 0)
    }))
    this.setData({ patterns }, () => this.applyFilter())
  },

  onSearch(event) {
    this.setData({ query: event.detail.value }, () => this.applyFilter())
  },

  applyFilter() {
    const query = String(this.data.query || '').trim().toLowerCase()
    const visiblePatterns = this.data.patterns.filter((item) => {
      const tags = Array.isArray(item.tags) ? item.tags : []
      return !query || String(item.name).toLowerCase().indexOf(query) >= 0 || tags.some((tag) => String(tag).toLowerCase().indexOf(query) >= 0)
    }).sort((a, b) => Number(b.collected) - Number(a.collected) || Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    this.setData({ visiblePatterns })
  },

  toggleCollect(event) {
    const id = event.currentTarget.dataset.id
    const pattern = getPatternById(id)
    if (!pattern) return
    const tags = new Set(pattern.tags || [])
    if (tags.has('灵感收藏')) tags.delete('灵感收藏')
    else tags.add('灵感收藏')
    if (!savePattern(Object.assign({}, pattern, { tags: Array.from(tags) }), mardPalette)) return
    this.refresh()
  },

  openPattern(event) {
    const pattern = getPatternById(event.currentTarget.dataset.id)
    if (!pattern) return
    setCurrentPattern(pattern)
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(pattern.id) })
  },

  goCreate() { wx.navigateTo({ url: '/pages/convert/convert' }) }
})
