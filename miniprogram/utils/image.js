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
    image.onload = function () {
      resolve(image)
    }
    image.onerror = function (error) {
      reject(error || new Error('图片加载失败'))
    }
    image.src = src
  })
}

function createProcessorCanvas(size) {
  if (typeof wx.createOffscreenCanvas !== 'function') {
    throw new Error('当前微信版本不支持 Canvas 2D 离屏处理，请升级微信后重试')
  }

  return wx.createOffscreenCanvas({
    type: '2d',
    width: size,
    height: size
  })
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function enhanceImageData(imageData, preset) {
  const settings = {
    soft: { contrast: 0.92, saturation: 0.9 },
    natural: { contrast: 1, saturation: 1 },
    vivid: { contrast: 1.12, saturation: 1.08 }
  }
  const current = settings[preset] || settings.natural
  if (current.contrast === 1 && current.saturation === 1) {
    return imageData
  }

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

    data[i] = clamp(r)
    data[i + 1] = clamp(g)
    data[i + 2] = clamp(b)
  }

  return imageData
}

function drawCover(ctx, image, sourceWidth, sourceHeight, size) {
  const side = Math.min(sourceWidth, sourceHeight)
  const sx = Math.floor((sourceWidth - side) / 2)
  const sy = Math.floor((sourceHeight - side) / 2)
  ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size)
}

function drawContain(ctx, image, sourceWidth, sourceHeight, size) {
  const scale = Math.min(size / sourceWidth, size / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  const dx = (size - width) / 2
  const dy = (size - height) / 2
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, dx, dy, width, height)
}

async function imageToPattern(imagePath, size, palette, options) {
  const settings = options || {}
  const info = await getImageInfo(imagePath)
  const canvas = createProcessorCanvas(size)
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  const image = await loadCanvasImage(canvas, info.path)
  const sourceWidth = info.width
  const sourceHeight = info.height

  ctx.clearRect(0, 0, size, size)
  ctx.imageSmoothingEnabled = true

  if (settings.cropMode === 'contain') {
    drawContain(ctx, image, sourceWidth, sourceHeight, size)
  } else {
    drawCover(ctx, image, sourceWidth, sourceHeight, size)
  }

  const imageData = ctx.getImageData(0, 0, size, size)
  enhanceImageData(imageData, settings.optimizePreset || 'natural')
  return matchImageData(imageData, size, size, palette)
}

function recommendPatternSize(width, height) {
  const shortSide = Math.min(Number(width) || 0, Number(height) || 0)
  if (shortSide >= 2200) {
    return 128
  }
  if (shortSide >= 1200) {
    return 64
  }
  if (shortSide >= 700) {
    return 48
  }
  return 32
}

module.exports = {
  imageToPattern,
  recommendPatternSize
}
