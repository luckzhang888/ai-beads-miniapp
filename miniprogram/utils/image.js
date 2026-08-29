const { matchImageData } = require('./color-match')

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject
    })
  })
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = function () { resolve(image) }
    image.onerror = function (error) { reject(error || new Error('图片加载失败')) }
    image.src = src
  })
}

function createProcessorCanvas(width, height) {
  if (typeof wx.createOffscreenCanvas !== 'function') {
    throw new Error('当前微信版本不支持 Canvas 2D 离屏处理，请升级微信后重试')
  }

  return wx.createOffscreenCanvas({
    type: '2d',
    width,
    height
  })
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function enhanceImageData(imageData, preset) {
  const settings = {
    soft: { contrast: 0.94, saturation: 0.9, gamma: 0.94 },
    natural: { contrast: 1, saturation: 1, gamma: 0.9 },
    photo: { contrast: 1.02, saturation: 0.98, gamma: 0.82 },
    vivid: { contrast: 1.1, saturation: 1.06, gamma: 0.88 }
  }
  const current = settings[preset] || settings.photo
  const data = imageData.data

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    r = (r - 128) * current.contrast + 128
    g = (g - 128) * current.contrast + 128
    b = (b - 128) * current.contrast + 128

    const gray = r * 0.299 + g * 0.587 + b * 0.114
    r = gray + (r - gray) * current.saturation
    g = gray + (g - gray) * current.saturation
    b = gray + (b - gray) * current.saturation

    const luminance = Math.max(0, Math.min(1, (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255))
    if (luminance > 0.005 && current.gamma < 0.999) {
      const target = Math.pow(luminance, current.gamma)
      const scale = Math.min(2.0, target / luminance)
      r *= scale
      g *= scale
      b *= scale
    }

    data[i] = clamp(r)
    data[i + 1] = clamp(g)
    data[i + 2] = clamp(b)
  }

  return imageData
}

function calculatePatternDimensions(sourceWidth, sourceHeight, shortSide, cropMode) {
  const width = Math.max(1, Number(sourceWidth) || 1)
  const height = Math.max(1, Number(sourceHeight) || 1)
  const base = Math.max(16, Math.min(Number(shortSide) || 64, 160))

  if (cropMode === 'cover' || cropMode === 'contain') {
    return { width: base, height: base }
  }

  let targetWidth
  let targetHeight
  if (width <= height) {
    targetWidth = base
    targetHeight = Math.round(base * height / width)
  } else {
    targetHeight = base
    targetWidth = Math.round(base * width / height)
  }

  const longest = Math.max(targetWidth, targetHeight)
  if (longest > 192) {
    const scale = 192 / longest
    targetWidth = Math.max(1, Math.round(targetWidth * scale))
    targetHeight = Math.max(1, Math.round(targetHeight * scale))
  }

  return { width: targetWidth, height: targetHeight }
}

function drawCover(ctx, image, sourceWidth, sourceHeight, width, height) {
  const sourceRatio = sourceWidth / sourceHeight
  const targetRatio = width / height
  let sx = 0
  let sy = 0
  let sw = sourceWidth
  let sh = sourceHeight

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio
    sx = (sourceWidth - sw) / 2
  } else {
    sh = sourceWidth / targetRatio
    sy = (sourceHeight - sh) / 2
  }

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height)
}

function drawContain(ctx, image, sourceWidth, sourceHeight, width, height) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  const dx = (width - drawWidth) / 2
  const dy = (height - drawHeight) / 2
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, dx, dy, drawWidth, drawHeight)
}

function qualitySettings(mode) {
  const presets = {
    easy: { colorLimit: 24, cleanupPasses: 2 },
    balanced: { colorLimit: 40, cleanupPasses: 1 },
    detail: { colorLimit: 64, cleanupPasses: 1 },
    full: { colorLimit: 0, cleanupPasses: 0 }
  }
  return presets[mode] || presets.balanced
}

async function imageToPattern(imagePath, shortSide, palette, options) {
  const settings = options || {}
  const info = await getImageInfo(imagePath)
  const dimensions = calculatePatternDimensions(
    info.width,
    info.height,
    shortSide,
    settings.cropMode || 'ratio'
  )
  const width = dimensions.width
  const height = dimensions.height
  const canvas = createProcessorCanvas(width, height)
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  const image = await loadCanvasImage(canvas, info.path)
  const sourceWidth = info.width
  const sourceHeight = info.height

  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'

  if (settings.cropMode === 'cover') {
    drawCover(ctx, image, sourceWidth, sourceHeight, width, height)
  } else if (settings.cropMode === 'contain') {
    drawContain(ctx, image, sourceWidth, sourceHeight, width, height)
  } else {
    ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height)
  }

  const imageData = ctx.getImageData(0, 0, width, height)
  enhanceImageData(imageData, settings.optimizePreset || 'photo')
  const result = matchImageData(
    imageData,
    width,
    height,
    palette,
    qualitySettings(settings.qualityMode || 'balanced')
  )

  result.width = width
  result.height = height
  return result
}

function recommendPatternSize(width, height) {
  const shortSide = Math.min(Number(width) || 0, Number(height) || 0)
  if (shortSide >= 2200) return 128
  if (shortSide >= 1200) return 96
  if (shortSide >= 700) return 80
  if (shortSide >= 400) return 64
  return 48
}

module.exports = {
  imageToPattern,
  recommendPatternSize,
  calculatePatternDimensions
}
