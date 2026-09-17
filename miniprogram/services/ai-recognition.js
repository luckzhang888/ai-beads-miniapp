const apiConfig = require('../config/api')
const cloudConfig = require('../config/cloud')
const { createInspectionRegionFiles } = require('../utils/image')
const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 120000

function aiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function runtimeAppId() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getAccountInfoSync !== 'function') return ''
    const account = wx.getAccountInfoSync()
    return String(account && account.miniProgram && account.miniProgram.appId || '')
  } catch (error) {
    return ''
  }
}

function attachWechatDiagnostic(error, detail) {
  const wxMessage = String(detail || '').slice(0, 160)
  const appId = runtimeAppId()
  error.wxMessage = wxMessage
  error.appId = appId
  const diagnostics = []
  if (wxMessage) diagnostics.push(`微信错误：${wxMessage}`)
  if (appId) diagnostics.push(`AppID：${appId}`)
  if (diagnostics.length) error.message += `\n${diagnostics.join('；')}`
  return error
}

function cloudFailure(error) {
  const detail = String(error && (error.errMsg || error.message) || '')
  const lower = detail.toLowerCase()
  let mapped
  if (/function.*not found|cloud function not found|函数不存在|-501000|-501001/.test(lower)) {
    mapped = aiError('AI_CLOUD_FUNCTION_MISSING', `云函数 ${cloudConfig.cloudFunctionName} 尚未部署，请在微信开发者工具中上传并部署云函数。`)
  } else if (/environment|env.*not found|cloud.*not.*init|未开通云开发|环境不存在|-601002|-601003/.test(lower)) {
    mapped = aiError('AI_CLOUD_NOT_CONFIGURED', '微信云开发环境尚未开通或环境 ID 不正确，请先创建并关联云环境。')
  } else if (/timeout|timed out|超时/.test(lower)) {
    mapped = aiError('AI_TIMEOUT', '云端 AI 识别超时，请重试或使用本地识别。')
  } else if (/quota|limit|exceed|资源不足|配额/.test(lower)) {
    mapped = aiError('AI_CLOUD_QUOTA', '微信云开发资源或调用额度不足，请检查云开发套餐与用量。')
  } else {
    mapped = aiError('AI_CLOUD_FAILED', '图片未能通过微信云开发完成识别，请检查云环境、云函数和 DeepSeek 密钥配置。')
  }
  return attachWechatDiagnostic(mapped, detail)
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
  return attachWechatDiagnostic(mapped, detail)
}

function requestFailure(error, origin) {
  const detail = String(error && (error.errMsg || error.message) || '')
  const lower = detail.toLowerCase()
  let mapped
  if (/domain|合法域名|白名单/.test(lower)) {
    mapped = aiError('AI_DOMAIN_NOT_ALLOWED', `微信未放行 AI 服务域名 ${origin}。请把它同时加入 request 和 uploadFile 合法域名，保存后重新打开小程序。`)
  } else if (/timeout|timed out|超时/.test(lower)) {
    mapped = aiError('AI_TIMEOUT', 'AI 备用传输超时，请切换网络或选用较小的清晰图片重试。')
  } else if (/ssl|tls|certificate|handshake|证书/.test(lower)) {
    mapped = aiError('AI_TLS_FAILED', 'AI 服务安全连接失败，请检查手机时间或稍后重试。')
  } else {
    mapped = aiError('AI_REQUEST_FAILED', '图片上传与备用传输均未到达 AI 服务。请检查网络，以及小程序的 request、uploadFile 合法域名。')
  }
  return attachWechatDiagnostic(mapped, detail)
}

function parseApiResponse(response) {
  const statusCode = Number(response && response.statusCode) || 0
  if (statusCode === 413) throw aiError('IMAGE_TOO_LARGE', '服务器拒绝了过大的图片，请选择小于 10 MB 的原图。')
  let body
  try {
    body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  } catch (error) {
    throw aiError(statusCode >= 500 ? 'AI_SERVER_ERROR' : 'AI_INVALID_RESPONSE',
      statusCode >= 500 ? 'AI 服务暂时不可用，请稍后重试或使用本地识别。' : '服务器返回格式无效，请使用本地识别。')
  }
  if (statusCode < 200 || statusCode >= 300 || !body || body.ok !== true || !body.result) {
    const message = body && body.error && body.error.message
    throw aiError(body && body.error && body.error.code || 'AI_SERVER_ERROR', message || 'AI 服务暂时不可用，请使用本地识别。')
  }
  return body
}

