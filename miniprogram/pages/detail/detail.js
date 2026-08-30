const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const { mergeStatsWithInventory } = require('../../utils/inventory')
const {
  getPatternById,
  savePattern,
  setCurrentPattern,
  renamePattern,
  deletePattern,
  makeShareCode
} = require('../../utils/pattern')
const { recordActivity } = require('../../utils/activity')

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  const pad = (value) => value < 10 ? ('0' + value) : String(value)
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

Page({
  data: {
    pattern: null,
    paletteMap: createPaletteMap(mardPalette),
    stats: [],
    totalMissing: 0,
    beadCount: 0,
    tab: 'main',
    effectCode: ''
  },

  onLoad(options) {
    this.patternId = options && options.id ? decodeURIComponent(options.id) : ''
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const pattern = getPatternById(this.patternId)
    if (!pattern) {
      wx.showModal({
        title: '图纸不存在',
        content: '这张图纸可能已被删除。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
    const stats = mergeStatsWithInventory(pattern.stats || [])
    const totalMissing = stats.reduce((sum, item) => sum + item.missing, 0)
    const beadCount = stats.reduce((sum, item) => sum + Number(item.required || 0), 0)
    const view = Object.assign({}, pattern, {
      displayTime: formatTime(pattern.updatedAt),
      status: pattern.status || (Number(pattern.completedCount || 0) > 0 ? '已拼' : '待拼')
    })
    setCurrentPattern(pattern)
    this.setData({
      pattern: view,
      stats,
      totalMissing,
      beadCount,
      effectCode: this.data.effectCode || (stats[0] ? stats[0].code : '')
    })
  },

  chooseTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab })
  },

  chooseEffectCode(event) {
    this.setData({ effectCode: event.currentTarget.dataset.code })
  },

  enterPattern() {
    wx.navigateTo({ url: '/pages/pattern/pattern?id=' + encodeURIComponent(this.patternId) })
  },

  editPattern() {
    wx.showModal({
      title: '编辑图纸名称',
      editable: true,
      placeholderText: this.data.pattern.name,
      content: this.data.pattern.name,
      success: (result) => {
        if (!result.confirm) return
        const saved = renamePattern(this.patternId, result.content)
        if (!saved) {
          wx.showToast({ title: '名称不能为空', icon: 'none' })
          return
        }
        recordActivity('pattern-status', {
          patternId: saved.id,
          patternName: saved.name,
          title: '重命名图纸',
          description: '图纸名称已更新'
        })
        this.refresh()
      }
    })
  },

  moreActions() {
    wx.showActionSheet({
      itemList: ['复制分享口令', '标记为正在拼', '导出高清图纸', '删除图纸'],
      success: (result) => {
        if (result.tapIndex === 0) wx.setClipboardData({ data: makeShareCode(this.data.pattern) })
        if (result.tapIndex === 1) this.markWorking()
        if (result.tapIndex === 2) wx.navigateTo({ url: '/pages/pattern/pattern?id=' + encodeURIComponent(this.patternId) + '&export=1' })
        if (result.tapIndex === 3) this.removePattern()
      }
    })
  },

  markWorking() {
    const pattern = getPatternById(this.patternId)
    if (!pattern) return
    const saved = savePattern(Object.assign({}, pattern, { status: '正在拼' }), mardPalette)
    setCurrentPattern(saved)
    recordActivity('pattern-status', {
      patternId: saved.id,
      patternName: saved.name,
      title: '开始拼豆',
      description: '图纸状态改为正在拼'
    })
    this.refresh()
    wx.showToast({ title: '已开始拼豆', icon: 'success' })
  },

  removePattern() {
    wx.showModal({
      title: '删除图纸',
      content: '删除后无法恢复，确认删除这张图纸吗？',
      confirmText: '删除',
      confirmColor: '#d94f5c',
      success: (result) => {
        if (!result.confirm) return
        recordActivity('pattern-status', {
          patternId: this.data.pattern.id,
          patternName: this.data.pattern.name,
          title: '删除图纸',
          description: '已从图纸册删除'
        })
        deletePattern(this.patternId)
        wx.navigateBack()
      }
    })
  }
})
