const mardPalette = require('../data/colors/mard')
const { buildStats } = require('./color-match')

const CURRENT_KEY = 'currentPattern:v1'
const PATTERNS_KEY = 'savedPatterns:v1'
const MAX_PATTERNS = 50

function cloneMatrix(matrix) {
  return Array.isArray(matrix) ? matrix.map((row) => row.slice()) : []
}

function countMatrix(matrix) {
  const counts = Object.create(null)
  matrix.forEach((row) => {
    row.forEach((code) => {
      counts[code] = (counts[code] || 0) + 1
    })
  })
  return counts
}

function rebuildStats(matrix, palette) {
  return buildStats(countMatrix(matrix), palette || mardPalette)
}

function createPattern(options) {
  const matrix = cloneMatrix(options.matrix || [])
  const palette = options.palette || mardPalette
  const stats = options.stats || rebuildStats(matrix, palette)

  return {
    id: options.id || ('pattern-' + Date.now()),
    name: options.name || ('拼豆图纸 ' + new Date().toLocaleString()),
    createdAt: options.createdAt || Date.now(),
    updatedAt: Date.now(),
    size: matrix.length,
    brand: options.brand || 'MARD',
    matrix,
    stats,
    completedCount: Number(options.completedCount || 0)
  }
}

function createDemoPattern(size) {
  const n = size || 32
  const matrix = []

  for (let y = 0; y < n; y += 1) {
    const row = []
    for (let x = 0; x < n; x += 1) {
      const nx = (x / (n - 1)) * 2 - 1
      const ny = ((n - 1 - y) / (n - 1)) * 2 - 1
      const heart = Math.pow(nx * nx + ny * ny - 0.72, 3) -
        nx * nx * Math.pow(ny, 3)

      let code = 'D26'
      if (heart <= 0) code = 'F5'
      if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) code = 'H2'
      row.push(code)
    }
    matrix.push(row)
  }

  return createPattern({
    id: 'demo-' + Date.now(),
    name: 'MARD 示例爱心图纸',
    matrix,
    palette: mardPalette,
    brand: 'MARD'
  })
}

function setCurrentPattern(pattern) {
  wx.setStorageSync(CURRENT_KEY, pattern)
}

function getCurrentPattern() {
  return wx.getStorageSync(CURRENT_KEY) || null
}

function getSavedPatterns() {
  const patterns = wx.getStorageSync(PATTERNS_KEY)
  return Array.isArray(patterns) ? patterns : []
}

function savePattern(pattern, palette) {
  const patterns = getSavedPatterns()
  const index = patterns.findIndex((item) => item.id === pattern.id)
  const matrix = cloneMatrix(pattern.matrix)
  const next = Object.assign({}, pattern, {
    matrix,
    size: matrix.length,
    stats: rebuildStats(matrix, palette || mardPalette),
    updatedAt: Date.now()
  })

  if (index >= 0) patterns.splice(index, 1)
  patterns.unshift(next)

  wx.setStorageSync(PATTERNS_KEY, patterns.slice(0, MAX_PATTERNS))
  setCurrentPattern(next)
  return next
}

function getPatternById(id) {
  if (!id) return null
  return getSavedPatterns().find((item) => item.id === id) || null
}

function deletePattern(id) {
  const patterns = getSavedPatterns().filter((item) => item.id !== id)
  wx.setStorageSync(PATTERNS_KEY, patterns)
  const current = getCurrentPattern()
  if (current && current.id === id) wx.removeStorageSync(CURRENT_KEY)
  return patterns
}

function renamePattern(id, name) {
  const cleanName = String(name || '').trim().slice(0, 30)
  if (!cleanName) return null
  const pattern = getPatternById(id)
  if (!pattern) return null
  return savePattern(Object.assign({}, pattern, { name: cleanName }), mardPalette)
}

function duplicatePattern(id) {
  const pattern = getPatternById(id)
  if (!pattern) return null
  return savePattern(createPattern({
    name: pattern.name + ' 副本',
    matrix: pattern.matrix,
    brand: pattern.brand || 'MARD',
    completedCount: 0
  }), mardPalette)
}

function mirrorHorizontal(matrix) {
  return cloneMatrix(matrix).map((row) => row.reverse())
}

function mirrorVertical(matrix) {
  return cloneMatrix(matrix).reverse()
}

function rotate90(matrix) {
  const source = cloneMatrix(matrix)
  const n = source.length
  if (!n) return []
  const result = Array.from({ length: n }, () => new Array(n))
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      result[x][n - 1 - y] = source[y][x]
    }
  }
  return result
}

function setCell(matrix, x, y, code) {
  const next = cloneMatrix(matrix)
  if (!next[y] || typeof next[y][x] === 'undefined') return next
  next[y][x] = code
  return next
}

function replaceColor(matrix, fromCode, toCode) {
  if (!fromCode || !toCode || fromCode === toCode) return cloneMatrix(matrix)
  return matrix.map((row) => row.map((code) => code === fromCode ? toCode : code))
}

function floodFill(matrix, x, y, toCode) {
  const next = cloneMatrix(matrix)
  if (!next[y] || typeof next[y][x] === 'undefined') return next

  const fromCode = next[y][x]
  if (fromCode === toCode) return next

  const height = next.length
  const width = next[0].length
  const queue = [[x, y]]
  next[y][x] = toCode

  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index]
    const px = point[0]
    const py = point[1]
    const neighbors = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]

    neighbors.forEach((neighbor) => {
      const nx = neighbor[0]
      const ny = neighbor[1]
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && next[ny][nx] === fromCode) {
        next[ny][nx] = toCode
        queue.push([nx, ny])
      }
    })
  }

  return next
}

module.exports = {
  cloneMatrix,
  countMatrix,
  rebuildStats,
  createPattern,
  createDemoPattern,
  setCurrentPattern,
  getCurrentPattern,
  getSavedPatterns,
  savePattern,
  getPatternById,
  deletePattern,
  renamePattern,
  duplicatePattern,
  mirrorHorizontal,
  mirrorVertical,
  rotate90,
  setCell,
  replaceColor,
  floodFill
}
