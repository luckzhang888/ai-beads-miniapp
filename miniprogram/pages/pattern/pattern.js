const demoPalette = require('../../data/colors/demo')
const { createPaletteMap } = require('../../utils/color-match')
const { mergeStatsWithInventory } = require('../../utils/inventory')
const {
  getCurrentPattern,
  getPatternById,
  savePattern,
  setCurrentPattern,
  mirrorHorizontal
} = require('../../utils/pattern')

Page({
  data: {
    pattern: null,
    stats: [],
    paletteMap: createPaletteMap(demoPalette),
    zoom: 1,
    showCodes: false,
    showGrid: true,
    highlightCode: ''
  },

  onLoad(options) {
    this.patternId = options && options.id ? decodeURIComponent(options.id) : ''
  },

  onShow() {
    let pattern = this.patternId ? getPatternById(this.patternId) : null
    if (!pattern) {
      pattern = getCurrentPattern()
    }

    if (!pattern) {
      wx.showModal({
        title: '没有图纸',
        content: '请先创建一张图纸。',
        showCancel: false,
        success() {
          wx.navigateBack()
        }
      })
      return
    }

    setCurrentPattern(pattern)
    this.setPattern(pattern)
  },

  setPattern(pattern) {
    this.setData({
      pattern,
      stats: mergeStatsWithInventory(pattern.stats || [])
    })
  },

  toggleCodes() {
    this.setData({
      showCodes: !this.data.showCodes
    })
  },

  toggleGrid() {
    this.setData({
      showGrid: !this.data.showGrid
    })
  },

  zoomIn() {
    const next = Math.min(2, Math.round((this.data.zoom + 0.5) * 10) / 10)
    this.setData({ zoom: next })
  },

  zoomOut() {
    const next = Math.max(1, Math.round((this.data.zoom - 0.5) * 10) / 10)
    this.setData({ zoom: next })
  },

  selectColor(event) {
    const code = event.currentTarget.dataset.code
    this.setData({
      highlightCode: this.data.highlightCode === code ? '' : code
    })
  },

  clearHighlight() {
    this.setData({ highlightCode: '' })
  },

  mirrorPattern() {
    const pattern = Object.assign({}, this.data.pattern, {
      matrix: mirrorHorizontal(this.data.pattern.matrix)
    })
    const saved = savePattern(pattern)
    setCurrentPattern(saved)
    this.setPattern(saved)
    wx.showToast({
      title: '已水平镜像',
      icon: 'success'
    })
  },

  goInventory() {
    wx.navigateTo({
      url: '/pages/inventory/inventory'
    })
  }
})
