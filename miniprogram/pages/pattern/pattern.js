const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const { mergeStatsWithInventory, consumeStats } = require('../../utils/inventory')
const {
  getCurrentPattern,
  getPatternById,
  savePattern,
  setCurrentPattern
} = require('../../utils/pattern')

Page({
  data: {
    pattern: null,
    stats: [],
    paletteMap: createPaletteMap(mardPalette),
    zoom: 1,
    showCodes: false,
    showGrid: true,
    highlightCode: '',
    totalMissing: 0
  },

  onLoad(options) {
    this.patternId = options && options.id ? decodeURIComponent(options.id) : ''
  },

  onShow() {
    let pattern = this.patternId ? getPatternById(this.patternId) : null
    if (!pattern) pattern = getCurrentPattern()

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

    this.patternId = pattern.id
    setCurrentPattern(pattern)
    this.setPattern(pattern)
  },

  setPattern(pattern) {
    const stats = mergeStatsWithInventory(pattern.stats || [])
    const totalMissing = stats.reduce((sum, item) => sum + item.missing, 0)
    this.setData({ pattern, stats, totalMissing })
  },

  toggleCodes() {
    this.setData({ showCodes: !this.data.showCodes })
  },

  toggleGrid() {
    this.setData({ showGrid: !this.data.showGrid })
  },

  zoomIn() {
    const next = Math.min(3, Math.round((this.data.zoom + 0.5) * 10) / 10)
    this.setData({ zoom: next })
  },

  zoomOut() {
    const next = Math.max(1, Math.round((this.data.zoom - 0.5) * 10) / 10)
    this.setData({ zoom: next })
  },

  selectColor(event) {
    const code = event.currentTarget.dataset.code
    this.setData({ highlightCode: this.data.highlightCode === code ? '' : code })
  },

  clearHighlight() {
    this.setData({ highlightCode: '' })
  },

  goEditor() {
    wx.navigateTo({
      url: '/pages/editor/editor?id=' + encodeURIComponent(this.data.pattern.id)
    })
  },

  goInventory() {
    wx.navigateTo({ url: '/pages/inventory/inventory' })
  },

  previewExport() {
    const grid = this.selectComponent('#patternGrid')
    if (!grid || typeof grid.exportImage !== 'function') {
      wx.showToast({ title: '画布尚未准备好', icon: 'none' })
      return
    }

    wx.showLoading({ title: '生成图片' })
    grid.exportImage()
      .then((path) => {
        wx.hideLoading()
        wx.previewImage({ current: path, urls: [path] })
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '生成失败，请重试', icon: 'none' })
      })
  },

  completeWork() {
    if (this.data.totalMissing > 0) {
      wx.showModal({
        title: '库存不足',
        content: '当前还缺少 ' + this.data.totalMissing + ' 颗拼豆，请先补充库存后再完成制作。',
        confirmText: '去库存',
        success: (result) => {
          if (result.confirm) this.goInventory()
        }
      })
      return
    }

    wx.showModal({
      title: '完成作品',
      content: '将按照本图纸用量从 MARD 库存中扣减拼豆。确定继续吗？',
      confirmText: '确认扣减',
      success: (result) => {
        if (!result.confirm) return
        const consumed = consumeStats(this.data.pattern.stats || [])
        if (!consumed.ok) {
          this.setPattern(this.data.pattern)
          wx.showToast({ title: '库存已变化，请重新检查', icon: 'none' })
          return
        }
        const saved = savePattern(Object.assign({}, this.data.pattern, {
          brand: 'MARD',
          completedCount: Number(this.data.pattern.completedCount || 0) + 1
        }), mardPalette)
        setCurrentPattern(saved)
        this.setPattern(saved)
        wx.showToast({ title: '库存已扣减', icon: 'success' })
      }
    })
  }
})
