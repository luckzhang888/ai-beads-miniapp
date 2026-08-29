const demoPalette = require('../../data/colors/demo')
const { createPaletteMap } = require('../../utils/color-match')
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
  floodFill
} = require('../../utils/pattern')

const HISTORY_LIMIT = 12

Page({
  data: {
    pattern: null,
    matrix: [],
    palette: demoPalette,
    paletteMap: createPaletteMap(demoPalette),
    selectedCode: demoPalette[0].code,
    selectedHex: demoPalette[0].hex,
    tool: 'paint',
    toolName: '画笔',
    zoom: 1,
    showGrid: true,
    showCodes: false,
    dirty: false,
    canUndo: false,
    canRedo: false
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
    this.setData({
      pattern,
      matrix: cloneMatrix(pattern.matrix)
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
      replace: '全局替换'
    }
    this.setData({
      tool,
      toolName: names[tool] || tool
    })
  },

  selectPalette(event) {
    const code = event.currentTarget.dataset.code
    const color = this.data.paletteMap[code]
    this.setData({
      selectedCode: code,
      selectedHex: color ? color.hex : '#ffffff'
    })
  },

  toggleGrid() {
    this.setData({ showGrid: !this.data.showGrid })
  },

  toggleCodes() {
    this.setData({ showCodes: !this.data.showCodes })
  },

  zoomIn() {
    this.setData({ zoom: Math.min(3, this.data.zoom + 0.5) })
  },

  zoomOut() {
    this.setData({ zoom: Math.max(1, this.data.zoom - 0.5) })
  },

  handleCellTap(event) {
    const detail = event.detail || {}
    const x = Number(detail.x)
    const y = Number(detail.y)
    const selected = this.data.selectedCode
    const current = detail.code

    if (!selected || !Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }

    let next
    if (this.data.tool === 'fill') {
      next = floodFill(this.data.matrix, x, y, selected)
    } else if (this.data.tool === 'replace') {
      next = replaceColor(this.data.matrix, current, selected)
    } else {
      next = setCell(this.data.matrix, x, y, selected)
    }

    if (current === selected && this.data.tool !== 'replace') {
      return
    }

    this.applyMatrix(next)
  },

  applyMatrix(next) {
    this.undoStack.push(cloneMatrix(this.data.matrix))
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift()
    }
    this.redoStack = []
    this.setData({
      matrix: next,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: false
    })
  },

  undo() {
    if (!this.undoStack.length) {
      return
    }
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
    if (!this.redoStack.length) {
      return
    }
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
    if (!this.data.pattern) {
      return null
    }
    const saved = savePattern(Object.assign({}, this.data.pattern, {
      matrix: this.data.matrix
    }), demoPalette)
    setCurrentPattern(saved)
    this.setData({
      pattern: saved,
      dirty: false
    })
    if (showToast) {
      wx.showToast({ title: '图纸已保存', icon: 'success' })
    }
    return saved
  }
})
