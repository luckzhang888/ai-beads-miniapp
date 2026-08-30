const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const {
  createDemoPattern,
  getSavedPatterns,
  getPatternById,
  savePattern,
  setCurrentPattern,
  deletePatterns
} = require('../../utils/pattern')
const { getInventory } = require('../../utils/inventory')

const DEMO_SEEDED_KEY = 'aiDoucangDemoSeeded:v1'
const FOLDERS_KEY = 'aiDoucangFolders:v1'
const DEFAULT_FOLDERS = [
  { id: 'original', title: '原创收藏' },
  { id: 'favorites', title: '灵感图集' }
]

function getFolders() {
  const saved = wx.getStorageSync(FOLDERS_KEY)
  return Array.isArray(saved) && saved.length ? saved : DEFAULT_FOLDERS
}

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  const pad = (value) => value < 10 ? ('0' + value) : String(value)
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate())
}

function seedPatterns() {
  if (getSavedPatterns().length || wx.getStorageSync(DEMO_SEEDED_KEY)) return
  const first = createDemoPattern(32)
  first.name = '薄荷爱心'
  first.tags = ['原创', '萌系']
  first.folderId = 'original'
  first.status = '待拼'
  savePattern(first, mardPalette)

  const second = createDemoPattern(48)
  second.name = '莓果心愿'
  second.tags = ['爱心', '红色']
  second.folderId = 'favorites'
  second.status = '已拼'
  second.completedCount = 1
  savePattern(second, mardPalette)
  wx.setStorageSync(DEMO_SEEDED_KEY, true)
}

