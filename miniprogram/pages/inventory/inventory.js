const demoPalette = require('../../data/colors/demo')
const { getInventory, setStock, adjustStock } = require('../../utils/inventory')

Page({
  data: {
    query: '',
    rows: []
  },

  onShow() {
    this.refresh()
  },

  buildRows() {
    const inventory = getInventory()
    return demoPalette.map((item) => {
      return Object.assign({}, item, {
        stock: Number(inventory[item.code] || 0)
      })
    })
  },

  refresh() {
    const allRows = this.buildRows()
    this.allRows = allRows
    this.applyFilter(this.data.query)
  },

  applyFilter(query) {
    const keyword = String(query || '').trim().toLowerCase()
    const source = this.allRows || this.buildRows()
    const rows = keyword
      ? source.filter((item) => {
          return item.code.toLowerCase().indexOf(keyword) >= 0 ||
            item.name.toLowerCase().indexOf(keyword) >= 0
        })
      : source

    this.setData({ rows })
  },

  onSearchInput(event) {
    const query = event.detail.value
    this.setData({ query })
    this.applyFilter(query)
  },

  adjust(event) {
    const code = event.currentTarget.dataset.code
    const delta = Number(event.currentTarget.dataset.delta)
    adjustStock(code, delta)
    this.refresh()
  },

  setExactStock(event) {
    const code = event.currentTarget.dataset.code
    setStock(code, event.detail.value)
    this.refresh()
  }
})
