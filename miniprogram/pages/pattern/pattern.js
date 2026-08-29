const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const { mergeStatsWithInventory, consumeStats } = require('../../utils/inventory')
const {
  getCurrentPattern,
  getPatternById,
  savePattern,
  setCurrentPattern,
  mirrorHorizontal,
  makeShareCode
} = require('../../utils/pattern')

const MIN_ZOOM = 1
const MAX_ZOOM = 6

function recommendedZoom(pattern) {
  const system = wx.getSystemInfoSync()
  const viewport = Math.max(280, Math.min(Number(system.windowWidth || 375) - 24, 680))
  const columns = Math.max(1, Number(pattern && pattern.width) || 1)
  const target = columns * 10 / viewport
  return Math.max(1.5, Math.min(4, Math.ceil(target * 2) / 2))
}

Page({
  data: {
    pattern: null,
    displayMatrix: [],
    stats: [],
    paletteMap: createPaletteMap(mardPalette),
    zoom: 1.5,
    showCodes: true,
    showGrid: true,
    majorGrid: true,
    highlightCode: '',
    totalMissing: 0,
    locked: false,
    mirrored: false,
    working: false,
    progress: 0,
    workButtonText: '选择色号开始拼豆'
  },

  onLoad(options) {
    this.patternId = options && options.id ? decodeURIComponent(options.id) : ''
    this.autoExport = Boolean(options && options.export === '1')
  },

  onShow() {
    let pattern = this.patternId ? getPatternById(this.patternId) : null
    if (!pattern) pattern = getCurrentPattern()
    if (!pattern) {
      wx.showModal({
        title: '没有图纸',
        content: '请先创建一张图纸。',
        showCancel: false,
        success() { wx.navigateBack() }
      })
      return
    }
    this.patternId = pattern.id
    setCurrentPattern(pattern)
    this.setPattern(pattern)
  },

  setPattern(pattern) {
    const completedCodes = Array.isArray(pattern.completedCodes) ? pattern.completedCodes : []
    const stats = mergeStatsWithInventory(pattern.stats || []).map((item) => Object.assign({}, item, {
      completed: completedCodes.indexOf(item.code) >= 0
    }))
    const totalMissing = stats.reduce((sum, item) => sum + item.missing, 0)
    const totalBeads = stats.reduce((sum, item) => sum + Number(item.required || 0), 0)
    const completedBeads = stats.reduce((sum, item) => sum + (item.completed ? Number(item.required || 0) : 0), 0)
    const progress = totalBeads ? Math.round(completedBeads / totalBeads * 100) : 0
    const view = Object.assign({}, pattern, {
      status: pattern.status || (Number(pattern.completedCount || 0) > 0 ? '已拼' : '待拼')
    })
    const changes = {
      pattern: view,
      displayMatrix: this.data.mirrored ? mirrorHorizontal(pattern.matrix) : pattern.matrix,
      stats,
      totalMissing,
      progress
    }
    if (!this.hasInitialZoom) {
      changes.zoom = recommendedZoom(pattern)
      this.hasInitialZoom = true
    }
    this.setData(changes, () => {
      this.updateWorkButton()
      if (this.autoExport) {
        this.autoExport = false
        setTimeout(() => this.previewExport(), 500)
      }
    })
  },

  toggleCodes() {
    this.setData({ showCodes: !this.data.showCodes })
  },

  toggleGrid() {
    this.setData({ majorGrid: !this.data.majorGrid, showGrid: true })
  },

  toggleMirror() {
    const mirrored = !this.data.mirrored
    this.setData({
      mirrored,
      displayMatrix: mirrored ? mirrorHorizontal(this.data.pattern.matrix) : this.data.pattern.matrix
    })
  },

  toggleLock() {
    const locked = !this.data.locked
    this.setData({ locked })
    wx.showToast({ title: locked ? '画布已锁定' : '画布已解锁', icon: 'none' })
  },

  zoomIn() {
    this.setData({ zoom: Math.min(MAX_ZOOM, Math.round((this.data.zoom + 0.5) * 20) / 20) })
  },

  zoomOut() {
    this.setData({ zoom: Math.max(MIN_ZOOM, Math.round((this.data.zoom - 0.5) * 20) / 20) })
  },

  handleZoomChange(event) {
    const value = event.detail && Number(event.detail.zoom)
    if (!Number.isFinite(value)) return
    this.setData({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)) })
  },

  selectColor(event) {
    const code = event.currentTarget.dataset.code || ''
    this.setData({ highlightCode: code, working: false }, () => this.updateWorkButton())
  },

  handleCellTap(event) {
    if (this.data.locked) return
    const code = event.detail && event.detail.code
    if (!code) return
    this.setData({ highlightCode: code, working: false }, () => this.updateWorkButton())
  },

  clearHighlight() {
    this.setData({ highlightCode: '', working: false }, () => this.updateWorkButton())
  },

  updateWorkButton() {
    let workButtonText = '选择色号开始拼豆'
    if (this.data.highlightCode && !this.data.working) workButtonText = '开始拼 ' + this.data.highlightCode
    if (this.data.highlightCode && this.data.working) workButtonText = '完成 ' + this.data.highlightCode
    this.setData({ workButtonText })
  },

  toggleWorking() {
    if (!this.data.highlightCode) {
      wx.showToast({ title: '请先选择底部色号', icon: 'none' })
      return
    }
    if (!this.data.working) {
      const pattern = getPatternById(this.patternId)
      const saved = savePattern(Object.assign({}, pattern, { status: '正在拼' }), mardPalette)
      setCurrentPattern(saved)
      this.setData({ pattern: saved, working: true }, () => this.updateWorkButton())
      return
    }
    this.completeSelectedColor()
  },

  completeSelectedColor() {
    const pattern = getPatternById(this.patternId)
    const completedCodes = Array.isArray(pattern.completedCodes) ? pattern.completedCodes.slice() : []
    if (completedCodes.indexOf(this.data.highlightCode) < 0) completedCodes.push(this.data.highlightCode)
    const remaining = (pattern.stats || []).find((item) => completedCodes.indexOf(item.code) < 0)
    const saved = savePattern(Object.assign({}, pattern, {
      completedCodes,
      status: remaining ? '正在拼' : '已拼'
    }), mardPalette)
    setCurrentPattern(saved)
    this.setData({
      highlightCode: remaining ? remaining.code : '',
      working: false
    })
    this.setPattern(saved)
    wx.showToast({ title: remaining ? '已完成本色' : '图纸已完成', icon: 'success' })
  },

  resetView() {
    const zoom = recommendedZoom(this.data.pattern)
    this.setData({
      highlightCode: '',
      working: false,
      mirrored: false,
      locked: false,
      zoom
    }, () => {
      this.setPattern(this.data.pattern)
      this.updateWorkButton()
    })
  },

  goEditor() {
    wx.navigateTo({ url: '/pages/editor/editor?id=' + encodeURIComponent(this.data.pattern.id) })
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
    grid.exportImage().then((path) => {
      wx.hideLoading()
      wx.previewImage({ current: path, urls: [path] })
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '生成失败，请重试', icon: 'none' })
    })
  },

  openSettings() {
    wx.showActionSheet({
      itemList: ['完成作品并扣库存', '打开图纸编辑器', '查看库存', '复制分享口令'],
      success: (result) => {
        if (result.tapIndex === 0) this.completeWork()
        if (result.tapIndex === 1) this.goEditor()
        if (result.tapIndex === 2) this.goInventory()
        if (result.tapIndex === 3) wx.setClipboardData({ data: makeShareCode(this.data.pattern) })
      }
    })
  },

  completeWork() {
    if (this.data.totalMissing > 0) {
      wx.showModal({
        title: '库存不足',
        content: '当前还缺少 ' + this.data.totalMissing + ' 颗拼豆，请先补充库存。',
        confirmText: '去库存',
        success: (result) => { if (result.confirm) this.goInventory() }
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
          completedCount: Number(this.data.pattern.completedCount || 0) + 1,
          status: '已拼'
        }), mardPalette)
        setCurrentPattern(saved)
        this.setPattern(saved)
        wx.showToast({ title: '库存已扣减', icon: 'success' })
      }
    })
  }
})