function parseCloudResponse(response) {
  let body = response && response.result
  try {
    if (typeof body === 'string') body = JSON.parse(body)
  } catch (error) {
    throw aiError('AI_INVALID_RESPONSE', '云函数返回格式无效，请重新部署云函数。')
  }
  return parseApiResponse({ statusCode: body && body.ok === true ? 200 : 503, data: body })
}

function getImageFileMeta(imagePath) {
  return new Promise((resolve) => {
    if (typeof wx.getFileInfo !== 'function') return resolve({ size: null, digest: '' })
    wx.getFileInfo({
      filePath: imagePath,
      digestAlgorithm: 'md5',
      success: (info) => resolve({
        size: Number(info.size) || null,
        digest: /^[a-f0-9]{32}$/i.test(String(info.digest || '')) ? String(info.digest).toLowerCase() : ''
      }),
      fail: () => resolve({ size: null, digest: '' })
    })
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
          try { finish(null, parseApiResponse(response)) } catch (error) { finish(error) }
        },
        fail(error) { finish(uploadFailure(error, origin)) }
      })
    } catch (error) { finish(uploadFailure(error, origin)) }
  })
}

function readImageBase64(imagePath) {
  return new Promise((resolve, reject) => {
    try {
      const manager = wx.getFileSystemManager()
      manager.readFile({
        filePath: imagePath,
        encoding: 'base64',
        success: (result) => resolve(result.data),
        fail: (error) => reject(uploadFailure(error, ''))
      })
    } catch (error) {
      reject(uploadFailure(error, ''))
    }
  })
}

async function requestImageAsBase64(origin, imagePath, options) {
  const imageBase64 = await readImageBase64(imagePath)
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
      finish(aiError('AI_TIMEOUT', 'AI 备用传输超时，请重试或使用本地识别。'))
      if (task && typeof task.abort === 'function') task.abort()
    }, TIMEOUT_MS)
    try {
      task = wx.request({
        url: origin + '/api/v1/beads/analyze-base64',
        method: 'POST',
        data: {
          imageBase64,
          mode: options.mode || 'auto',
          expectedSize: options.expectedSize || '',
          palette: 'MARD'
        },
        header: { 'content-type': 'application/json' },
        timeout: TIMEOUT_MS,
        success(response) {
          try { finish(null, parseApiResponse(response)) } catch (error) { finish(error) }
        },
        fail(error) { finish(requestFailure(error, origin)) }
      })
    } catch (error) { finish(requestFailure(error, origin)) }
  })
}

function cloudExtension(imagePath) {
  const match = String(imagePath || '').toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?|$)/)
  return match && ['jpg', 'jpeg', 'png', 'gif', 'webp'].indexOf(match[1]) >= 0 ? match[1] : 'jpg'
}

function uploadImageToCloud(imagePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      return reject(cloudFailure(new Error('cloud environment not initialized')))
    }
    const cloudPath = `ai-inputs/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${cloudExtension(imagePath)}`
    try {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: imagePath,
        success(result) {
          if (!result || !result.fileID) return reject(cloudFailure(new Error('cloud upload returned no fileID')))
          resolve(result.fileID)
        },
        fail(error) { reject(cloudFailure(error)) }
      })
    } catch (error) { reject(cloudFailure(error)) }
  })
}

function deleteCloudFile(fileID) {
  if (!fileID || !wx.cloud || typeof wx.cloud.deleteFile !== 'function') return
  try { wx.cloud.deleteFile({ fileList: [fileID], fail() {} }) } catch (error) {}
}