Page({
  data: {
    paletteMap: createPaletteMap(mardPalette),
    patterns: [],
    visiblePatterns: [],
    folders: [],
    query: '',
    selectedStatus: '全部',
    statuses: ['全部', '待拼', '正在拼', '已拼', '待发布', '已发布'],
    stats: { folders: 0, working: 0, pending: 0, total: 0 },
    viewMode: 'grid',
    sortMode: 'recent',
    availability: 'all',
    sizeFilter: 'all',
    showFilter: false,
    selectionMode: false,
    selectedIds: [],
    selectedCount: 0,
    selectedFolder: '',
    folderOptions: []
  },

  onShow() {
    seedPatterns()
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh() {
    const patterns = getSavedPatterns().map((item) => {
      const stats = Array.isArray(item.stats) ? item.stats : []
      return Object.assign({}, item, {
        displayTime: formatTime(item.updatedAt),
        colorCount: stats.length,
        beadCount: stats.reduce((sum, color) => sum + Number(color.required || 0), 0),
        status: item.status || (Number(item.completedCount || 0) > 0 ? '已拼' : '待拼')
      })
    })
    const folderOptions = getFolders()
    const folders = folderOptions.map((folder) => {
      const children = patterns.filter((item) => item.folderId === folder.id)
      return Object.assign({}, folder, { count: children.length, cover: children[0] || patterns[0] })
    }).filter((folder) => folder.cover)
    const stats = {
      folders: folders.length,
      working: patterns.filter((item) => item.status === '正在拼').length,
      pending: patterns.filter((item) => item.status === '待拼').length,
      total: patterns.length
    }
    this.setData({ patterns, folders, folderOptions }, () => this.applyFilter())
  },

  onSearch(event) {
    this.setData({ query: event.detail.value }, () => this.applyFilter())
  },

  selectStatus(event) {
    this.setData({ selectedStatus: event.currentTarget.dataset.status }, () => this.applyFilter())
  },

  applyFilter() {
    const query = String(this.data.query || '').trim().toLowerCase()
    const selectedStatus = this.data.selectedStatus
    const stock = getInventory('MARD')
    const selected = new Set(this.data.selectedIds || [])
    let visiblePatterns = this.data.patterns.filter((item) => {
      const tags = Array.isArray(item.tags) ? item.tags : []
      const searchOk = !query || item.name.toLowerCase().indexOf(query) >= 0 ||
        tags.some((tag) => String(tag).toLowerCase().indexOf(query) >= 0)
      const statusOk = selectedStatus === '全部' || item.status === selectedStatus
      const folderOk = !this.data.selectedFolder || item.folderId === this.data.selectedFolder
      const canMake = (item.stats || []).every((color) => Number(stock[color.code] || 0) >= Number(color.required || 0))
      const inventoryOk = this.data.availability !== 'ready' || canMake
      const longest = Math.max(Number(item.width || item.size || 0), Number(item.height || item.size || 0))
      const sizeOk = this.data.sizeFilter === 'all' ||
        (this.data.sizeFilter === '52' && longest <= 52) ||
        (this.data.sizeFilter === '78' && longest > 52 && longest <= 78) ||
        (this.data.sizeFilter === '104' && longest > 78 && longest <= 104) ||
        (this.data.sizeFilter === 'large' && longest > 104)
      item.canMake = canMake
      return searchOk && statusOk && folderOk && inventoryOk && sizeOk
    })
    const mode = this.data.sortMode
    visiblePatterns = visiblePatterns.slice().sort((a, b) => {
      if (mode === 'old') return Number(a.updatedAt || 0) - Number(b.updatedAt || 0)
      if (mode === 'beads-desc') return b.beadCount - a.beadCount
      if (mode === 'beads-asc') return a.beadCount - b.beadCount
      if (mode === 'name') return String(a.name).localeCompare(String(b.name), 'zh-CN')
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
    }).map((item) => Object.assign({}, item, { selected: selected.has(item.id) }))
    this.setData({ visiblePatterns, selectedCount: selected.size })
  },

  openFilter() { this.setData({ showFilter: true }) },
  closeFilter() { this.setData({ showFilter: false }) },

  setViewMode(event) { this.setData({ viewMode: event.currentTarget.dataset.value }) },
  setSortMode(event) { this.setData({ sortMode: event.currentTarget.dataset.value }) },
  setAvailability(event) { this.setData({ availability: event.currentTarget.dataset.value }) },
  setSizeFilter(event) { this.setData({ sizeFilter: event.currentTarget.dataset.value }) },

  resetFilter() {
    this.setData({ viewMode: 'grid', sortMode: 'recent', availability: 'all', sizeFilter: 'all' })
  },

  applyFilterPanel() {
    this.setData({ showFilter: false }, () => this.applyFilter())
  },

  enterSelection(event) {
    const id = event.currentTarget.dataset.id
    this.setData({ selectionMode: true, selectedIds: id ? [id] : [] }, () => this.applyFilter())
  },

  exitSelection() {
    this.setData({ selectionMode: false, selectedIds: [], selectedCount: 0 }, () => this.applyFilter())
  },

  toggleManagement() {
    if (this.data.selectionMode) this.exitSelection()
    else this.enterSelection({ currentTarget: { dataset: {} } })
  },

  toggleSelection(event) {
    const id = event.currentTarget.dataset.id
    const selected = new Set(this.data.selectedIds || [])
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    this.setData({ selectedIds: Array.from(selected) }, () => this.applyFilter())
  },

  selectAllVisible() {
    const visibleIds = this.data.visiblePatterns.map((item) => item.id)
    const selected = new Set(this.data.selectedIds || [])
    const allSelected = visibleIds.length && visibleIds.every((id) => selected.has(id))
    visibleIds.forEach((id) => allSelected ? selected.delete(id) : selected.add(id))
    this.setData({ selectedIds: Array.from(selected) }, () => this.applyFilter())
  },

  selectFolder(event) {
    const folder = event.currentTarget.dataset.folder
    this.setData({ selectedFolder: this.data.selectedFolder === folder ? '' : folder }, () => this.applyFilter())
  },

  createFolder() {
    wx.showModal({
      title: '创建文件夹',
      editable: true,
      placeholderText: '请输入文件夹名称',
      success: (result) => {
        const title = String(result.content || '').trim().slice(0, 12)
        if (!result.confirm || !title) return
        const folders = getFolders()
        folders.push({ id: 'folder-' + Date.now(), title })
        wx.setStorageSync(FOLDERS_KEY, folders)
        this.refresh()
      }
    })
  },

  moveSelected() {
    const ids = this.data.selectedIds || []
    if (!ids.length) {
      wx.showToast({ title: '请先选择图纸', icon: 'none' })
      return
    }
    const folders = getFolders()
    wx.showActionSheet({
      itemList: folders.map((item) => item.title),
      success: (result) => {
        const folder = folders[result.tapIndex]
        if (!folder) return
        ids.forEach((id) => {
          const pattern = getPatternById(id)
          if (pattern) savePattern(Object.assign({}, pattern, { folderId: folder.id }), mardPalette)
        })
        this.exitSelection()
        this.refresh()
        wx.showToast({ title: '已移动到' + folder.title, icon: 'success' })
      }
    })
  },

  bulkDelete() {
    const ids = this.data.selectedIds || []
    if (!ids.length) {
      wx.showToast({ title: '请先选择图纸', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删除 ' + ids.length + ' 张图纸？',
      content: '删除后无法恢复，豆仓库存不会受到影响。',
      confirmText: '删除',
      confirmColor: '#e54b5f',
      success: (result) => {
        if (!result.confirm) return
        deletePatterns(ids)
        this.setData({ selectionMode: false, selectedIds: [], selectedCount: 0 })
        this.refresh()
        wx.showToast({ title: '已删除 ' + ids.length + ' 张', icon: 'success' })
      }
    })
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/convert/convert' })
  },

  goInventory() {
    wx.navigateTo({ url: '/pages/inventory/inventory' })
  },

  noop() {},

  showComingSoon(event) {
    wx.showToast({ title: event.currentTarget.dataset.name + '即将开放', icon: 'none' })
  },

  openPattern(event) {
    const id = event.currentTarget.dataset.id
    if (this.data.selectionMode) {
      this.toggleSelection(event)
      return
    }
    const pattern = getPatternById(id)
    if (!pattern) {
      wx.showToast({ title: '图纸不存在', icon: 'none' })
      this.refresh()
      return
    }
    setCurrentPattern(pattern)
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(id) })
  }
})
