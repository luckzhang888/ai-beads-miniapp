const { matchImageData } = require('./color-match')
const {
  recognizeGuideGrid,
  recognizeGenericGrid,
  recognizePixelGrid,
  recognizeKnownGrid,
  nativePixelLikelihood,
  sampleGridCells,
  classifySampleRows
} = require('./grid-recognition')

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

function normalizeTransform(transform) {
  const value = transform || {}
  return {
    scale: Math.max(0.5, Math.min(4, Number(value.scale) || 1)),
    offsetX: Math.max(-1, Math.min(1, Number(value.offsetX) || 0)),
    offsetY: Math.max(-1, Math.min(1, Number(value.offsetY) || 0)),
    rotation: [0, 90, 180, 270].includes(Number(value.rotation)) ? Number(value.rotation) : 0,
    mirrored: Boolean(value.mirrored)
  }
}

function calculateDrawSize(sourceWidth, sourceHeight, width, height, cropMode) {
  if (cropMode === 'ratio') return { width, height }
  const scale = cropMode === 'cover'
    ? Math.max(width / sourceWidth, height / sourceHeight)
    : Math.min(width / sourceWidth, height / sourceHeight)
  return { width: sourceWidth * scale, height: sourceHeight * scale }
}

function drawTransformed(ctx, image, sourceWidth, sourceHeight, width, height, cropMode, rawTransform) {
  const transform = normalizeTransform(rawTransform)
  const drawSize = calculateDrawSize(sourceWidth, sourceHeight, width, height, cropMode)
  if (cropMode === 'contain') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.save()
  ctx.translate(
    width / 2 + transform.offsetX * width * 0.5,
    height / 2 + transform.offsetY * height * 0.5
  )
  ctx.rotate(transform.rotation * Math.PI / 180)
  ctx.scale(transform.scale * (transform.mirrored ? -1 : 1), transform.scale)
  ctx.drawImage(
    image,
    0,
    0,
    sourceWidth,
    sourceHeight,
    -drawSize.width / 2,
    -drawSize.height / 2,
    drawSize.width,
    drawSize.height
  )
  ctx.restore()
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

  drawTransformed(
    ctx,
    image,
    sourceWidth,
    sourceHeight,
    width,
    height,
    settings.cropMode || 'ratio',
    settings.transform
  )

  const imageData = ctx.getImageData(0, 0, width, height)
  enhanceImageData(imageData, settings.optimizePreset || 'photo')
  const result = matchImageData(
    imageData,
    width,
    height,
    palette,
    Object.assign({}, qualitySettings(settings.qualityMode || 'balanced'), {
      removeTransparent: settings.removeTransparent !== false,
      removeBackground: Boolean(settings.removeBackground),
      whiteThreshold: settings.whiteThreshold,
      whiteTolerance: settings.whiteTolerance
    })
  )

  result.width = width
  result.height = height
  result.beadCount = result.stats.reduce((sum, item) => sum + Number(item.required || 0), 0)
  result.blankCount = width * height - result.beadCount
  result.recognitionMode = 'pixel'
  result.confidence = 0.45
  return result
}

