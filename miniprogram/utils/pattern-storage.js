// Each drawing is stored separately. The small index is the commit point:
// replacement records are written first, and old records are removed last.
const LEGACY_KEY = 'savedPatterns:v1'
const LEGACY_CURRENT_KEY = 'currentPattern:v1'
const INDEX_KEY = 'savedPatternIndex:v2'
const RECORD_PREFIX = 'savedPatternRecord:v2:'
let sequence = 0
let cleanupPending = true

function storageError(cause) {
  if (cause && cause.code === 'PATTERN_STORAGE_ERROR') return cause
  const error = new Error('图纸存储失败，可能是本地空间不足或读写异常。请先导出需要保留的图纸，再删除不需要的图纸释放空间后重试。不要清空小程序数据。')
  error.code = 'PATTERN_STORAGE_ERROR'
  error.cause = cause
  return error
}

function readIndex() {
  const index = wx.getStorageSync(INDEX_KEY)
  if (index === undefined || index === null || index === '') return null
  const ids = new Set()
  if (index.version !== 2 || !Array.isArray(index.entries) || index.entries.some((entry) => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.key !== 'string' ||
        !entry.key.startsWith(RECORD_PREFIX) || ids.has(entry.id)) return true
    ids.add(entry.id)
    return false
  })) throw storageError(new Error('Invalid pattern index'))
  return index
}

function readLegacy() {
  const patterns = wx.getStorageSync(LEGACY_KEY)
  if (patterns === undefined || patterns === null || patterns === '') return []
  const ids = new Set()
  if (!Array.isArray(patterns) || patterns.some((pattern) => {
    if (!pattern || typeof pattern.id !== 'string' || !pattern.id || !Array.isArray(pattern.matrix) || ids.has(pattern.id)) return true
    ids.add(pattern.id)
    return false
  })) throw storageError(new Error('Invalid legacy patterns'))
  return patterns
}

function readRecord(entry) {
  const pattern = wx.getStorageSync(entry.key)
  if (!pattern || pattern.id !== entry.id || !Array.isArray(pattern.matrix)) {
    // Never silently skip a missing record and then overwrite the index.
    throw storageError(new Error('Missing pattern record: ' + entry.id))
  }
  return pattern
}

function getSavedPatterns() {
  const index = readIndex()
  return index ? index.entries.map(readRecord) : readLegacy()
}

function getPatternById(id) {
  if (!id) return null
  const index = readIndex()
  if (!index) return readLegacy().find((item) => item.id === id) || null
  const entry = index.entries.find((item) => item.id === id)
  return entry ? readRecord(entry) : null
}

function getCurrentPattern() {
  const index = readIndex()
  if (!index) return wx.getStorageSync(LEGACY_CURRENT_KEY) || null
  const current = index.current
  if (!current) return null
  if (current.draft) return current.draft
  const entry = index.entries.find((item) => item.id === current.id)
  return entry ? readRecord(entry) : null
}

function setCurrentPattern(pattern) {
  try {
    const index = readIndex()
    if (!index) {
      wx.setStorageSync(LEGACY_CURRENT_KEY, pattern)
      return
    }
    const saved = pattern && index.entries.some((entry) => entry.id === pattern.id)
    if (saved && index.current && !index.current.draft && index.current.id === pattern.id) return
    const current = !pattern ? null : (saved ? { id: pattern.id } : { draft: pattern })
    wx.setStorageSync(INDEX_KEY, Object.assign({}, index, { current }))
  } catch (error) {
    throw storageError(error)
  }
}

function removeUnused(keys) {
  keys.forEach((key) => {
    try { wx.removeStorageSync(key) } catch (error) {
      cleanupPending = true
      // Cleanup failure does not turn a committed save into a failed save.
      console.warn('Pattern storage cleanup deferred', key)
    }
  })
}

