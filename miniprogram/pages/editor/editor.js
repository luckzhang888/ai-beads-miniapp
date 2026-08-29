const mardPalette = require('../../data/colors/mard')
const { createPaletteMap, preparePalette, findNearestColors, mergeSimilarColors } = require('../../utils/color-match')
const { getInventory } = require('../../utils/inventory')
const {
  cloneMatrix,
  getCurrentPattern,
  getPatternById,
  savePattern,
  setCurrentPattern,
  mirrorHorizontal,
  mirrorVertical,
  rotate90,
  setCell,
  replaceColor,
  replaceColorInRect,
  floodFill
} = require('../../utils/pattern')

const HISTORY_LIMIT = 12
const preparedPalette = preparePalette(mardPalette)

function candidateViews(rgb, excludedCode) {
  return findNearestColors(rgb, preparedPalette, 6, excludedCode ? [excludedCode] : [])
    .map((item) => Object.assign({}, item, { displayDistance: Number(item.distance).toFixed(1) }))
}

Page({
  data: {
    pattern: null,
    matrix: [],
    palette: mardPalette.map((item) => Object.assign({}, item, { locked: false })),
    paletteMap: createPaletteMap(mardPalette),
    selectedCode: mardPalette[0].code,
    selectedHex: mardPalette[0].hex,
    tool: 'paint',
    toolName: '画笔',
    zoom: 1,
    showGrid: true,
    showCodes: true,
    dirty: false,
    canUndo: false,
    canRedo: false,
    candidates: [],
    lockedCodes: [],
    selectedLocked: false,
    areaStart: null
  },

  onLoad(options) {
    this.patternId = options && options.id ? decodeURIComponent(options.id) : ''
    this.undoStack = []
    this.redoStack = []

    const pattern = this.patternId ? getPatternById(this.patternId) : getCurrentPattern()
    if (!pattern) {
      wx.showModal({
        title: '没有图纸',
        content: '请先创建图纸。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }

    this.patternId = pattern.id
    const selected = mardPalette[0]
    this.setData({
      pattern,
      matrix: cloneMatrix(pattern.matrix),
      lockedCodes: Array.isArray(pattern.lockedCodes) ? pattern.lockedCodes : [],
      palette: mardPalette.map((item) => Object.assign({}, item, {
        locked: Array.isArray(pattern.lockedCodes) && pattern.lockedCodes.indexOf(item.code) >= 0
      })),
      candidates: candidateViews(selected.rgb, selected.code)
    })
  },

  onUnload() {
    if (this.data.dirty && this.data.pattern) {
      this.persist(false)
    }
  },

  setTool(event) {
    const tool = event.currentTarget.dataset.tool
    const names = {
      paint: '画笔',
      fill: '区域填充',
      replace: '全局替换',
      areaReplace: '区域替换',
      inspect: '吸管检查'
    }
    this.setData({
      tool,
      toolName: names[tool] || tool,
      areaStart: null
    })
  },

  selectPalette(event) {
    const code = event.currentTarget.dataset.code
    const color = this.data.paletteMap[code]
    this.setData({
      selectedCode: code,
      selectedHex: color ? color.hex : 'transparent',
      selectedLocked: this.data.lockedCodes.indexOf(code) >= 0,
      candidates: color ? candidateViews(color.rgb, code) : []
    })
  },

  selectBlank() {
    this.setData({ selectedCode: '', selectedHex: 'transparent', selectedLocked: false, candidates: [] })
  },

  selectCandidate(event) {
    const code = event.currentTarget.dataset.code
    const color = this.data.paletteMap[code]
    if (!color) return
    this.setData({
      selectedCode: code,
      selectedHex: color.hex,
      selectedLocked: this.data.lockedCodes.indexOf(code) >= 0,
      candidates: candidateViews(color.rgb, code)
    })
  },

  toggleGrid() {
    this.setData({ showGrid: !this.data.showGrid })
  },

  toggleCodes() {
    this.setData({ showCodes: !this.data.showCodes })
  },

  zoomIn() {
    this.setData({ zoom: Math.min(6, this.data.zoom + 0.5) })
  },

  zoomOut() {
    this.setData({ zoom: Math.max(1, this.data.zoom - 0.5) })
  },

  handleZoomChange(event) {
    const zoom = Number(event.detail && event.detail.zoom)
    if (Number.isFinite(zoom)) this.setData({ zoom: Math.max(1, Math.min(6, zoom)) })
  },

  handleCellTap(event) {
    const detail = event.detail || {}
    const x = Number(detail.x)
    const y = Number(detail.y)
    const selected = this.data.selectedCode
    const current = detail.code

    if (typeof selected !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) return

    if (this.data.tool === 'inspect') {
      const color = this.data.paletteMap[current]
      if (!color) {
        this.selectBlank()
        return
      }
      this.setData({
        selectedCode: current,
        selectedHex: color.hex,
        selectedLocked: this.data.lockedCodes.indexOf(current) >= 0,
        candidates: candidateViews(color.rgb, current)
      })
      return
    }

    if (this.data.tool === 'areaReplace' && !this.data.areaStart) {
      this.setData({ areaStart: { x, y, fromCode: current } })
      wx.showToast({ title: '再点一个格子确定替换区域', icon: 'none' })
      return
    }

    let next
    if (this.data.tool === 'fill') {
      next = floodFill(this.data.matrix, x, y, selected)
    } else if (this.data.tool === 'replace') {
      this.confirmReplacement(current, selected, () => this.applyMatrix(replaceColor(this.data.matrix, current, selected)))
      return
    } else if (this.data.tool === 'areaReplace') {
      const start = this.data.areaStart
      this.setData({ areaStart: null })
      this.confirmReplacement(start.fromCode, selected, () => {
        this.applyMatrix(replaceColorInRect(this.data.matrix, start, { x, y }, start.fromCode, selected))
      }, start, { x, y })
      return
    } else {
      next = setCell(this.data.matrix, x, y, selected)
    }

    if (current === selected && this.data.tool !== 'replace') return
    this.applyMatrix(next)
  },

  confirmReplacement(fromCode, toCode, callback, first, second) {
    if (fromCode === toCode) return
    let sourceCount = 0
    const matrix = this.data.matrix
    matrix.forEach((row, y) => row.forEach((code, x) => {
      const inRect = !first || (x >= Math.min(first.x, second.x) && x <= Math.max(first.x, second.x) &&
        y >= Math.min(first.y, second.y) && y <= Math.max(first.y, second.y))
      if (inRect && code === fromCode) sourceCount += 1
    }))
    if (!sourceCount) {
      wx.showToast({ title: '选择区域内没有可替换格子', icon: 'none' })
      return
    }
    const inventory = getInventory(this.data.pattern.brand || 'MARD')
    const stock = toCode ? Number(inventory[toCode] || 0) : 0
    const targetBefore = toCode
      ? matrix.reduce((sum, row) => sum + row.filter((code) => code === toCode).length, 0)
      : 0
    const targetAfter = targetBefore + sourceCount
    const shortage = toCode ? Math.max(0, targetAfter - stock) : 0
    const targetLabel = toCode || '空白格'
    wx.showModal({
      title: '确认替换颜色',
      content: (fromCode || '空白') + ' 将减少 ' + sourceCount + ' 格，' + targetLabel + ' 将由 ' + targetBefore +
        ' 格变为 ' + targetAfter + ' 格。' +
        (toCode ? ('目标色库存 ' + stock + ' 粒' + (shortage ? '，替换后预计缺 ' + shortage + ' 粒。' : '，替换后库存充足。')) : '这些格子将不再计算豆数。'),
      confirmText: '确认替换',
      success(result) { if (result.confirm) callback() }
    })
  },

  toggleLockSelected() {
    const code = this.data.selectedCode
    if (!code) return
    const locked = new Set(this.data.lockedCodes)
    if (locked.has(code)) locked.delete(code)
    else locked.add(code)
    const lockedCodes = Array.from(locked)
    this.setData({
      lockedCodes,
      selectedLocked: locked.has(code),
      palette: mardPalette.map((item) => Object.assign({}, item, { locked: locked.has(item.code) })),
      dirty: true
    })
  },

  mergeNearColors() {
    wx.showActionSheet({
      itemList: ['轻度合并（ΔE≤2）', '平衡合并（ΔE≤4）', '强力合并（ΔE≤7）'],
      success: (result) => {
        const thresholds = [2, 4, 7]
        const merged = mergeSimilarColors(this.data.matrix, mardPalette, thresholds[result.tapIndex], this.data.lockedCodes)
        const count = Object.keys(merged.replacements).length
        if (!count) {
          wx.showToast({ title: '没有可合并的近似色', icon: 'none' })
          return
        }
        wx.showModal({
          title: '合并相近颜色',
          content: '将合并 ' + count + ' 个色号。已锁定的色号不会被替换，是否继续？',
          success: (confirm) => { if (confirm.confirm) this.applyMatrix(merged.matrix) }
        })
      }
    })
  },

  applyMatrix(next) {
    this.undoStack.push(cloneMatrix(this.data.matrix))
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.setData({
      matrix: next,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: false
    })
  },

  undo() {
    if (!this.undoStack.length) return
    this.redoStack.push(cloneMatrix(this.data.matrix))
    const matrix = this.undoStack.pop()
    this.setData({
      matrix,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0
    })
  },

  redo() {
    if (!this.redoStack.length) return
    this.undoStack.push(cloneMatrix(this.data.matrix))
    const matrix = this.redoStack.pop()
    this.setData({
      matrix,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0
    })
  },

  mirrorH() {
    this.applyMatrix(mirrorHorizontal(this.data.matrix))
  },

  mirrorV() {
    this.applyMatrix(mirrorVertical(this.data.matrix))
  },

  rotate() {
    this.applyMatrix(rotate90(this.data.matrix))
  },

  save() {
    this.persist(true)
  },

  persist(showToast) {
    if (!this.data.pattern) return null
    const saved = savePattern(Object.assign({}, this.data.pattern, {
      matrix: this.data.matrix,
      brand: 'MARD',
      lockedCodes: this.data.lockedCodes,
      completedCellIndices: [],
      completedCodes: []
    }), mardPalette)
    setCurrentPattern(saved)
    this.setData({ pattern: saved, dirty: false })
    if (showToast) wx.showToast({ title: '图纸已保存', icon: 'success' })
    return saved
  }
})