function getCloudTempUrl(fileID) {
  return new Promise((resolve, reject) => {
    try {
      wx.cloud.getTempFileURL({
        fileList: [fileID],
        success(result) {
          const item = result && result.fileList && result.fileList[0]
          if (!item || item.status || !item.tempFileURL) return reject(cloudFailure(new Error('cloud getTempFileURL returned no URL')))
          resolve(item.tempFileURL)
        },
        fail(error) { reject(cloudFailure(error)) }
      })
    } catch (error) { reject(cloudFailure(error)) }
  })
}

function callCloudRecognition(fileID, imageUrl, options, fileMeta, regions) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(aiError('AI_TIMEOUT', '云端 AI 识别超时，请重试或使用本地识别。')), TIMEOUT_MS)
    try {
      wx.cloud.callFunction({
        name: cloudConfig.cloudFunctionName,
        data: {
          action: 'analyze',
          fileID,
          imageUrl,
          mode: options.mode || 'auto',
          expectedSize: options.expectedSize || '',
          palette: 'MARD',
          sourceBytes: Number(fileMeta && fileMeta.size) || 0,
          sourceDigest: String(fileMeta && fileMeta.digest || ''),
          regions: Array.isArray(regions) ? regions : []
        },
        success(response) {
          try { finish(null, parseCloudResponse(response)) } catch (error) { finish(error) }
        },
        fail(error) { finish(cloudFailure(error)) }
      })
    } catch (error) { finish(cloudFailure(error)) }
  })
}

async function analyzeImageWithCloud(imagePath, options, fileMeta) {
  const uploadedFileIDs = []
  let localRegions = []
  try {
    try { localRegions = await createInspectionRegionFiles(imagePath) } catch (error) { localRegions = [] }
    const fileID = await uploadImageToCloud(imagePath)
    uploadedFileIDs.push(fileID)
    const imageUrl = await getCloudTempUrl(fileID)
    const regions = []
    for (let index = 0; index < localRegions.length; index += 1) {
      const region = localRegions[index]
      // The magnified title/legend images improve tiny-text recognition, but
      // they are optional. A transient upload failure must not prevent the
      // original image from being analysed.
      try {
        const regionFileID = await uploadImageToCloud(region.path)
        uploadedFileIDs.push(regionFileID)
        regions.push({ name: region.name, fileID: regionFileID, imageUrl: await getCloudTempUrl(regionFileID) })
      } catch (error) {}
    }
    return await callCloudRecognition(fileID, imageUrl, options, fileMeta, regions)
  } finally {
    uploadedFileIDs.forEach(deleteCloudFile)
    if (typeof wx !== 'undefined' && wx.getFileSystemManager) {
      localRegions.forEach((region) => {
        try { wx.getFileSystemManager().unlink({ filePath: region.path, fail() {} }) } catch (error) {}
      })
    }
  }
}

async function analyzeImageWithServer(imagePath, options) {
  const origin = String(apiConfig.apiBaseUrl || '').replace(/\/$/, '')
  if (!/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(origin)) {
    throw aiError('AI_NOT_CONFIGURED', '尚未配置豆仓 HTTPS 识别服务，请使用本地识别。')
  }
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
    try {
      return await requestImageAsBase64(origin, imagePath, options)
    } catch (fallbackError) {
      if (fallbackError && fallbackError.code === 'AI_IMAGE_UNAVAILABLE') throw fallbackError
      throw fallbackError || lastError
    }
  }
  throw lastError
}

async function analyzeImage(imagePath, options = {}) {
  if (!imagePath) throw aiError('IMAGE_REQUIRED', '请先选择一张图片。')
  const fileMeta = await getImageFileMeta(imagePath)
  if (fileMeta.size && fileMeta.size > MAX_BYTES) throw aiError('IMAGE_TOO_LARGE', '图片超过 10 MB，请选择较小但清晰的原图。')
  return cloudConfig.transport === 'cloud'
    ? analyzeImageWithCloud(imagePath, options, fileMeta)
    : analyzeImageWithServer(imagePath, options)
}

module.exports = {
  analyzeImage, analyzeImageWithCloud, analyzeImageWithServer,
  uploadFailure, requestFailure, cloudFailure, runtimeAppId, getImageFileMeta, MAX_BYTES, TIMEOUT_MS
}
