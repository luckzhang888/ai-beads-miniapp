const mardPalette = require('../data/colors/mard')
const { buildStats } = require('./color-match')
const patternStorage = require('./pattern-storage')
const { getSavedPatterns, getPatternById, getCurrentPattern, setCurrentPattern, deletePatterns, showStorageError } = patternStorage
let patternSequence = 0

function nextPatternId(prefix) {
  patternSequence += 1
  return (prefix || 'pattern') + '-' + Date.now() + '-' + patternSequence
}

function cloneMatrix(matrix) {
  return Array.isArray(matrix) ? matrix.map((row) => row.slice()) : []
}

function getDimensions(matrix) {
  const height = Array.isArray(matrix) ? matrix.length : 0
  const width = height && Array.isArray(matrix[0]) ? matrix[0].length : 0
  return { width, height }
}

function countMatrix(matrix) {
  const counts = Object.create(null)
  matrix.forEach((row) => {
    row.forEach((code) => {
      if (!code) return
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
  const dims = getDimensions(matrix)

  return {
    id: options.id || nextPatternId(),
    name: options.name || ('拼豆图纸 ' + new Date().toLocaleString()),
    createdAt: options.createdAt || Date.now(),
    updatedAt: Date.now(),
    size: Math.min(dims.width, dims.height),
    width: Number(options.width) || dims.width,
    height: Number(options.height) || dims.height,
    brand: options.brand || 'MARD',
    qualityMode: options.qualityMode || 'balanced',
    matrix,
    stats,
    completedCount: Number(options.completedCount || 0),
    status: options.status || '待拼',
    tags: Array.isArray(options.tags) ? options.tags.slice(0, 8) : [],
    completedCodes: Array.isArray(options.completedCodes) ? options.completedCodes.slice() : [],
    completedCellIndices: Array.isArray(options.completedCellIndices) ? options.completedCellIndices.slice() : [],
    lockedCodes: Array.isArray(options.lockedCodes) ? options.lockedCodes.slice() : [],
    viewState: options.viewState && typeof options.viewState === 'object' ? Object.assign({}, options.viewState) : {},
    sourceOptions: options.sourceOptions && typeof options.sourceOptions === 'object' ? Object.assign({}, options.sourceOptions) : {},
    inventoryConsumed: Boolean(options.inventoryConsumed),
    lastConsumeTransactionId: options.lastConsumeTransactionId || ''
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
      const heart = Math.pow(nx * nx + ny * ny - 0.72, 3) - nx * nx * Math.pow(ny, 3)
      let code = 'D26'
      if (heart <= 0) code = 'F5'
      if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) code = 'H2'
      row.push(code)
    }
    matrix.push(row)
  }

  return createPattern({
    id: nextPatternId('demo'),
    name: 'MARD 示例爱心图纸',
    matrix,
    palette: mardPalette,
    brand: 'MARD'
  })
}

function normalizePattern(pattern, palette) {
  const matrix = cloneMatrix(pattern.matrix || [])
  const dims = getDimensions(matrix)
  return Object.assign({}, pattern, {
    matrix,
    size: Math.min(dims.width, dims.height),
    width: dims.width,
    height: dims.height,
    stats: rebuildStats(matrix, palette || mardPalette),
    status: pattern.status || (Number(pattern.completedCount || 0) > 0 ? '已拼' : '待拼'),
    tags: Array.isArray(pattern.tags) ? pattern.tags.slice(0, 8) : [],
    completedCodes: Array.isArray(pattern.completedCodes) ? pattern.completedCodes.slice() : [],
    completedCellIndices: Array.isArray(pattern.completedCellIndices)
      ? pattern.completedCellIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < dims.width * dims.height)
      : [],
    lockedCodes: Array.isArray(pattern.lockedCodes) ? pattern.lockedCodes.slice() : [],
    viewState: pattern.viewState && typeof pattern.viewState === 'object' ? Object.assign({}, pattern.viewState) : {},
    sourceOptions: pattern.sourceOptions && typeof pattern.sourceOptions === 'object' ? Object.assign({}, pattern.sourceOptions) : {},
    inventoryConsumed: Boolean(pattern.inventoryConsumed),
    lastConsumeTransactionId: pattern.lastConsumeTransactionId || '',
    updatedAt: Date.now()
  })
}

function savePattern(pattern, palette) {
  const next = normalizePattern(pattern, palette)
  patternStorage.writePatterns([next], true)
  return next
}

function savePatterns(patterns, palette) {
  const next = patterns.map((pattern) => normalizePattern(pattern, palette))
  patternStorage.writePatterns(next, true)
  return next
}

function trySavePattern(pattern, palette) {
  try { return savePattern(pattern, palette) } catch (error) {
    showStorageError(error)
    return null
  }
}

function trySavePatterns(patterns, palette) {
  try { return savePatterns(patterns, palette) } catch (error) {
    showStorageError(error)
    return null
  }
}

function deletePattern(id) {
  return deletePatterns([id])
}

function movePatternsFromFolder(folderId, nextFolderId) {
  const sourceId = String(folderId || '')
  const targetId = String(nextFolderId || '')
  const patterns = getSavedPatterns()
  if (!sourceId) return { updated: 0, patterns }

  const updatedAt = Date.now()
  const changed = []
  const nextPatterns = patterns.map((item) => {
    if (String(item.folderId || '') !== sourceId) return item
    const next = Object.assign({}, item, { folderId: targetId, updatedAt })
    changed.push(next)
    return next
  })

  if (!changed.length) return { updated: 0, patterns }
  patternStorage.writePatterns(changed, false)
  return { updated: changed.length, patterns: nextPatterns }
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
    qualityMode: pattern.qualityMode || 'balanced',
    completedCount: 0,
    completedCodes: [],
    completedCellIndices: [],
    inventoryConsumed: false,
    lastConsumeTransactionId: ''
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
  const height = source.length
  const width = height && source[0] ? source[0].length : 0
  if (!height || !width) return []

  const result = Array.from({ length: width }, () => new Array(height))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      result[x][height - 1 - y] = source[y][x]
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

function replaceColorInRect(matrix, first, second, fromCode, toCode) {
  const next = cloneMatrix(matrix)
  const height = next.length
  const width = height && next[0] ? next[0].length : 0
  const minX = Math.max(0, Math.min(Number(first.x), Number(second.x)))
  const maxX = Math.min(width - 1, Math.max(Number(first.x), Number(second.x)))
  const minY = Math.max(0, Math.min(Number(first.y), Number(second.y)))
  const maxY = Math.min(height - 1, Math.max(Number(first.y), Number(second.y)))
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (next[y][x] === fromCode) next[y][x] = toCode
    }
  }
  return next
}

