const { getInventory } = require('./utils/inventory')
const cloudConfig = require('./config/cloud')

App({
  globalData: {
    appName: '豆仓助手',
    paletteName: 'MARD 221'
  },

  onLaunch() {
    if (wx.cloud && typeof wx.cloud.init === 'function') {
      const options = { traceUser: true }
      if (cloudConfig.cloudEnvId) options.env = cloudConfig.cloudEnvId
      wx.cloud.init(options)
      this.globalData.cloudReady = true
    } else {
      this.globalData.cloudReady = false
      console.warn('当前微信基础库不支持云开发，请升级微信后重试。')
    }
    // Reading once migrates legacy flat inventory to the brand-aware v2 store.
    getInventory('MARD')
  }
})
