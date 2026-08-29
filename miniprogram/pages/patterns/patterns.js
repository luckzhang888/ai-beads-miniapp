const {
  getSavedPatterns,
  getPatternById,
  setCurrentPattern,
  deletePattern,
  duplicatePattern,
  renamePattern
} = require('../../utils/pattern')

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  const pad = (value) => value < 10 ? ('0' + value) : String(value)
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

Page({
  data: {
    patterns: []
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const patterns = getSavedPatterns().map((item) => Object.assign({}, item, {
      displayTime: formatTime(item.updatedAt),
      colorCount: Array.isArray(item.stats) ? item.stats.length : 0
    }))
    this.setData({ patterns })
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/convert/convert' })
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
    wx.navigateTo({
      url: '/pages/pattern/pattern?id=' + encodeURIComponent(id)
    })
  },

  duplicate(event) {
    const saved = duplicatePattern(event.currentTarget.dataset.id)
    if (saved) {
      wx.showToast({ title: '已复制', icon: 'success' })
      this.refresh()
    }
  },

  rename(event) {
    const id = event.currentTarget.dataset.id
    const pattern = getPatternById(id)
    if (!pattern) {
      return
    }
    wx.showModal({
      title: '重命名图纸',
      editable: true,
      placeholderText: pattern.name,
      content: pattern.name,
      success: (result) => {
        if (!result.confirm) {
          return
        }
        const saved = renamePattern(id, result.content)
        if (!saved) {
          wx.showToast({ title: '名称不能为空', icon: 'none' })
          return
        }
        this.refresh()
      }
    })
  },

  remove(event) {
    const id = event.currentTarget.dataset.id
    const pattern = getPatternById(id)
    if (!pattern) {
      return
    }
    wx.showModal({
      title: '删除图纸',
      content: '确定删除“' + pattern.name + '”吗？此操作不可撤销。',
      confirmColor: '#dc2626',
      success: (result) => {
        if (result.confirm) {
          deletePattern(id)
          this.refresh()
        }
      }
    })
  }
})
