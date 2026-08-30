const { getInventory } = require('./utils/inventory')

App({
  globalData: {
    appName: '豆仓助手',
    paletteName: 'MARD 295'
  },

  onLaunch() {
    // Reading once migrates legacy flat inventory to the brand-aware v2 store.
    getInventory('MARD')
  }
})
