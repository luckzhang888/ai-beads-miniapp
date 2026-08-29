const STORAGE_KEY = 'beadInventory:v1'

function normalizeStock(value) {
  const number = Math.floor(Number(value) || 0)
  return Math.max(0, Math.min(number, 999999))
}

function getInventory() {
  const value = wx.getStorageSync(STORAGE_KEY)
  return value && typeof value === 'object' ? value : {}
}

function saveInventory(inventory) {
  wx.setStorageSync(STORAGE_KEY, inventory)
}

function setStock(code, value) {
  const inventory = getInventory()
  inventory[code] = normalizeStock(value)
  saveInventory(inventory)
  return inventory[code]
}

function adjustStock(code, delta) {
  const inventory = getInventory()
  const next = normalizeStock((inventory[code] || 0) + Number(delta || 0))
  inventory[code] = next
  saveInventory(inventory)
  return next
}

function mergeStatsWithInventory(stats) {
  const inventory = getInventory()

  return stats.map((item) => {
    const stock = normalizeStock(inventory[item.code] || 0)
    const missing = Math.max(0, item.required - stock)
    const remaining = Math.max(0, stock - item.required)

    return Object.assign({}, item, {
      stock,
      missing,
      remaining
    })
  })
}

function canConsumeStats(stats) {
  const merged = mergeStatsWithInventory(stats)
  return {
    ok: merged.every((item) => item.missing === 0),
    items: merged,
    missing: merged.filter((item) => item.missing > 0)
  }
}

function consumeStats(stats) {
  const check = canConsumeStats(stats)
  if (!check.ok) {
    return check
  }

  const inventory = getInventory()
  stats.forEach((item) => {
    inventory[item.code] = normalizeStock((inventory[item.code] || 0) - item.required)
  })
  saveInventory(inventory)

  return {
    ok: true,
    items: mergeStatsWithInventory(stats),
    missing: []
  }
}

module.exports = {
  getInventory,
  saveInventory,
  setStock,
  adjustStock,
  mergeStatsWithInventory,
  canConsumeStats,
  consumeStats
}
