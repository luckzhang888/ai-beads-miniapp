App({
  globalData: {
    appName: 'AI 豆仓',
    paletteName: 'DEMO'
  },

  onLaunch() {
    const inventory = wx.getStorageSync('beadInventory:v1')
    if (!inventory) {
      wx.setStorageSync('beadInventory:v1', {})
    }
  }
})
