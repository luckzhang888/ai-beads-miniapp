const crypto = require('node:crypto')
const fetch = require('node-fetch')
const { createDeepSeekProvider } = require('./deepseek')
const { detectImageType, normalizeOptions, MAX_BYTES } = require('./image')

const provider = createDeepSeekProvider()
const clients = new Map()
let active = 0

function requestId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')
}

function fail(id, code, message) {
  return { ok: false, requestId: id, error: { code, message } }
}

function enter(identity) {
  const now = Date.now()
  const previous = clients.get(identity) || []
  const recent = previous.filter((time) => now - time < 3600000)
  const maxPerHour = identity === 'shared' ? 120 : 20
  if (recent.length >= maxPerHour) return 'AI_RATE_LIMITED'
  if (active >= 2) return 'AI_BUSY'
  recent.push(now)
  clients.set(identity, recent)
  active += 1
  return null
}

function leave() {
  active = Math.max(0, active - 1)
}

function validCloudImageUrl(fileID, rawUrl) {
  if (!/^cloud:\/\/.+\/ai-inputs\/[A-Za-z0-9._-]+$/.test(fileID)) return null
  let url
  try { url = new URL(rawUrl) } catch (error) { return null }
  const host = url.hostname.toLowerCase()
  const trusted = host.endsWith('.tcb.qcloud.la') || host.endsWith('.myqcloud.com')
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !trusted) return null
  const fileName = fileID.slice(fileID.lastIndexOf('/') + 1)
  let path
  try { path = decodeURIComponent(url.pathname) } catch (error) { return null }
  return path.includes('/ai-inputs/') && path.endsWith('/' + fileName) ? url.toString() : null
}

async function downloadImage(imageUrl, fetchImpl = fetch) {
  const response = await fetchImpl(imageUrl, { method: 'GET', redirect: 'error', timeout: 30000, size: MAX_BYTES + 1 })
  if (!response.ok) {
    const error = new Error('INVALID_UPLOAD')
    error.code = 'INVALID_UPLOAD'
    throw error
  }
  const length = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0
  if (length > MAX_BYTES) {
    const error = new Error('IMAGE_TOO_LARGE')
    error.code = 'IMAGE_TOO_LARGE'
    throw error
  }
  return response.buffer()
}

exports.main = async (event = {}, context = {}) => {
  const id = requestId()
  const started = Date.now()
  if (event.action !== 'analyze') return fail(id, 'INVALID_ACTION', '云函数调用参数无效。')
  const userInfo = event.userInfo || {}
  const identity = String(userInfo.openId || userInfo.OPENID || context.OPENID || context.openid || 'shared')
  const limited = enter(identity)
  if (limited) return fail(id, limited, limited === 'AI_BUSY' ? 'AI 当前繁忙，请稍后重试。' : 'AI 请求过多，请稍后重试。')

  try {
    const fileID = String(event.fileID || '')
    const imageUrl = validCloudImageUrl(fileID, String(event.imageUrl || ''))
    if (!imageUrl) return fail(id, 'INVALID_UPLOAD', '云存储临时图片地址无效，请重新选择图片。')
    const options = normalizeOptions(event)
    if (!options) return fail(id, 'INVALID_OPTIONS', '识别参数无效。')

    let buffer
    try { buffer = await downloadImage(imageUrl) } catch (error) {
      const tooLarge = error && (error.code === 'IMAGE_TOO_LARGE' || error.type === 'max-size')
      return fail(id, tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_UPLOAD',
        tooLarge ? '图片超过 10 MB，请选择较小但清晰的原图。' : '云存储图片读取失败，请重新选择图片。')
    }
    if (!Buffer.isBuffer(buffer) || !buffer.length) return fail(id, 'IMAGE_REQUIRED', '云存储图片内容为空。')
    const mimeType = detectImageType(buffer)
    if (!mimeType) return fail(id, 'INVALID_IMAGE', '仅支持 JPEG、PNG、WebP 和 GIF 图片。')

    const result = await provider.analyze({ buffer, mimeType }, options)
    console.info(JSON.stringify({ requestId: id, ms: Date.now() - started, model: provider.model,
      status: 200, imageType: result.imageType, rows: result.rows, columns: result.columns, confidence: result.confidence }))
    return { ok: true, requestId: id, provider: 'deepseek', model: provider.model, result }
  } catch (error) {
    const code = error && error.code || 'AI_RECOGNITION_FAILED'
    console.error(JSON.stringify({ requestId: id, ms: Date.now() - started, model: provider.model, errorType: code }))
    const messages = {
      AI_TIMEOUT: 'AI 识别超时，请重试或使用本地识别。',
      AI_RATE_LIMITED: 'AI 请求过多，请稍后重试或使用本地识别。',
      AI_NOT_CONFIGURED: '云函数尚未配置 DeepSeek API Key。',
      AI_INVALID_RESULT: 'AI 返回的网格数据无效，请使用本地识别。'
    }
    return fail(id, code, messages[code] || 'DeepSeek 图片识别暂时不可用，请重试或使用本地识别。')
  } finally {
    leave()
  }
}

exports._test = { detectImageType, normalizeOptions, validCloudImageUrl, downloadImage, fail }
