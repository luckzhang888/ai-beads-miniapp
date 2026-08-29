const demoPalette = require('../data/colors/demo')
const { buildStats } = require('./color-match')

const CURRENT_KEY = 'currentPattern:v1'
const PATTERNS_KEY = 'savedPatterns:v1'
const MAX_PATTERNS = 20

function countMatrix(matrix) {
  const counts = Object.create(null)
  matrix.forEach((row) => {
    row.forEach((code) => {
      counts[code] = (counts[code] || 0) + 1
    })
  })
  return counts
}

function createPattern(options) {
  const matrix = options.matrix
  const palette = options.palette || demoPalette
  const stats = options.stats || buildStats(countMatrix(matrix), palette)

  return {
    id: options.id || ('pattern-' + Date.now()),
    name: options.name || ('拼豆图纸 ' + new Date().toLocaleString()),
    createdAt: options.createdAt || Date.now(),
    updatedAt: Date.now(),
    size: matrix.length,
    brand: options.brand || 'DEMO',
    matrix,
    stats
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
      if (heart <= 0) {
        code = 'D05'
      }
      if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) {
        code = 'D01'
      }
      row.push(code)
    }
    matrix.push(row)
  }

  return createPattern({
    id: 'demo-' + Date.now(),
    name: '示例爱心图纸',
    matrix,
    palette: demoPalette,
    brand: 'DEMO'
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

function savePattern(pattern) {
  const patterns = getSavedPatterns()
  const index = patterns.findIndex((item) => item.id === pattern.id)
  const next = Object.assign({}, pattern, { updatedAt: Date.now() })

  if (index >= 0) {
    patterns.splice(index, 1)
  }
  patterns.unshift(next)

  wx.setStorageSync(PATTERNS_KEY, patterns.slice(0, MAX_PATTERNS))
  setCurrentPattern(next)
  return next
}

function getPatternById(id) {
  if (!id) {
    return null
  }
  return getSavedPatterns().find((item) => item.id === id) || null
}

function mirrorHorizontal(matrix) {
  return matrix.map((row) => row.slice().reverse())
}

module.exports = {
  createPattern,
  createDemoPattern,
  setCurrentPattern,
  getCurrentPattern,
  getSavedPatterns,
  savePattern,
  getPatternById,
  mirrorHorizontal
}
