const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const { mergeStatsWithInventory, consumeStats, hasConsumedPattern } = require('../../utils/inventory')
const { exportPatternImages, saveImagesToAlbum } = require('../../utils/export')
const {
  getCurrentPattern,
  getPatternById,
  savePattern,
  setCurrentPattern,
  mirrorHorizontal,
  makeShareCode,
  indicesForRow,
  indicesForRect,
  indicesForCode,
  toggleProgressIndices,
  calculateProgress
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

function migrateCompletedIndices(pattern) {
  const existing = Array.isArray(pattern.completedCellIndices) ? pattern.completedCellIndices : []
  if (existing.length || !Array.isArray(pattern.completedCodes) || !pattern.completedCodes.length) return existing
  return pattern.completedCodes.reduce((result, code) => result.concat(indicesForCode(pattern.matrix, code)), [])
}

function displayIndices(indices, width, mirrored) {
  if (!mirrored) return indices.slice()
  return indices.map((index) => {
    const y = Math.floor(index / width)
    const x = index % width
    return y * width + (width - 1 - x)
  })
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
    workButtonText: '选择色号开始拼豆',
    completedIndices: [],
    displayCompletedIndices: [],
    progressTool: 'cell',
    progressToolName: '单格',
    areaStart: null,
    scrollLeft: 0,
    scrollTop: 0,
    performanceHint: ''
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

  onUnload() {
    this.persistViewState()
  },

  setPattern(pattern) {
    const completedIndices = migrateCompletedIndices(pattern)
    const progressInfo = calculateProgress(pattern.matrix || [], completedIndices)
    const completedCodes = progressInfo.completedCodes
    const stats = mergeStatsWithInventory(pattern.stats || []).map((item) => Object.assign({}, item, {
      completed: completedCodes.indexOf(item.code) >= 0
    }))
    const totalMissing = stats.reduce((sum, item) => sum + item.missing, 0)
    const progress = progressInfo.percent
    const view = Object.assign({}, pattern, {
      status: pattern.status || (Number(pattern.completedCount || 0) > 0 ? '已拼' : '待拼')
    })
    const changes = {
      pattern: view,
      displayMatrix: this.data.mirrored ? mirrorHorizontal(pattern.matrix) : pattern.matrix,
      stats,
      totalMissing,
      progress,
      completedIndices,
      displayCompletedIndices: displayIndices(completedIndices, pattern.width, this.data.mirrored),
      performanceHint: pattern.width * pattern.height >= 12000 ? '大图已启用性能模式：拖动时降低清晰度，停止后自动恢复' : ''
    }
    if (!this.hasInitialZoom) {
      const viewState = pattern.viewState || {}
      changes.zoom = Number(viewState.zoom) || recommendedZoom(pattern)
      changes.scrollLeft = Number(viewState.scrollLeft) || 0
      changes.scrollTop = Number(viewState.scrollTop) || 0
      changes.highlightCode = viewState.highlightCode || ''
      changes.mirrored = Boolean(viewState.mirrored)
      changes.displayMatrix = changes.mirrored ? mirrorHorizontal(pattern.matrix) : pattern.matrix
      changes.displayCompletedIndices = displayIndices(completedIndices, pattern.width, changes.mirrored)
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
      displayMatrix: mirrored ? mirrorHorizontal(this.data.pattern.matrix) : this.data.pattern.matrix,
      displayCompletedIndices: displayIndices(this.data.completedIndices, this.data.pattern.width, mirrored)
    }, () => this.persistViewState())
  },

  toggleLock() {
    const locked = !this.data.locked
    this.setData({ locked })
    wx.showToast({ title: locked ? '画布已锁定' : '画布已解锁', icon: 'none' })
  },

  zoomIn() {
    this.setData({ zoom: Math.min(MAX_ZOOM, Math.round((this.data.zoom + 0.5) * 20) / 20) }, () => this.persistViewState())
  },

  zoomOut() {
    this.setData({ zoom: Math.max(MIN_ZOOM, Math.round((this.data.zoom - 0.5) * 20) / 20) }, () => this.persistViewState())
  },

  handleZoomChange(event) {
    const value = event.detail && Number(event.detail.zoom)
    if (!Number.isFinite(value)) return
    this.setData({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)) }, () => this.persistViewState())
  },

  handleViewChange(event) {
    const detail = event.detail || {}
    this.setData({
      scrollLeft: Number(detail.scrollLeft) || 0,
      scrollTop: Number(detail.scrollTop) || 0
    })
    this.persistViewState()
  },

  selectColor(event) {
    const code = event.currentTarget.dataset.code || ''
    this.setData({ highlightCode: code, working: false }, () => {
      this.updateWorkButton()
      this.persistViewState()
    })
  },

  handleCellTap(event) {
    if (this.data.locked) return
    const detail = event.detail || {}
    const code = detail.code
    if (!code) return
    const point = {
      x: this.data.mirrored ? this.data.pattern.width - 1 - Number(detail.x) : Number(detail.x),
      y: Number(detail.y)
    }
    if (this.data.working) {
      this.applyProgressPoint(point)
      return
    }
    this.setData({ highlightCode: code, working: false }, () => this.updateWorkButton())
  },

  chooseProgressTool() {
    wx.showActionSheet({
      itemList: ['单格标记', '整行标记', '矩形区域标记', '撤销进度操作'],
      success: (result) => {
        if (result.tapIndex === 3) {
          this.undoProgress()
          return
        }
        const tools = [
          { value: 'cell', name: '单格' },
          { value: 'row', name: '整行' },
          { value: 'area', name: '区域' }
        ]
        const selected = tools[result.tapIndex]
        if (selected) this.setData({ progressTool: selected.value, progressToolName: selected.name, areaStart: null })
      }
    })
  },

  applyProgressPoint(point) {
    if (this.data.progressTool === 'area' && !this.data.areaStart) {
      this.setData({ areaStart: point })
      wx.showToast({ title: '再点一个格子确定区域', icon: 'none' })
      return
    }
    let targets
    if (this.data.progressTool === 'row') targets = indicesForRow(this.data.pattern.matrix, point.y)
    else if (this.data.progressTool === 'area') targets = indicesForRect(this.data.pattern.matrix, this.data.areaStart, point)
    else targets = [point.y * this.data.pattern.width + point.x]
    this.setData({ areaStart: null })
    this.applyProgressTargets(targets)
  },

  applyProgressTargets(targets, forceComplete) {
    if (!targets || !targets.length) return
    this.progressUndoStack = this.progressUndoStack || []
    this.progressUndoStack.push(this.data.completedIndices.slice())
    if (this.progressUndoStack.length > 20) this.progressUndoStack.shift()
    let completedIndices
    if (forceComplete) {
      const completed = new Set(this.data.completedIndices)
      targets.forEach((index) => completed.add(index))
      completedIndices = Array.from(completed).sort((a, b) => a - b)
    } else {
      completedIndices = toggleProgressIndices(this.data.completedIndices, targets)
    }
    this.persistProgress(completedIndices)
  },

  undoProgress() {
    if (!this.progressUndoStack || !this.progressUndoStack.length) {
      wx.showToast({ title: '没有可撤销的进度', icon: 'none' })
      return
    }
    this.persistProgress(this.progressUndoStack.pop())
  },

  persistProgress(completedIndices) {
    const current = getPatternById(this.patternId) || this.data.pattern
    const info = calculateProgress(current.matrix, completedIndices)
    const saved = savePattern(Object.assign({}, current, {
      completedCellIndices: completedIndices,
      completedCodes: info.completedCodes,
      status: info.percent >= 100 ? '已拼' : (info.completed > 0 ? '正在拼' : '待拼'),
      viewState: this.currentViewState()
    }), mardPalette)
    setCurrentPattern(saved)
    this.setPattern(saved)
  },

  currentViewState() {
    return {
      zoom: this.data.zoom,
      scrollLeft: this.data.scrollLeft,
      scrollTop: this.data.scrollTop,
      highlightCode: this.data.highlightCode,
      mirrored: this.data.mirrored
    }
  },

  persistViewState() {
    if (!this.patternId || !this.data.pattern) return
    clearTimeout(this.viewSaveTimer)
    this.viewSaveTimer = setTimeout(() => {
      const current = getPatternById(this.patternId)
      if (!current) return
      savePattern(Object.assign({}, current, { viewState: this.currentViewState() }), mardPalette)
    }, 180)
  },

  clearHighlight() {
    this.setData({ highlightCode: '', working: false }, () => this.updateWorkButton())
  },

  updateWorkButton() {
    let workButtonText = '选择色号开始拼豆'
    if (this.data.highlightCode && !this.data.working) workButtonText = '开始拼 ' + this.data.highlightCode
    if (this.data.highlightCode && this.data.working) workButtonText = '完成该色全部格子'
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
    const targets = indicesForCode(pattern.matrix, this.data.highlightCode)
    this.setData({ working: false })
    this.applyProgressTargets(targets, true)
    wx.showToast({ title: '该色格子已完成', icon: 'success' })
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
      this.persistViewState()
    })
  },

  goEditor() {
    wx.navigateTo({ url: '/pages/editor/editor?id=' + encodeURIComponent(this.data.pattern.id) })
  },

  goInventory() {
    wx.navigateTo({ url: '/pages/inventory/inventory' })
  },

  previewExport() {
    wx.showActionSheet({
      itemList: ['高清完整图纸', '高清完整图纸＋大图分页'],
      success: (result) => this.generateExport(result.tapIndex === 1)
    })
  },

  async generateExport(paginate) {
    wx.showLoading({ title: '生成高清图纸', mask: true })
    try {
      const pattern = getPatternById(this.patternId) || this.data.pattern
      const paths = await exportPatternImages(pattern, this.data.paletteMap, { paginate })
      wx.hideLoading()
      wx.previewImage({ current: paths[0], urls: paths })
      wx.showModal({
        title: '高清图纸已生成',
        content: paths.length > 1 ? '已生成完整图和 ' + (paths.length - 1) + ' 张分页图，是否全部保存到相册？' : '是否保存到相册？',
        confirmText: '全部保存',
        success: async (result) => {
          if (!result.confirm) return
          wx.showLoading({ title: '保存中', mask: true })
          try {
            await saveImagesToAlbum(paths)
            wx.showToast({ title: '已保存到相册', icon: 'success' })
          } catch (error) {
            wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' })
          } finally {
            wx.hideLoading()
          }
        }
      })
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: '高清导出失败', icon: 'none' })
    }
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
    if (hasConsumedPattern(this.data.pattern.id)) {
      wx.showToast({ title: '这张图纸已经扣过库存', icon: 'none' })
      return
    }
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
        const consumed = consumeStats(this.data.pattern.stats || [], {
          patternId: this.data.pattern.id,
          patternName: this.data.pattern.name,
          brand: this.data.pattern.brand || 'MARD'
        })
        if (!consumed.ok) {
          if (consumed.duplicate) {
            wx.showToast({ title: '这张图纸已经扣过库存', icon: 'none' })
            return
          }
          this.setPattern(this.data.pattern)
          wx.showToast({ title: '库存已变化，请重新检查', icon: 'none' })
          return
        }
        const saved = savePattern(Object.assign({}, this.data.pattern, {
          completedCount: Number(this.data.pattern.completedCount || 0) + 1,
          status: '已拼',
          inventoryConsumed: true,
          lastConsumeTransactionId: consumed.transactionId
        }), mardPalette)
        setCurrentPattern(saved)
        this.setPattern(saved)
        wx.showToast({ title: '库存已扣减', icon: 'success' })
      }
    })
  }
})
