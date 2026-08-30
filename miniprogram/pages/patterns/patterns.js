const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const {
  createDemoPattern,
  getSavedPatterns,
  getPatternById,
  savePattern,
  setCurrentPattern,
  deletePatterns,
  movePatternsFromFolder
} = require('../../utils/pattern')
const {
  getInventory,
  batchAdjustStock,
  canConsumeStats,
  consumeStats,
  hasConsumedPattern,
  undoTransaction
} = require('../../utils/inventory')

const DEMO_SEEDED_KEY = 'aiDoucangDemoSeeded:v1'
const FOLDERS_KEY = 'aiDoucangFolders:v1'
const DEFAULT_FOLDERS = [
  { id: 'original', title: '原创收藏' },
  { id: 'favorites', title: '灵感图集' }
]

function getFolders() {
  const saved = wx.getStorageSync(FOLDERS_KEY)
  return Array.isArray(saved) ? saved : DEFAULT_FOLDERS.map((item) => Object.assign({}, item))
}

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  const pad = (value) => value < 10 ? ('0' + value) : String(value)
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate())
}

function combinePatternStats(patterns) {
  const totals = {}
  ;(patterns || []).forEach((pattern) => {
    ;(pattern.stats || []).forEach((item) => {
      if (!totals[item.code]) totals[item.code] = { code: item.code, required: 0 }
      totals[item.code].required += Math.max(0, Number(item.required) || 0)
    })
  })
  return Object.keys(totals).map((code) => totals[code])
}

