const apiConfig = require('../config/api')
const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 120000

function aiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function uploadFailure(error, origin) {
  const detail = String(error && (error.errMsg || error.message) || '')
  const lower = detail.toLowerCase()
  let mapped
  if (/domain|合法域名|白名单/.test(lower)) {
    mapped = aiError('AI_DOMAIN_NOT_ALLOWED', `微信未放行图片上传域名 ${origin}。请在小程序后台将它加入 uploadFile 合法域名，保存后重新打开小程序。`)
  } else if (/timeout|timed out|超时/.test(lower)) {
    mapped = aiError('AI_TIMEOUT', '图片上传超时，请切换网络或选用较小的清晰图片重试。')
  } else if (/no such file|file not found|file path|invalid file|enoent|文件不存在|路径无效/.test(lower)) {
    mapped = aiError('AI_IMAGE_UNAVAILABLE', '所选图片临时文件已失效，请重新选择原图。')
  } else if (/ssl|tls|certificate|handshake|证书/.test(lower)) {
    mapped = aiError('AI_TLS_FAILED', '安全连接失败，请检查手机时间或稍后重试。')
  } else {
    mapped = aiError('AI_UPLOAD_FAILED', '图片未上传到 AI 服务。请检查网络和小程序的 uploadFile 合法域名，或先使用本地识别。')
  }
  mapped.wxMessage = detail.slice(0, 160)
  return mapped
}

function getImageSize(imagePath) {
  return new Promise((resolve) => {
    if (typeof wx.getFileInfo !== 'function') return resolve(null)
    wx.getFileInfo({ filePath: imagePath, success: (info) => resolve(Number(info.size) || null), fail: () => resolve(null) })
  })
}

function uploadImageOnce(origin, imagePath, options) {
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
          const statusCode = Number(response && response.statusCode) || 0
          if (statusCode === 413) {
            finish(aiError('IMAGE_TOO_LARGE', '服务器拒绝了过大的图片，请选择小于 10 MB 的原图。'))
            return
          }
          let body
          try { body = JSON.parse(response && response.data) } catch (error) {
            finish(aiError(statusCode >= 500 ? 'AI_SERVER_ERROR' : 'AI_INVALID_RESPONSE',
              statusCode >= 500 ? 'AI 服务暂时不可用，请稍后重试或使用本地识别。' : '服务器返回格式无效，请使用本地识别。'))
            return
          }
          if (statusCode < 200 || statusCode >= 300 ||
              !body || body.ok !== true || !body.result) {
            const message = body && body.error && body.error.message
            finish(aiError(body && body.error && body.error.code || 'AI_SERVER_ERROR', message || 'AI 服务暂时不可用，请使用本地识别。'))
            return
          }
          finish(null, body)
        },
        fail(error) { finish(uploadFailure(error, origin)) }
      })
    } catch (error) { finish(uploadFailure(error, origin)) }
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
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await uploadImageOnce(origin, imagePath, options)
    } catch (error) {
      lastError = error
      if (!error || error.code !== 'AI_UPLOAD_FAILED' || attempt > 0) break
      await new Promise((resolve) => setTimeout(resolve, 360))
    }
  }
  if (lastError && lastError.code === 'AI_UPLOAD_FAILED') {
    lastError.message = '图片连续两次未上传到 AI 服务。请检查网络和小程序 uploadFile 合法域名，或先使用本地识别。'
  }
  throw lastError
}

module.exports = { analyzeImage, uploadFailure, MAX_BYTES, TIMEOUT_MS }