function indicesForRow(matrix, rowIndex) {
  const row = matrix[Number(rowIndex)] || []
  const width = row.length
  return row.map((code, x) => code ? Number(rowIndex) * width + x : -1).filter((index) => index >= 0)
}

function indicesForRect(matrix, first, second) {
  const height = matrix.length
  const width = height && matrix[0] ? matrix[0].length : 0
  if (!width) return []
  const minX = Math.max(0, Math.min(Number(first.x), Number(second.x)))
  const maxX = Math.min(width - 1, Math.max(Number(first.x), Number(second.x)))
  const minY = Math.max(0, Math.min(Number(first.y), Number(second.y)))
  const maxY = Math.min(height - 1, Math.max(Number(first.y), Number(second.y)))
  const indices = []
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (matrix[y][x]) indices.push(y * width + x)
    }
  }
  return indices
}

function indicesForCode(matrix, targetCode) {
  const width = matrix.length && matrix[0] ? matrix[0].length : 0
  const indices = []
  matrix.forEach((row, y) => row.forEach((code, x) => {
    if (code && code === targetCode) indices.push(y * width + x)
  }))
  return indices
}

function toggleProgressIndices(completedIndices, targetIndices) {
  const completed = new Set(completedIndices || [])
  const targets = (targetIndices || []).filter((index) => Number.isInteger(index) && index >= 0)
  const shouldComplete = targets.some((index) => !completed.has(index))
  targets.forEach((index) => {
    if (shouldComplete) completed.add(index)
    else completed.delete(index)
  })
  return Array.from(completed).sort((a, b) => a - b)
}

function calculateProgress(matrix, completedIndices) {
  const completed = new Set(completedIndices || [])
  const width = matrix.length && matrix[0] ? matrix[0].length : 0
  const codeTotals = Object.create(null)
  const codeCompleted = Object.create(null)
  let total = 0
  let done = 0
  matrix.forEach((row, y) => row.forEach((code, x) => {
    if (!code) return
    const index = y * width + x
    total += 1
    codeTotals[code] = (codeTotals[code] || 0) + 1
    if (completed.has(index)) {
      done += 1
      codeCompleted[code] = (codeCompleted[code] || 0) + 1
    }
  }))
  return {
    total,
    completed: done,
    percent: total ? Math.round(done / total * 100) : 0,
    completedCodes: Object.keys(codeTotals).filter((code) => codeCompleted[code] === codeTotals[code])
  }
}

function makeShareCode(pattern) {
  return pattern && pattern.id ? 'DC1-' + pattern.id : ''
}

function getPatternByShareCode(code) {
  const match = /^DC1-(.+)$/i.exec(String(code || '').trim())
  return match ? getPatternById(match[1]) : null
}

module.exports = {
  cloneMatrix,
  getDimensions,
  countMatrix,
  rebuildStats,
  createPattern,
  createDemoPattern,
  setCurrentPattern,
  getCurrentPattern,
  getSavedPatterns,
  savePattern,
  savePatterns,
  trySavePattern,
  trySavePatterns,
  showStorageError,
  getPatternById,
  deletePattern,
  deletePatterns,
  movePatternsFromFolder,
  renamePattern,
  duplicatePattern,
  mirrorHorizontal,
  mirrorVertical,
  rotate90,
  setCell,
  replaceColor,
  replaceColorInRect,
  indicesForRow,
  indicesForRect,
  indicesForCode,
  toggleProgressIndices,
  calculateProgress,
  floodFill,
  makeShareCode,
  getPatternByShareCode
}
