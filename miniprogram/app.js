const { getInventory } = require('./utils/inventory')

App({
  globalData: {
    appName: 'AI豆仓',
    paletteName: 'MARD 221'
  },

  onLaunch() {
    // Reading once migrates legacy flat inventory to the brand-aware v2 store.
    getInventory('MARD')
  }
})