function seedPatterns() {
  if (getSavedPatterns().length || wx.getStorageSync(DEMO_SEEDED_KEY)) return
  const first = createDemoPattern(32)
  first.id = 'demo-mint-heart'
  first.name = '薄荷爱心'
  first.tags = ['原创', '萌系']
  first.folderId = 'original'
  first.status = '待拼'
  savePattern(first, mardPalette)

  const second = createDemoPattern(48)
  second.id = 'demo-berry-wish'
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
    folderOptions: [],
    showFolderManager: false
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
      return Object.assign({}, folder, { count: children.length, cover: children[0] || null })
    })
    const stats = {
      folders: folders.length,
      working: patterns.filter((item) => item.status === '正在拼').length,
      pending: patterns.filter((item) => item.status === '待拼').length,
      total: patterns.length
    }
    this.setData({ patterns, folders, folderOptions, stats }, () => this.applyFilter())
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
    if (this._folderLongPressedAt && Date.now() - this._folderLongPressedAt < 450) return
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
        if (folders.some((item) => item.title === title)) {
          wx.showToast({ title: '已有同名文件夹', icon: 'none' })
          return
        }
        folders.push({ id: 'folder-' + Date.now(), title })
        wx.setStorageSync(FOLDERS_KEY, folders)
        this.refresh()
      }
    })
  },

  openFolderManager() { this.setData({ showFolderManager: true }) },
  closeFolderManager() { this.setData({ showFolderManager: false }) },
  noop() {},

  saveFolderOrder(folders, message) {
    wx.setStorageSync(FOLDERS_KEY, folders.map((item) => ({ id: item.id, title: item.title })))
    this.refresh()
    if (message) wx.showToast({ title: message, icon: 'success' })
  },

  moveFolderTo(folderId, targetIndex) {
    const folders = getFolders()
    const sourceIndex = folders.findIndex((item) => item.id === folderId)
    if (sourceIndex < 0 || folders.length < 2) return false
    const boundedTarget = Math.max(0, Math.min(folders.length - 1, Number(targetIndex)))
    if (boundedTarget === sourceIndex) return false
    const moved = folders.splice(sourceIndex, 1)[0]
    folders.splice(boundedTarget, 0, moved)
    this.saveFolderOrder(folders, '文件夹顺序已更新')
    return true
  },

  moveFolderStep(event) {
    const dataset = event.currentTarget.dataset || {}
    const folderId = String(dataset.folderId || '')
    const folders = getFolders()
    const index = folders.findIndex((item) => item.id === folderId)
    if (index < 0) return
    this.moveFolderTo(folderId, index + Number(dataset.delta || 0))
  },

  manageFolderPosition(event) {
    const folderId = String(event.currentTarget.dataset.folder || '')
    const folders = getFolders()
    const index = folders.findIndex((item) => item.id === folderId)
    if (index < 0) return
    this._folderLongPressedAt = Date.now()

    const actions = []
    if (index > 0) {
      if (index > 1) actions.push({ label: '移到最前', target: 0 })
      actions.push({ label: '向左移动', target: index - 1 })
    }
    if (index < folders.length - 1) {
      actions.push({ label: '向右移动', target: index + 1 })
      if (index < folders.length - 2) actions.push({ label: '移到最后', target: folders.length - 1 })
    }
    actions.push({ label: '删除文件夹', remove: true })

    wx.showActionSheet({
      itemList: actions.map((item) => item.label),
      success: (result) => {
        const action = actions[result.tapIndex]
        if (!action) return
        if (action.remove) {
          this.deleteFolder({ currentTarget: { dataset: { folderId } } })
          return
        }
        this.moveFolderTo(folderId, action.target)
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
      itemList: ['移出文件夹'].concat(folders.map((item) => item.title)),
      success: (result) => {
        const folder = result.tapIndex === 0 ? null : folders[result.tapIndex - 1]
        if (result.tapIndex > 0 && !folder) return
        ids.forEach((id) => {
          const pattern = getPatternById(id)
          if (pattern) savePattern(Object.assign({}, pattern, { folderId: folder ? folder.id : '' }), mardPalette)
        })
        this.exitSelection()
        this.refresh()
        wx.showToast({ title: folder ? ('已移动到' + folder.title) : '已移出文件夹', icon: 'success' })
      }
    })
  },

  deleteFolder(event) {
    const dataset = event && event.currentTarget ? event.currentTarget.dataset || {} : {}
    const folderId = String(dataset.folderId || dataset.folder || '')
    const folder = getFolders().find((item) => item.id === folderId)
    if (!folder) {
      wx.showToast({ title: '文件夹不存在，请刷新', icon: 'none' })
      this.refresh()
      return
    }
    const count = this.data.patterns.filter((item) => item.folderId === folderId).length
    wx.showModal({
      title: '删除文件夹“' + folder.title + '”？',
      content: count ? ('其中 ' + count + ' 张图纸会移到根目录，图纸本身不会删除。') : '这是一个空文件夹。',
      confirmText: '删除',
      confirmColor: '#e54b5f',
      success: (result) => {
        if (!result.confirm) return
        try {
          const moved = movePatternsFromFolder(folderId, '')
          const remainingFolders = getFolders().filter((item) => item.id !== folderId)
          wx.setStorageSync(FOLDERS_KEY, remainingFolders)
          if (getFolders().some((item) => item.id === folderId)) throw new Error('folder persistence check failed')

          const afterDelete = () => {
            this.refresh()
            wx.showToast({ title: moved.updated ? '已删除，图纸已移出' : '文件夹已删除', icon: 'success' })
          }
          if (this.data.selectedFolder === folderId) this.setData({ selectedFolder: '' }, afterDelete)
          else afterDelete()
        } catch (error) {
          console.error('delete folder failed', error)
          this.refresh()
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        }
      },
      fail: (error) => {
        console.error('open delete folder modal failed', error)
        wx.showToast({ title: '无法确认删除，请重试', icon: 'none' })
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

  getSelectedPatterns() {
    const selected = new Set(this.data.selectedIds || [])
    return this.data.patterns.filter((item) => selected.has(item.id))
  },

  setSelectedStatus() {
    const patterns = this.getSelectedPatterns()
    if (!patterns.length) {
      wx.showToast({ title: '请先选择图纸', icon: 'none' })
      return
    }
    const statuses = ['待拼', '正在拼', '已拼', '待发布', '已发布']
    wx.showActionSheet({
      itemList: statuses,
      success: (result) => {
        const status = statuses[result.tapIndex]
        if (!status) return
        patterns.forEach((pattern) => savePattern(Object.assign({}, pattern, { status }), mardPalette))
        this.exitSelection()
        this.refresh()
        wx.showToast({ title: '已更新为' + status, icon: 'success' })
      }
    })
  },

  manageSelectedStock() {
    const patterns = this.getSelectedPatterns()
    if (!patterns.length) {
      wx.showToast({ title: '请先选择图纸', icon: 'none' })
      return
    }
    const actions = ['按图纸用量入库', '按图纸用量领料出库', '撤销已出库并退料']
    wx.showActionSheet({
      itemList: actions,
      success: (result) => {
        if (result.tapIndex === 0) this.inboundSelectedPatterns(patterns)
        if (result.tapIndex === 1) this.outboundSelectedPatterns(patterns)
        if (result.tapIndex === 2) this.undoSelectedOutbound(patterns)
      }
    })
  },

  inboundSelectedPatterns(patterns) {
    const stats = combinePatternStats(patterns)
    const total = stats.reduce((sum, item) => sum + item.required, 0)
    wx.showModal({
      title: '图纸用量入库',
      content: '将 ' + patterns.length + ' 张图纸的 ' + stats.length + ' 个色号、共 ' + total + ' 粒加入库存，并生成关联记录。',
      confirmText: '确认入库',
      success: (result) => {
        if (!result.confirm) return
        const single = patterns.length === 1 ? patterns[0] : null
        batchAdjustStock(stats.map((item) => ({ brand: 'MARD', code: item.code, delta: item.required })), {
          source: 'pattern-management-inbound',
          patternId: single ? single.id : '',
          patternName: single ? single.name : (patterns.length + ' 张图纸')
        })
        this.exitSelection()
        this.refresh()
        wx.showToast({ title: '图纸用量已入库', icon: 'success' })
      }
    })
  },

  outboundSelectedPatterns(patterns) {
    const pending = patterns.filter((pattern) => !hasConsumedPattern(pattern.id))
    if (!pending.length) {
      wx.showToast({ title: '所选图纸均已出库', icon: 'none' })
      return
    }
    const stats = combinePatternStats(pending)
    const check = canConsumeStats(stats, 'MARD')
    if (!check.ok) {
      const missing = check.missing.slice(0, 5).map((item) => item.code + ' 缺 ' + item.missing).join('、')
      wx.showModal({ title: '库存不足', content: missing + (check.missing.length > 5 ? ' 等' : ''), showCancel: false })
      return
    }
    wx.showModal({
      title: '按图纸用量出库',
      content: '将为 ' + pending.length + ' 张图纸领料出库；每张图纸都会生成可撤销的关联记录。',
      confirmText: '确认出库',
      success: (result) => {
        if (!result.confirm) return
        let completed = 0
        pending.forEach((pattern) => {
          const consumed = consumeStats(pattern.stats || [], {
            brand: pattern.brand || 'MARD',
            patternId: pattern.id,
            patternName: pattern.name,
            source: 'pattern-management-outbound'
          })
          if (!consumed.ok) return
          savePattern(Object.assign({}, pattern, {
            status: pattern.status === '待拼' ? '正在拼' : pattern.status,
            inventoryConsumed: true,
            lastConsumeTransactionId: consumed.transactionId
          }), mardPalette)
          completed += 1
        })
        this.exitSelection()
        this.refresh()
        wx.showToast({ title: '已出库 ' + completed + ' 张', icon: 'success' })
      }
    })
  },

  undoSelectedOutbound(patterns) {
    const consumed = patterns.filter((pattern) => pattern.lastConsumeTransactionId && pattern.inventoryConsumed)
    if (!consumed.length) {
      wx.showToast({ title: '所选图纸没有可撤销出库', icon: 'none' })
      return
    }
    wx.showModal({
      title: '撤销图纸出库',
      content: '将退回 ' + consumed.length + ' 张图纸对应的拼豆库存，原出库记录会标记为已撤销。',
      confirmText: '确认退料',
      success: (result) => {
        if (!result.confirm) return
        let undoneCount = 0
        consumed.forEach((pattern) => {
          const undone = undoTransaction(pattern.lastConsumeTransactionId)
          if (!undone.ok) return
          savePattern(Object.assign({}, pattern, {
            status: pattern.status === '正在拼' ? '待拼' : pattern.status,
            inventoryConsumed: false,
            lastConsumeTransactionId: ''
          }), mardPalette)
          undoneCount += 1
        })
        this.exitSelection()
        this.refresh()
        wx.showToast({ title: '已退料 ' + undoneCount + ' 张', icon: 'success' })
      }
    })
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/records/records' })
  },

  noop() {},

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
