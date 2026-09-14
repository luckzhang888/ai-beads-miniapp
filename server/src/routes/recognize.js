const crypto = require('node:crypto')
const express = require('express')
const multer = require('multer')

const MAX_BYTES = 10 * 1024 * 1024

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

function createLimiter({ now = Date.now, maxPerHour = 20 } = {}) {
  const clients = new Map()
  let active = 0
  return {
    enter(ip) {
      const current = now()
      const previous = clients.get(ip) || []
      const recent = previous.filter((time) => current - time < 3600000)
      if (recent.length >= maxPerHour) return 'AI_RATE_LIMITED'
      if (active >= 2) return 'AI_BUSY'
      recent.push(current)
      clients.set(ip, recent)
      active += 1
      return null
    },
    leave() { active = Math.max(0, active - 1) }
  }
}

function createRecognitionRouter(provider, options = {}) {
  const router = express.Router()
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 3, parts: 5 } })
  const limiter = options.limiter || createLimiter()

  router.post('/analyze', (req, res) => {
    const requestId = crypto.randomUUID()
    const started = Date.now()
    res.set('Cache-Control', 'no-store')
    const limited = limiter.enter(req.ip)
    if (limited) return res.status(429).json({ ok: false, requestId,
      error: { code: limited, message: 'AI 当前繁忙，请稍后重试或使用本地识别。' } })
    let released = false
    const release = () => { if (!released) { released = true; limiter.leave() } }
    res.once('finish', release)
    res.once('close', release)
    upload.single('image')(req, res, async (uploadError) => {
      const fail = (code, status, message) => res.status(status).json({ ok: false, requestId, error: { code, message } })
      if (uploadError) {
        const tooLarge = uploadError.code === 'LIMIT_FILE_SIZE'
        return fail(tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_UPLOAD', tooLarge ? 413 : 400,
          tooLarge ? '图片超过 10 MB，请换用原始清晰但较小的图片。' : '上传格式无效。')
      }
      if (!req.file) return fail('IMAGE_REQUIRED', 400, '请上传图片。')
      const mimeType = detectImageType(req.file.buffer)
      if (!mimeType) return fail('INVALID_IMAGE', 415, '仅支持 JPEG、PNG、WebP 和 GIF 图片。')
      const mode = req.body.mode || 'auto'
      if (!['auto', 'diagram', 'pixel', 'photo'].includes(mode) || (req.body.palette && req.body.palette !== 'MARD')) {
        return fail('INVALID_OPTIONS', 400, '识别参数无效。')
      }
      const expectedSize = req.body.expectedSize === undefined || req.body.expectedSize === '' ? null : Number(req.body.expectedSize)
      if (expectedSize !== null && (!Number.isInteger(expectedSize) || expectedSize < 16 || expectedSize > 256)) {
        return fail('INVALID_OPTIONS', 400, '预期尺寸无效。')
      }
      try {
        const result = await provider.analyze({ buffer: req.file.buffer, mimeType }, { mode, expectedSize, palette: 'MARD' })
        console.info(JSON.stringify({ requestId, ms: Date.now() - started, model: provider.model, status: 200,
          imageType: result.imageType, rows: result.rows, columns: result.columns, confidence: result.confidence }))
        return res.json({ ok: true, requestId, provider: 'deepseek', model: provider.model, result })
      } catch (error) {
        const code = error && error.code || 'AI_RECOGNITION_FAILED'
        const status = error && error.status || (code === 'AI_INVALID_RESULT' ? 502 : 503)
        console.error(JSON.stringify({ requestId, ms: Date.now() - started, model: provider.model, status, errorType: code }))
        const messages = {
          AI_TIMEOUT: 'AI 识别超时，请重试或使用本地识别。',
          AI_RATE_LIMITED: 'AI 请求过多，请稍后重试或使用本地识别。',
          AI_NOT_CONFIGURED: 'AI 服务尚未配置，请使用本地识别。',
          AI_INVALID_RESULT: 'AI 返回的网格数据无效，请使用本地识别。'
        }
        return fail(code, status, messages[code] || 'DeepSeek 图片识别暂时不可用，请重试或使用本地识别。')
      }
    })
  })
  return router
}

module.exports = { createRecognitionRouter, detectImageType, createLimiter, MAX_BYTES }
