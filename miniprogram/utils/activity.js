const ACTIVITIES_KEY = 'beadActivities:v1'
const ACTIVE_SESSION_KEY = 'activeBeadSession:v1'
const MAX_ACTIVITIES = 500

function makeId(prefix) {
  return (prefix || 'activity') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

function getActivities() {
  const records = wx.getStorageSync(ACTIVITIES_KEY)
  return Array.isArray(records) ? records : []
}

function saveActivities(records) {
  wx.setStorageSync(ACTIVITIES_KEY, (records || []).slice(0, MAX_ACTIVITIES))
}

function recordActivity(type, details) {
  const value = details || {}
  const record = {
    id: value.id || makeId(type),
    kind: 'activity',
    type: type || 'note',
    createdAt: Number(value.createdAt) || Date.now(),
    patternId: value.patternId || '',
    patternName: value.patternName || '',
    title: value.title || '',
    description: value.description || '',
    durationMs: Math.max(0, Number(value.durationMs) || 0),
    metadata: value.metadata || {}
  }
  saveActivities([record].concat(getActivities()))
  return record
}

// The drawing is already committed when these informational records are made.
// A full activity cache must not misreport a successful import as a failed one.
function recordPatternActivity(type, details) {
  try { return recordActivity(type, details) } catch (error) {
    console.error('Pattern activity was not saved', error)
    wx.showModal({ title: '图纸已保存', content: '图纸更改已保存，但本次操作记录写入失败。请检查本地存储空间；无需重复导入图纸。', showCancel: false })
    return null
  }
}

function getActiveSession() {
  const session = wx.getStorageSync(ACTIVE_SESSION_KEY)
  return session && session.id && session.startedAt ? session : null
}

function startBeadSession(pattern, details) {
  const current = getActiveSession()
  const target = pattern || {}
  if (current && current.patternId === target.id) return current
  if (current) pauseBeadSession('切换图纸')
  const value = details || {}
  const session = {
    id: makeId('session'),
    patternId: target.id || value.patternId || '',
    patternName: target.name || value.patternName || '未命名图纸',
    startedAt: Date.now(),
    source: value.source || 'pattern'
  }
  wx.setStorageSync(ACTIVE_SESSION_KEY, session)
  return session
}

function pauseBeadSession(reason) {
  const session = getActiveSession()
  if (!session) return null
  const endedAt = Date.now()
  const durationMs = Math.max(0, endedAt - Number(session.startedAt || endedAt))
  wx.removeStorageSync(ACTIVE_SESSION_KEY)
  if (durationMs < 1000) return null
  return recordActivity('bead-session', {
    createdAt: endedAt,
    patternId: session.patternId,
    patternName: session.patternName,
    title: '拼豆计时',
    description: reason || '暂停计时',
    durationMs,
    metadata: { startedAt: session.startedAt, endedAt, source: session.source }
  })
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours) return hours + '小时' + String(minutes).padStart(2, '0') + '分'
  if (minutes) return minutes + '分' + String(seconds).padStart(2, '0') + '秒'
  return seconds + '秒'
}

function summarizeActivities(records) {
  return (records || []).reduce((summary, item) => {
    summary.count += 1
    summary.durationMs += Math.max(0, Number(item.durationMs) || 0)
    if (item.type === 'bead-session') summary.sessionCount += 1
    return summary
  }, { count: 0, sessionCount: 0, durationMs: 0 })
}

module.exports = {
  ACTIVITIES_KEY,
  ACTIVE_SESSION_KEY,
  getActivities,
  recordActivity,
  recordPatternActivity,
  getActiveSession,
  startBeadSession,
  pauseBeadSession,
  formatDuration,
  summarizeActivities
}
