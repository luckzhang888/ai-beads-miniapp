const {
  createDemoPattern,
  getSavedPatterns,
  getPatternById,
  savePattern,
  setCurrentPattern
} = require('../../utils/pattern')

Page({
  data: {
    recentPatterns: []
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    this.setData({
      recentPatterns: getSavedPatterns().slice(0, 3)
    })
  },

  goCreate() {
    wx.navigateTo({
      url: '/pages/convert/convert'
    })
  },

  goPatterns() {
    wx.navigateTo({
      url: '/pages/patterns/patterns'
    })
  },

  goInventory() {
    wx.navigateTo({
      url: '/pages/inventory/inventory'
    })
  },

  openPattern(event) {
    const id = event.currentTarget.dataset.id
    const pattern = getPatternById(id)
    if (!pattern) {
      wx.showToast({
        title: '图纸不存在',
        icon: 'none'
      })
      return
    }

    setCurrentPattern(pattern)
    wx.navigateTo({
      url: '/pages/pattern/pattern?id=' + encodeURIComponent(id)
    })
  },

  createDemo() {
    const pattern = savePattern(createDemoPattern(32))
    setCurrentPattern(pattern)
    wx.navigateTo({
      url: '/pages/pattern/pattern?id=' + encodeURIComponent(pattern.id)
    })
  }
})