function cleanupOrphans(index) {
  if (!cleanupPending || typeof wx.getStorageInfoSync !== 'function') return
  cleanupPending = false
  try {
    const live = new Set(index ? index.entries.map((entry) => entry.key) : [])
    const keys = wx.getStorageInfoSync().keys || []
    removeUnused(keys.filter((key) => key.startsWith(RECORD_PREFIX) && !live.has(key)))
    if (index) removeUnused(keys.filter((key) => key === LEGACY_KEY || key === LEGACY_CURRENT_KEY))
  } catch (error) {
    cleanupPending = true
    // A cleanup probe must never prevent reading or saving a drawing.
  }
}

function nextRecordKey() {
  let key
  do {
    sequence += 1
    key = RECORD_PREFIX + Date.now().toString(36) + '-' + sequence.toString(36)
  } while (wx.getStorageSync(key))
  return key
}

function writePatterns(patterns, selectCurrent) {
  const stagedKeys = []
  try {
    const index = readIndex()
    const legacy = index ? [] : readLegacy()
    const ids = new Set(patterns.map((pattern) => pattern.id))
    if (ids.size !== patterns.length || patterns.some((pattern) => typeof pattern.id !== 'string' || !pattern.id)) {
      throw new Error('Pattern IDs must be non-empty and unique')
    }
    cleanupOrphans(index)
    // Migration is lazy: reads do not change any data, and v1 remains intact
    // until every retained drawing and the complete v2 index have been written.
    const writes = patterns.concat(legacy.filter((pattern) => !ids.has(pattern.id)))
    const entries = writes.map((pattern) => {
      const key = nextRecordKey()
      stagedKeys.push(key)
      wx.setStorageSync(key, pattern)
      return { id: pattern.id, key }
    }).concat(index ? index.entries.filter((entry) => !ids.has(entry.id)) : [])
    let current = index ? index.current : null
    if (!index) {
      const previous = wx.getStorageSync(LEGACY_CURRENT_KEY)
      if (previous) current = entries.some((entry) => entry.id === previous.id)
        ? { id: previous.id } : { draft: previous }
    }
    if (selectCurrent && patterns.length) current = { id: patterns[0].id }
    wx.setStorageSync(INDEX_KEY, { version: 2, entries, current })
    // No fallible operation after the commit may report the save as failed.
    removeUnused(index
      ? index.entries.filter((entry) => ids.has(entry.id)).map((entry) => entry.key)
      : [LEGACY_KEY, LEGACY_CURRENT_KEY])
    return patterns
  } catch (error) {
    removeUnused(stagedKeys)
    throw storageError(error)
  }
}

function deletePatterns(ids) {
  const targets = new Set((ids || []).map(String))
  if (!targets.size) return getSavedPatterns()
  try {
    const index = readIndex()
    if (!index) {
      // Deletion must also work when a full legacy cache cannot be migrated.
      const patterns = readLegacy().filter((pattern) => !targets.has(String(pattern.id)))
      const current = wx.getStorageSync(LEGACY_CURRENT_KEY)
      wx.setStorageSync(LEGACY_KEY, patterns)
      if (current && targets.has(String(current.id))) removeUnused([LEGACY_CURRENT_KEY])
      return patterns
    }
    const entries = index.entries.filter((entry) => !targets.has(entry.id))
    const patterns = entries.map(readRecord)
    const currentId = index.current && (index.current.id || (index.current.draft && index.current.draft.id))
    const current = targets.has(currentId) ? null : index.current
    wx.setStorageSync(INDEX_KEY, { version: 2, entries, current })
    removeUnused(index.entries.filter((entry) => targets.has(entry.id)).map((entry) => entry.key))
    cleanupOrphans({ entries })
    return patterns
  } catch (error) {
    throw storageError(error)
  }
}

function showStorageError(error, detail) {
  console.error('Pattern storage operation failed', error)
  wx.showModal({ title: '图纸存储失败', content: (detail ? detail + '\n' : '') + storageError(error).message, showCancel: false })
}

module.exports = { getSavedPatterns, getPatternById, getCurrentPattern, setCurrentPattern, writePatterns, deletePatterns, showStorageError }