async function gridImageToPattern(imagePath, shortSide, palette, options) {
  const settings = options || {}
  const info = await getImageInfo(imagePath)
  const longestSide = Math.max(info.width, info.height)
  const recognitionMaxSide = Math.max(1200, Number(settings.recognitionMaxSide) || 2000)
  const scale = longestSide > recognitionMaxSide ? recognitionMaxSide / longestSide : 1
  const width = Math.max(1, Math.round(info.width * scale))
  const height = Math.max(1, Math.round(info.height * scale))
  const canvas = createProcessorCanvas(width, height)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const image = await loadCanvasImage(canvas, info.path)

  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, info.width, info.height, 0, 0, width, height)

  const recognitionData = ctx.getImageData(0, 0, width, height)
  if (settings.inputMode === 'pixel' && width === info.width && height === info.height && width <= 192 && height <= 192) {
    const nativeLikelihood = nativePixelLikelihood(recognitionData, width, height)
    if (nativeLikelihood.ok) {
      const nativeResult = recognizeKnownGrid(
        recognitionData,
        width,
        height,
        width,
        height,
        palette,
        Object.assign({}, settings, { recognitionMode: 'native-pixel', confidence: 0.93 })
      )
      nativeResult.sourceWidth = info.width
      nativeResult.sourceHeight = info.height
      nativeResult.recognitionScale = 1
      nativeResult.nativeColorBins = nativeLikelihood.unique
      return nativeResult
    }
  }

  const attempts = []
  let detected = recognizeGuideGrid(recognitionData, width, height, palette, settings)
  if (!detected.ok) {
    attempts.push(detected.reason)
    detected = recognizeGenericGrid(recognitionData, width, height, palette, settings)
  }
  if (!detected.ok) {
    attempts.push(detected.reason)
    detected = recognizePixelGrid(recognitionData, width, height, palette, settings)
  }
  if (detected.ok) {
    const sourceCellWidth = detected.grid.cellWidth / scale
    const sourceCellHeight = detected.grid.cellHeight / scale
    const sampleCellSize = Math.max(24, Math.min(64, Math.round(Math.min(sourceCellWidth, sourceCellHeight))))
    const rowCanvas = createProcessorCanvas(detected.width * sampleCellSize, sampleCellSize)
    rowCanvas.width = detected.width * sampleCellSize
    rowCanvas.height = sampleCellSize
    const rowContext = rowCanvas.getContext('2d')
    const rowImage = await loadCanvasImage(rowCanvas, info.path)
    rowContext.imageSmoothingEnabled = false
    const sourceX = detected.grid.x / scale
    const sourceY = detected.grid.y / scale
    const sampleRows = []
    for (let row = 0; row < detected.height; row += 1) {
      rowContext.clearRect(0, 0, rowCanvas.width, rowCanvas.height)
      rowContext.drawImage(
        rowImage,
        sourceX,
        sourceY + row * sourceCellHeight,
        detected.width * sourceCellWidth,
        sourceCellHeight,
        0,
        0,
        rowCanvas.width,
        rowCanvas.height
      )
      sampleRows.push(sampleGridCells(
        rowContext.getImageData(0, 0, rowCanvas.width, rowCanvas.height),
        rowCanvas.width,
        rowCanvas.height,
        { x: 0, y: 0, cellWidth: sampleCellSize, cellHeight: sampleCellSize, columns: detected.width, rows: 1 }
      )[0])
    }
    const precise = classifySampleRows(sampleRows, palette, settings, {
      confidence: detected.confidence,
      grid: detected.grid,
      recognitionMode: detected.recognitionMode
    })
    precise.sourceWidth = info.width
    precise.sourceHeight = info.height
    precise.recognitionScale = scale
    precise.sampleCellSize = sampleCellSize
    return precise
  }

  attempts.push(detected.reason)
  const fallback = await imageToPattern(imagePath, shortSide, palette, Object.assign({}, settings, {
    qualityMode: settings.fallbackQualityMode || 'easy'
  }))
  fallback.recognitionMode = 'pixel-fallback'
  fallback.recognitionReason = attempts.filter(Boolean).join(',') || 'grid-not-detected'
  fallback.warning = '这张图未检测到可靠网格，已按普通图片转换为不超过 24 色。请先确认网格尺寸，再保存。'
  return fallback
}

function recommendPatternSize(width, height) {
  const shortSide = Math.min(Number(width) || 0, Number(height) || 0)
  if (shortSide >= 384) return 48
  return 32
}

module.exports = {
  imageToPattern,
  gridImageToPattern,
  recommendPatternSize,
  calculatePatternDimensions,
  normalizeTransform,
  calculateDrawSize
}
