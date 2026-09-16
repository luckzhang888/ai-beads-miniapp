const { matchImageData } = require('./color-match')
const {
  validateGuidedAnalysis,
  guidedGridDisagreesWithLocal,
  fitDetectedGridToDeclaredDimensions,
  sampleGuidedGrid
} = require('./ai-grid')
const {
  detectGuideGridGeometry,
  detectGenericGridGeometry,
  detectPixelGridGeometry,
  recognizeKnownGrid,
  nativePixelLikelihood,
  sampleGridCells,
  classifySampleRowsAsync
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

async function reportProcessingProgress(settings, progress, step) {
  if (settings && typeof settings.onProgress === 'function') {
    await Promise.resolve(settings.onProgress(Math.max(0, Math.min(100, Math.round(progress))), step))
  }
}

function yieldProcessingThread() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function validateRecognizedGrid(result, geometry) {
  const warnings = []
  const cellRatio = Math.max(geometry.cellWidth, geometry.cellHeight) /
    Math.max(0.001, Math.min(geometry.cellWidth, geometry.cellHeight))
  if (cellRatio > 1.18) warnings.push('横向与纵向网格间距不一致')
  if (Number(result.confidence) < 0.72) warnings.push('网格定位置信度偏低')
  if (result.recognitionMode === 'guide-grid' && Number(geometry.spacingConsistency) < 0.7) warnings.push('红色导线存在缺失或被图案遮挡')
  if (result.recognitionMode === 'guide-grid' && Number(geometry.guideBalance) < 0.6) warnings.push('横纵导线数量差异过大')
  if (result.recognitionMode === 'guide-grid' && !result.labeledGrid) warnings.push('没有稳定检测到格内色号文字')
  if (!result.beadCount || result.beadCount > result.width * result.height) warnings.push('豆豆数量校验失败')
  if (!result.usedColorCount || result.usedColorCount > 96) warnings.push('识别出的颜色数量异常')
  return { ok: warnings.length === 0, warnings }
}

function trustedDetectedCodes(analysis) {
  const legendCounts = trustedLegendCodeCounts(analysis)
  // A vision model can usually read a handful of large labels but cannot
  // prove that the list covers every colour in a dense chart. Restricting the
  // matcher to that partial list is destructive (for example, 15 colours can
  // collapse to 8). Only a complete legend whose counts add up to the printed
  // total is strong enough to constrain the MARD 221 palette.
  return legendCounts ? Object.keys(legendCounts) : []
}

function trustedLegendCodeCounts(analysis) {
  const entries = analysis && Array.isArray(analysis.legendEntries) ? analysis.legendEntries : []
  const declaredColors = Number(analysis && analysis.declaredColorCount)
  const declaredBeads = Number(analysis && analysis.declaredBeadCount)
  if (!Number.isInteger(declaredColors) || !Number.isInteger(declaredBeads) ||
    entries.length !== declaredColors || entries.length < 2) return null
  const counts = Object.create(null)
  let total = 0
  for (let index = 0; index < entries.length; index += 1) {
    const code = String(entries[index] && entries[index].code || '').toUpperCase()
    const count = Number(entries[index] && entries[index].count)
    if (!/^[A-HM][0-9]+$/.test(code) || counts[code] || !Number.isInteger(count) || count < 1) return null
    counts[code] = count
    total += count
  }
  return total === declaredBeads ? counts : null
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
  await reportProcessingProgress(settings, 12, '读取原始图纸')
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

  await reportProcessingProgress(settings, 24, '缩放识别图像')

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
      nativeResult.validation = validateRecognizedGrid(nativeResult, nativeResult.grid)
      await reportProcessingProgress(settings, 100, '识别完成')
      return nativeResult
    }
  }

  const attempts = []
  await reportProcessingProgress(settings, 34, '检测红色导线网格')
  let detected = detectGuideGridGeometry(recognitionData, width, height, settings)
  let recognitionMode = 'guide-grid'
  if (!detected.ok) {
    attempts.push(detected.reason)
    await reportProcessingProgress(settings, 40, '检测规则网格')
    detected = detectGenericGridGeometry(recognitionData, width, height, settings)
    recognitionMode = 'regular-grid'
  }
  if (!detected.ok) {
    attempts.push(detected.reason)
    await reportProcessingProgress(settings, 46, '检测像素块网格')
    detected = detectPixelGridGeometry(recognitionData, width, height, settings)
    recognitionMode = 'pixel-grid'
  }
  if (detected.ok) {
    await reportProcessingProgress(settings, 52, '网格已定位，准备逐格采样')
    // Sample from the same pixels used to locate the grid. Resizing each row
    // through Canvas used to introduce device-dependent interpolation and
    // could turn printed labels into blank cells on real phones.
    const sampleRows = []
    const progressEvery = Math.max(1, Math.floor(detected.rows / 20))
    for (let row = 0; row < detected.rows; row += 1) {
      sampleRows.push(sampleGridCells(
        recognitionData,
        width,
        height,
        {
          x: detected.x,
          y: detected.y + row * detected.cellHeight,
          cellWidth: detected.cellWidth,
          cellHeight: detected.cellHeight,
          columns: detected.columns,
          rows: 1
        }
      )[0])
      if ((row + 1) % progressEvery === 0 || row + 1 === detected.rows) {
        await reportProcessingProgress(settings, 52 + (row + 1) / detected.rows * 34, '逐格采样 ' + (row + 1) + '/' + detected.rows)
        await yieldProcessingThread()
      }
    }
    await reportProcessingProgress(settings, 90, '匹配 MARD 221 标准色卡')
    const grid = {
      x: detected.x,
      y: detected.y,
      cellWidth: detected.cellWidth,
      cellHeight: detected.cellHeight,
      guideColumns: detected.guideColumns,
      guideRows: detected.guideRows
    }
    const precise = await classifySampleRowsAsync(sampleRows, palette, Object.assign({}, settings, {
      onClassificationProgress: (fraction) => reportProcessingProgress(settings,
        90 + fraction * 8, '匹配色号 ' + Math.round(fraction * 100) + '%')
    }), {
      confidence: detected.confidence,
      grid,
      recognitionMode
    })
    precise.sourceWidth = info.width
    precise.sourceHeight = info.height
    precise.recognitionScale = scale
    precise.sampleCellSize = Math.min(detected.cellWidth, detected.cellHeight)
    if (precise.labeledGrid && !(Array.isArray(settings.allowedCodes) && settings.allowedCodes.length >= 2)) {
      precise.colorCodesLocallyEstimated = true
      precise.confidence = Math.min(precise.confidence, 0.68)
      precise.warning = '本地已还原网格和色块，但无法可靠读取格内小字；相近 MARD 色号仍需在“色号整理”中核对。'
    }
    precise.validation = validateRecognizedGrid(precise, detected)
    if (!precise.validation.ok) {
      const validationWarning = '识别结果需要人工核对：' + precise.validation.warnings.join('；') + '。请确认网格、颜色数和豆豆总数后再保存。'
      precise.warning = precise.warning ? precise.warning + validationWarning : validationWarning
    }
    await reportProcessingProgress(settings, 100, '识别完成')
    return precise
  }

  attempts.push(detected.reason)
  const fallback = await imageToPattern(imagePath, shortSide, palette, Object.assign({}, settings, {
    qualityMode: settings.fallbackQualityMode || 'easy'
  }))
  fallback.recognitionMode = 'pixel-fallback'
  fallback.recognitionReason = attempts.filter(Boolean).join(',') || 'grid-not-detected'
  fallback.warning = '这张图未检测到可靠网格，已按普通图片转换为不超过 24 色。请先确认网格尺寸，再保存。'
  fallback.validation = { ok: false, warnings: ['未检测到可靠网格'] }
  await reportProcessingProgress(settings, 100, '已生成普通图片转换结果')
  return fallback
}

