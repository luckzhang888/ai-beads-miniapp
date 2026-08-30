const ROUTES = {
  inventory: '/pages/inventory/inventory',
  patterns: '/pages/patterns/patterns',
  inspiration: '/pages/inspiration/inspiration',
  records: '/pages/records/records',
  profile: '/pages/profile/profile'
}

Component({
  properties: {
    active: { type: String, value: 'patterns' }
  },

  data: {
    appName: '豆仓助手',
    items: [
      { id: 'inventory', label: '豆仓' },
      { id: 'patterns', label: '图纸册' },
      { id: 'inspiration', label: '灵感库' },
      { id: 'records', label: '记录' },
      { id: 'profile', label: '我的' }
    ]
  },

  lifetimes: {
    attached() {
      const app = typeof getApp === 'function' ? getApp() : null
      const appName = app && app.globalData && app.globalData.appName
      if (appName && appName !== this.data.appName) this.setData({ appName })
    }
  },

  methods: {
    navigate(event) {
      const id = event.currentTarget.dataset.id
      const url = ROUTES[id]
      if (!url || id === this.data.active) return
      wx.redirectTo({
        url,
        fail: () => wx.navigateTo({ url })
      })
    }
  }
})
