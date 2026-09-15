const crypto = require('node:crypto')
const express = require('express')
const multer = require('multer')

const MAX_BYTES = 10 * 1024 * 1024
const MAX_BASE64_BYTES = Math.ceil(MAX_BYTES * 4 / 3) + 16

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

function decodeBase64Image(value) {
  if (typeof value !== 'string') return { error: 'IMAGE_REQUIRED' }
  const encoded = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
  if (!encoded) return { error: 'IMAGE_REQUIRED' }
  if (encoded.length > MAX_BASE64_BYTES) return { error: 'IMAGE_TOO_LARGE' }
  if (encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return { error: 'INVALID_UPLOAD' }
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length > MAX_BYTES) return { error: 'IMAGE_TOO_LARGE' }
  return { buffer }
}

function createRecognitionRouter(provider, options = {}) {
  const router = express.Router()
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 3, parts: 5 } })
  const parseJson = express.json({ limit: MAX_BASE64_BYTES + 4096, strict: true })
  const limiter = options.limiter || createLimiter()

  function beginRequest(req, res) {
    const requestId = crypto.randomUUID()
    const started = Date.now()
    res.set('Cache-Control', 'no-store')
    const limited = limiter.enter(req.ip)
    if (limited) {
      res.status(429).json({ ok: false, requestId,
        error: { code: limited, message: 'AI 当前繁忙，请稍后重试或使用本地识别。' } })
      return null
    }
    let released = false
    const release = () => { if (!released) { released = true; limiter.leave() } }
    res.once('finish', release)
    res.once('close', release)
    return { requestId, started }
  }

  async function analyze(req, res, context, buffer, body) {
    const { requestId, started } = context
    const fail = (code, status, message) => res.status(status).json({ ok: false, requestId, error: { code, message } })
    if (!buffer) return fail('IMAGE_REQUIRED', 400, '请上传图片。')
    if (buffer.length > MAX_BYTES) return fail('IMAGE_TOO_LARGE', 413, '图片超过 10 MB，请换用原始清晰但较小的图片。')
    const mimeType = detectImageType(buffer)
    if (!mimeType) return fail('INVALID_IMAGE', 415, '仅支持 JPEG、PNG、WebP 和 GIF 图片。')
    const mode = body.mode || 'auto'
    if (!['auto', 'diagram', 'pixel', 'photo'].includes(mode) || (body.palette && body.palette !== 'MARD')) {
      return fail('INVALID_OPTIONS', 400, '识别参数无效。')
    }
    const expectedSize = body.expectedSize === undefined || body.expectedSize === '' ? null : Number(body.expectedSize)
    if (expectedSize !== null && (!Number.isInteger(expectedSize) || expectedSize < 16 || expectedSize > 256)) {
      return fail('INVALID_OPTIONS', 400, '预期尺寸无效。')
    }
    try {
      const result = await provider.analyze({ buffer, mimeType }, { mode, expectedSize, palette: 'MARD' })
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
  }

  router.post('/analyze', (req, res) => {
    const context = beginRequest(req, res)
    if (!context) return
    upload.single('image')(req, res, async (uploadError) => {
      if (uploadError) {
        const tooLarge = uploadError.code === 'LIMIT_FILE_SIZE'
        return res.status(tooLarge ? 413 : 400).json({ ok: false, requestId: context.requestId,
          error: { code: tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_UPLOAD',
            message: tooLarge ? '图片超过 10 MB，请换用原始清晰但较小的图片。' : '上传格式无效。' } })
      }
      return analyze(req, res, context, req.file && req.file.buffer, req.body || {})
    })
  })

  router.post('/analyze-base64', (req, res) => {
    const context = beginRequest(req, res)
    if (!context) return
    parseJson(req, res, (parseError) => {
      if (parseError) {
        const tooLarge = parseError.type === 'entity.too.large'
        return res.status(tooLarge ? 413 : 400).json({ ok: false, requestId: context.requestId,
          error: { code: tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_UPLOAD',
            message: tooLarge ? '图片超过 10 MB，请换用原始清晰但较小的图片。' : '上传格式无效。' } })
      }
      const decoded = decodeBase64Image(req.body && req.body.imageBase64)
      if (decoded.error) {
        const tooLarge = decoded.error === 'IMAGE_TOO_LARGE'
        return res.status(tooLarge ? 413 : 400).json({ ok: false, requestId: context.requestId,
          error: { code: decoded.error,
            message: tooLarge ? '图片超过 10 MB，请换用原始清晰但较小的图片。' : '请上传有效的 Base64 图片。' } })
      }
      return analyze(req, res, context, decoded.buffer, req.body || {})
    })
  })

  return router
}

module.exports = { createRecognitionRouter, detectImageType, createLimiter, decodeBase64Image, MAX_BYTES }
