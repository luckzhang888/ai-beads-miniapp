const { getSavedPatterns } = require('../../utils/pattern')
const { getInventory, getTransactions, getInventorySettings, saveInventorySettings } = require('../../utils/inventory')
const { getActivities } = require('../../utils/activity')

Page({
  data: {
    appName: '豆仓助手',
    version: '0.5.1',
    patternCount: 0,
    totalStock: 0,
    recordCount: 0,
    lowStock: 100
  },

  onShow() {
    const app = typeof getApp === 'function' ? getApp() : null
    const inventory = getInventory('MARD')
    const settings = getInventorySettings()
    this.setData({
      appName: app && app.globalData && app.globalData.appName ? app.globalData.appName : '豆仓助手',
      patternCount: getSavedPatterns().length,
      totalStock: Object.keys(inventory).reduce((sum, code) => sum + Number(inventory[code] || 0), 0),
      recordCount: getTransactions().length + getActivities().length,
      lowStock: Number(settings.lowStock) || 0
    })
  },

  openRoute(event) {
    const routes = {
      import: '/pages/convert/convert',
      inventory: '/pages/inventory/inventory',
      records: '/pages/records/records'
    }
    const url = routes[event.currentTarget.dataset.route]
    if (url) wx.navigateTo({ url })
  },

  setLowStock() {
    wx.showModal({
      title: '低库存提醒',
      editable: true,
      content: String(this.data.lowStock),
      placeholderText: '例如 100',
      success: (result) => {
        if (!result.confirm) return
        const lowStock = Math.max(0, Math.floor(Number(result.content) || 0))
        saveInventorySettings({ lowStock })
        this.setData({ lowStock })
      }
    })
  },

  showAbout() {
    wx.showModal({
      title: this.data.appName + ' v' + this.data.version,
      content: '本地保存图纸、库存、拼豆计时和操作记录。图片识别在设备端完成，不上传微信私钥或 GitHub 凭据。',
      showCancel: false
    })
  }
})
