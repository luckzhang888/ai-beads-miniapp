const LEGACY_STORAGE_KEY = 'beadInventory:v1'
const STORAGE_KEY = 'beadInventory:v2'
const SETTINGS_KEY = 'inventorySettings:v1'
const TRANSACTIONS_KEY = 'inventoryTransactions:v1'
const DEFAULT_BRAND = 'MARD'
const MAX_TRANSACTIONS = 100

function normalizeStock(value) {
  const number = Math.floor(Number(value) || 0)
  return Math.max(0, Math.min(number, 999999))
}

function getInventoryStore() {
  const stored = wx.getStorageSync(STORAGE_KEY)
  if (stored && typeof stored === 'object') return stored
  const legacy = wx.getStorageSync(LEGACY_STORAGE_KEY)
  const migrated = { [DEFAULT_BRAND]: legacy && typeof legacy === 'object' ? Object.assign({}, legacy) : {} }
  wx.setStorageSync(STORAGE_KEY, migrated)
  return migrated
}

function saveInventoryStore(store) {
  wx.setStorageSync(STORAGE_KEY, store)
}

function getInventory(brand) {
  const store = getInventoryStore()
  return Object.assign({}, store[brand || DEFAULT_BRAND] || {})
}

function saveInventory(inventory, brand) {
  const targetBrand = brand || DEFAULT_BRAND
  const store = getInventoryStore()
  store[targetBrand] = Object.assign({}, inventory)
  saveInventoryStore(store)
}

function getTransactions() {
  const transactions = wx.getStorageSync(TRANSACTIONS_KEY)
  return Array.isArray(transactions) ? transactions : []
}

function summarizeTransaction(transaction) {
  const items = Array.isArray(transaction && transaction.items) ? transaction.items : []
  const inbound = items.reduce((sum, item) => sum + Math.max(0, Number(item.delta) || 0), 0)
  const outbound = items.reduce((sum, item) => sum + Math.max(0, 0 - (Number(item.delta) || 0)), 0)
  let direction = 'adjust'
  let typeLabel = '库存调整'
  if (inbound > 0 && outbound === 0) {
    direction = 'in'
    typeLabel = '入库'
  } else if (outbound > 0 && inbound === 0) {
    direction = 'out'
    typeLabel = transaction && transaction.type === 'consume' ? '作品出库' : '出库'
  }
  const amountLabel = inbound && outbound
    ? ('+' + inbound + ' / -' + outbound)
    : (inbound ? ('+' + inbound) : ('-' + outbound))
  return { direction, typeLabel, inbound, outbound, amountLabel }
}

function hasConsumedPattern(patternId) {
  return Boolean(patternId && getTransactions().some((item) =>
    item.type === 'consume' && !item.undone && item.metadata && item.metadata.patternId === patternId
  ))
}

function saveTransactions(transactions) {
  wx.setStorageSync(TRANSACTIONS_KEY, transactions.slice(0, MAX_TRANSACTIONS))
}

function recordTransaction(type, items, metadata) {
  const filtered = (items || []).filter((item) => Number(item.delta) !== 0)
  if (!filtered.length) return null
  const transaction = {
    id: 'stock-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
    type,
    createdAt: Date.now(),
    items: filtered.map((item) => ({
      brand: item.brand || DEFAULT_BRAND,
      code: item.code,
      delta: Number(item.delta)
    })),
    metadata: Object.assign({}, metadata || {}),
    undone: false
  }
  const transactions = getTransactions()
  transactions.unshift(transaction)
  saveTransactions(transactions)
  return transaction
}

function setStock(code, value, brand, metadata) {
  const targetBrand = brand || DEFAULT_BRAND
  const inventory = getInventory(targetBrand)
  const previous = normalizeStock(inventory[code] || 0)
  const next = normalizeStock(value)
  inventory[code] = next
  saveInventory(inventory, targetBrand)
  recordTransaction('set', [{ brand: targetBrand, code, delta: next - previous }], metadata)
  return next
}

function adjustStock(code, delta, brand, metadata) {
  const targetBrand = brand || DEFAULT_BRAND
  const inventory = getInventory(targetBrand)
  const previous = normalizeStock(inventory[code] || 0)
  const next = normalizeStock(previous + Number(delta || 0))
  inventory[code] = next
  saveInventory(inventory, targetBrand)
  recordTransaction('adjust', [{ brand: targetBrand, code, delta: next - previous }], metadata)
  return next
}

function batchAdjustStock(items, metadata) {
  const store = getInventoryStore()
  const changes = []
  ;(items || []).forEach((item) => {
    const brand = item.brand || DEFAULT_BRAND
    if (!store[brand]) store[brand] = {}
    const previous = normalizeStock(store[brand][item.code] || 0)
    const next = normalizeStock(previous + Number(item.delta || 0))
    store[brand][item.code] = next
    changes.push({ brand, code: item.code, delta: next - previous })
  })
  saveInventoryStore(store)
  return recordTransaction('batch', changes, metadata)
}