async function aiGuidedImageToPattern(imagePath, palette, analysis, options) {
  const settings = options || {}
  validateGuidedAnalysis(analysis)
  await reportProcessingProgress(settings, 45, '根据 AI 定位图纸区域')
  const info = await getImageInfo(imagePath)
  const longestSide = Math.max(info.width, info.height)
  const scale = Math.min(1, 2400 / longestSide)
  const width = Math.max(1, Math.round(info.width * scale))
  const height = Math.max(1, Math.round(info.height * scale))
  const canvas = createProcessorCanvas(width, height)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const image = await loadCanvasImage(canvas, info.path)
  ctx.imageSmoothingEnabled = true
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, info.width, info.height, 0, 0, width, height)
  await reportProcessingProgress(settings, 60, '校准网格与透视')
  const pixels = ctx.getImageData(0, 0, width, height)
  let localGrid = detectGuideGridGeometry(pixels, width, height, settings)
  let localGridKind = 'guide-grid'
  if (!localGrid.ok) {
    localGrid = detectGenericGridGeometry(pixels, width, height, settings)
    localGridKind = 'regular-grid'
  }
  if (guidedGridDisagreesWithLocal(analysis, localGrid, width, height)) {
    const error = new Error('AI 估算的网格行列与图片中的规则网格明显不符。')
    error.code = 'AI_GRID_MISMATCH'
    throw error
  }
  const localCellRatio = localGrid && localGrid.ok
    ? Math.max(localGrid.cellWidth, localGrid.cellHeight) / Math.max(0.001, Math.min(localGrid.cellWidth, localGrid.cellHeight))
    : Infinity
  const guideQualityOk = localGridKind !== 'guide-grid' || (
    Number(localGrid.guideBalance) >= 0.6 &&
    Number(localGrid.spacingConsistency) >= 0.7
  )
  const reliableLocalGrid = localGrid && localGrid.ok &&
    Number(localGrid.confidence) >= 0.78 &&
    localCellRatio <= 1.15 &&
    guideQualityOk
  const dimensionsAreClose = reliableLocalGrid &&
    Math.abs(localGrid.rows - analysis.rows) <= Math.max(2, Math.round(localGrid.rows * 0.03)) &&
    Math.abs(localGrid.columns - analysis.columns) <= Math.max(2, Math.round(localGrid.columns * 0.03))
  // A printed title such as 99x106 is a stronger dimension source than an
  // edge detector that can miss one faint outside line. In that case the
  // detector supplies the physical grid area/cell pitch only; the declared
  // row/column count controls how that area is divided.
  const useLocalGrid = Boolean(reliableLocalGrid && dimensionsAreClose)
  const declaredDimensionsTrusted = analysis.dimensionSource === 'title'
  const samplingGrid = useLocalGrid && declaredDimensionsTrusted
    ? fitDetectedGridToDeclaredDimensions(localGrid, analysis, width, height)
    : localGrid
  const gridAreaRepaired = Boolean(useLocalGrid && declaredDimensionsTrusted &&
    samplingGrid && samplingGrid.declaredDimensionsApplied)
  const aiDimensionsCorrected = useLocalGrid && !declaredDimensionsTrusted &&
    (localGrid.rows !== analysis.rows || localGrid.columns !== analysis.columns)
  let sampleRows
  if (useLocalGrid) {
    // AI is good at reading the count and printed labels; detected line pixels
    // are more accurate for sub-cell sampling, especially when screenshots
    // are cropped through the first or last row/column.
    sampleRows = sampleGridCells(pixels, width, height, samplingGrid)
    await reportProcessingProgress(settings, 80, gridAreaRepaired ? '网格区域修复完成' : '本地网格精校完成')
    await yieldProcessingThread()
  } else {
    sampleRows = await sampleGuidedGrid(pixels, width, height, analysis, (fraction) =>
      reportProcessingProgress(settings, 60 + fraction * 20, '逐格采样 ' + Math.round(fraction * 100) + '%'))
  }
  await reportProcessingProgress(settings, 85, '匹配 MARD 221 标准色号')
  const allowedCodes = trustedDetectedCodes(analysis)
  const expectedCodeCounts = trustedLegendCodeCounts(analysis)
  const result = await classifySampleRowsAsync(sampleRows, palette, Object.assign({}, settings, {
    hasCellLabels: analysis.hasLabels,
    allowedCodes,
    expectedColorCount: analysis.declaredColorCount,
    expectedBeadCount: analysis.declaredBeadCount,
    expectedCodeCounts,
    onClassificationProgress: (fraction) => reportProcessingProgress(settings,
      85 + fraction * 13, '匹配色号 ' + Math.round(fraction * 100) + '%')
  }), {
    confidence: analysis.confidence,
    recognitionMode: 'ai-guided-grid',
    grid: { bounds: analysis.grid, perspective: analysis.perspective, local: useLocalGrid ? samplingGrid : null }
  })
  result.sourceWidth = info.width
  result.sourceHeight = info.height
  result.recognitionScale = scale
  result.aiAnalysis = analysis
  result.uploadIntegrityVerified = Boolean(analysis.uploadIntegrity && analysis.uploadIntegrity.verified)
  result.localGridRefined = Boolean(useLocalGrid)
  result.localGridKind = useLocalGrid ? localGridKind : ''
  result.gridAreaRepaired = gridAreaRepaired
  result.aiDimensionsCorrected = Boolean(aiDimensionsCorrected)
  if (aiDimensionsCorrected) {
    result.aiOriginalDimensions = { rows: analysis.rows, columns: analysis.columns }
  }
  const warnings = (analysis.warnings || []).slice()
  if (gridAreaRepaired) {
    warnings.unshift(`已先定位网格面积，再按标题标注的 ${analysis.columns}×${analysis.rows} 强制等分；本地漏检的边缘线未再改写尺寸`)
  }
  const calibrationNotes = []
  if (result.uploadIntegrityVerified) calibrationNotes.push('上传前后文件大小和 MD5 完全一致，云端使用的是手机所选原图')
  if (result.chartColorCalibrationApplied) calibrationNotes.push('已从本图学习实际色块，校正截图、屏幕和导出造成的整体偏色')
  if (result.expectedCodeCountsApplied) {
    calibrationNotes.push('已按图例逐色号数量进行全局校准，仅使用图例中的 MARD 221 标准色')
  }
  result.calibrationNote = calibrationNotes.join('；')
  if (result.uncertainCellCount > 0) {
    warnings.unshift(`仍有 ${result.uncertainCellCount} 格颜色接近，已列为待人工核对，不能标记为 100%`)
  }
  if (Array.isArray(analysis.detectedCodes) && analysis.detectedCodes.length >= 2 && allowedCodes.length < 2) {
    warnings.unshift('AI 图例色号未经过逐格核实，已改用本地色块匹配，避免错误压缩颜色数量')
  }
  if (result.expectedColorCountApplied) {
    warnings.unshift(`已按标题标注的 ${analysis.declaredColorCount} 色合并压缩产生的近似色，请核对具体 MARD 色号`)
  }
  if (result.expectedBeadCountApplied) {
    warnings.unshift(`已按标题标注的 ${analysis.declaredBeadCount} 颗校准空白格，请核对图案边缘`)
  }
  if (analysis.hasLabels && (!Array.isArray(analysis.detectedCodes) || analysis.detectedCodes.length < 2)) {
    warnings.unshift('AI 未能可靠读取格内色号，颜色仅按本地色差估算')
  }
  if (analysis.confidence < 0.72) warnings.unshift('AI 网格定位置信度偏低')
  if (!result.beadCount || result.beadCount > result.width * result.height) warnings.push('豆豆数量校验失败')
  result.validation = { ok: warnings.length === 0, warnings }
  if (warnings.length) result.warning = '识别结果需要核对：' + warnings.join('；') + '。'
  await reportProcessingProgress(settings, 100, '识别完成')
  return result
}

function recommendPatternSize(width, height) {
  const shortSide = Math.min(Number(width) || 0, Number(height) || 0)
  if (shortSide >= 384) return 48
  return 32
}

module.exports = {
  imageToPattern,
  gridImageToPattern,
  aiGuidedImageToPattern,
  trustedDetectedCodes,
  trustedLegendCodeCounts,
  recommendPatternSize,
  calculatePatternDimensions,
  normalizeTransform,
  calculateDrawSize
}
