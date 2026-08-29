App({
  globalData: {
    appName: 'AI 豆仓',
    paletteName: 'MARD 221'
  },

  onLaunch() {
    const inventory = wx.getStorageSync('beadInventory:v1')
    if (!inventory) {
      wx.setStorageSync('beadInventory:v1', {})
    }
  }
})