function parseInventoryCsv(text, brand) {
  const merged = {}
  String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line) => {
    const columns = line.trim().split(/[,，;；\t]+/).map((item) => item.trim())
    const code = String(columns[0] || '').toUpperCase()
    const delta = Number(String(columns[1] || '').replace(/[^\d+-.]/g, ''))
    if (!/^[A-Z]+\d+$/.test(code) || !Number.isFinite(delta) || delta === 0) return
    merged[code] = Number(merged[code] || 0) + delta
  })
  return Object.keys(merged).map((code) => ({ brand: brand || DEFAULT_BRAND, code, delta: merged[code] }))
}

function buildRefillList(stats, brand, targetStock, unit) {
  const desired = Math.max(0, Number(targetStock) || 0)
  const refillUnit = Math.max(1, Number(unit) || 1)
  return mergeStatsWithInventory(stats || [], brand).map((item) => {
    const afterUse = Number(item.stock || 0) - Number(item.required || 0)
    const gap = Math.max(0, desired - afterUse)
    const refill = gap ? Math.ceil(gap / refillUnit) * refillUnit : 0
    return Object.assign({}, item, { afterUse, refill })
  }).filter((item) => item.refill > 0)
}

function mergeStatsWithInventory(stats, brand) {
  const inventory = getInventory(brand)
  return stats.map((item) => {
    const stock = normalizeStock(inventory[item.code] || 0)
    const missing = Math.max(0, item.required - stock)
    return Object.assign({}, item, {
      stock,
      missing,
      remaining: Math.max(0, stock - item.required)
    })
  })
}

function canConsumeStats(stats, brand) {
  const merged = mergeStatsWithInventory(stats, brand)
  return {
    ok: merged.every((item) => item.missing === 0),
    items: merged,
    missing: merged.filter((item) => item.missing > 0)
  }
}

function getShortageList(stats, brand) {
  return mergeStatsWithInventory(stats, brand).filter((item) => item.missing > 0)
}

function consumeStats(stats, options) {
  const settings = options || {}
  const brand = settings.brand || DEFAULT_BRAND
  if (settings.patternId) {
    const duplicate = getTransactions().find((item) =>
      item.type === 'consume' && !item.undone && item.metadata && item.metadata.patternId === settings.patternId
    )
    if (duplicate) return { ok: false, duplicate: true, transactionId: duplicate.id, items: [], missing: [] }
  }
  const check = canConsumeStats(stats, brand)
  if (!check.ok) return check

  const inventory = getInventory(brand)
  const changes = []
  stats.forEach((item) => {
    const amount = Math.max(0, Number(item.required) || 0)
    inventory[item.code] = normalizeStock((inventory[item.code] || 0) - amount)
    changes.push({ brand, code: item.code, delta: -amount })
  })
  saveInventory(inventory, brand)
  const transaction = recordTransaction('consume', changes, settings)
  return {
    ok: true,
    items: mergeStatsWithInventory(stats, brand),
    missing: [],
    transactionId: transaction ? transaction.id : ''
  }
}

function undoTransaction(id) {
  const transactions = getTransactions()
  const transaction = transactions.find((item) => item.id === id)
  if (!transaction || transaction.undone) return { ok: false }
  const store = getInventoryStore()
  transaction.items.forEach((item) => {
    if (!store[item.brand]) store[item.brand] = {}
    store[item.brand][item.code] = normalizeStock((store[item.brand][item.code] || 0) - item.delta)
  })
  transaction.undone = true
  transaction.undoneAt = Date.now()
  saveInventoryStore(store)
  saveTransactions(transactions)
  return { ok: true, transaction }
}

function getInventorySettings() {
  const settings = wx.getStorageSync(SETTINGS_KEY)
  return Object.assign({ lowStock: 100, activeBrand: DEFAULT_BRAND }, settings || {})
}

function saveInventorySettings(settings) {
  const next = Object.assign({}, getInventorySettings(), settings || {})
  next.lowStock = Math.max(0, Math.min(999999, Number(next.lowStock) || 0))
  wx.setStorageSync(SETTINGS_KEY, next)
  return next
}

module.exports = {
  DEFAULT_BRAND,
  normalizeStock,
  getInventory,
  saveInventory,
  setStock,
  adjustStock,
  batchAdjustStock,
  parseInventoryCsv,
  buildRefillList,
  mergeStatsWithInventory,
  canConsumeStats,
  getShortageList,
  consumeStats,
  getTransactions,
  summarizeTransaction,
  hasConsumedPattern,
  undoTransaction,
  getInventorySettings,
  saveInventorySettings
}
