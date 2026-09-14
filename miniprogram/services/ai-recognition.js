const apiConfig = require('../config/api')
const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 120000

function aiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function getImageSize(imagePath) {
  return new Promise((resolve) => {
    if (typeof wx.getFileInfo !== 'function') return resolve(null)
    wx.getFileInfo({ filePath: imagePath, success: (info) => resolve(Number(info.size) || null), fail: () => resolve(null) })
  })
}

async function analyzeImage(imagePath, options = {}) {
  const origin = String(apiConfig.apiBaseUrl || '').replace(/\/$/, '')
  if (!/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(origin)) {
    throw aiError('AI_NOT_CONFIGURED', '尚未配置豆仓 HTTPS 识别服务，请使用本地识别。')
  }
  if (!imagePath) throw aiError('IMAGE_REQUIRED', '请先选择一张图片。')
  const size = await getImageSize(imagePath)
  if (size && size > MAX_BYTES) throw aiError('IMAGE_TOO_LARGE', '图片超过 10 MB，请选择较小但清晰的原图。')
  return new Promise((resolve, reject) => {
    let settled = false
    let task
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      finish(aiError('AI_TIMEOUT', 'AI 识别超时，请重试或使用本地识别。'))
      if (task && typeof task.abort === 'function') task.abort()
    }, TIMEOUT_MS)
    try {
      task = wx.uploadFile({
        url: origin + '/api/v1/beads/analyze',
        filePath: imagePath,
        name: 'image',
        formData: {
          mode: options.mode || 'auto',
          expectedSize: String(options.expectedSize || ''),
          palette: 'MARD'
        },
        timeout: TIMEOUT_MS,
        success(response) {
          let body
          try { body = JSON.parse(response.data) } catch (error) {
            finish(aiError('AI_INVALID_RESPONSE', '服务器返回格式无效，请使用本地识别。'))
            return
          }
          if (!Number.isInteger(response.statusCode) || response.statusCode < 200 || response.statusCode >= 300 ||
              !body || body.ok !== true || !body.result) {
            const message = body && body.error && body.error.message
            finish(aiError(body && body.error && body.error.code || 'AI_SERVER_ERROR', message || 'AI 服务暂时不可用，请使用本地识别。'))
            return
          }
          finish(null, body)
        },
        fail() { finish(aiError('AI_UPLOAD_FAILED', '图片上传失败，请检查网络或使用本地识别。')) }
      })
    } catch (error) { finish(aiError('AI_UPLOAD_FAILED', '无法上传图片，请使用本地识别。')) }
  })
}

module.exports = { analyzeImage, MAX_BYTES, TIMEOUT_MS }
