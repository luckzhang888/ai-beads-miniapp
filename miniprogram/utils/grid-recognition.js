const { preparePalette, findNearestColor, buildStats } = require('./color-match')

// Printed/exported MARD charts use screen colors that differ slightly from the
// inventory swatches. These measured values keep chart recognition stable while
// leaving the visible 295-colour inventory palette unchanged.
const CHART_RGB_OVERRIDES = {
  E8: [255, 230, 233],
  E15: [255, 216, 220],
  E21: [210, 176, 180],
  H2: [255, 254, 254],
  H3: [186, 186, 186],
  H8: [246, 237, 240],
  H17: [240, 240, 240]
}

function prepareRecognitionPalette(rawPalette) {
  return preparePalette((rawPalette || []).map((item) => Object.assign({}, item, {
    rgb: CHART_RGB_OVERRIDES[item.code] || item.rgb,
    lab: undefined
  })))
}

function median(values) {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function isGuideRed(r, g, b) {
  return r > 165 && r - g > 35 && r - b > 25
}

function guideProjection(imageData, width, height, axis) {
  const data = imageData.data || imageData
  const length = axis === 'x' ? width : height
  const crossLength = axis === 'x' ? height : width
  const crossStep = Math.max(1, Math.floor(crossLength / 900))
  const bucketCount = Math.max(8, Math.min(32, Math.floor(crossLength / 28)))
  const scores = new Array(length).fill(0)

  for (let position = 0; position < length; position += 1) {
    let score = 0
    const occupiedBuckets = new Uint8Array(bucketCount)
    for (let cross = 0; cross < crossLength; cross += crossStep) {
      const x = axis === 'x' ? position : cross
      const y = axis === 'x' ? cross : position
      const offset = (y * width + x) * 4
      if (isGuideRed(data[offset], data[offset + 1], data[offset + 2])) {
        const beforePosition = Math.max(0, position - 1)
        const afterPosition = Math.min(length - 1, position + 1)
        const beforeX = axis === 'x' ? beforePosition : cross
        const beforeY = axis === 'x' ? cross : beforePosition
        const afterX = axis === 'x' ? afterPosition : cross
        const afterY = axis === 'x' ? cross : afterPosition
        const beforeOffset = (beforeY * width + beforeX) * 4
        const afterOffset = (afterY * width + afterX) * 4
        const beforeRed = isGuideRed(data[beforeOffset], data[beforeOffset + 1], data[beforeOffset + 2])
        const afterRed = isGuideRed(data[afterOffset], data[afterOffset + 1], data[afterOffset + 2])
        if (beforeRed && afterRed) continue
        score += 1
        occupiedBuckets[Math.min(bucketCount - 1, Math.floor(cross * bucketCount / crossLength))] = 1
      }
    }
    let occupied = 0
    for (let bucket = 0; bucket < occupiedBuckets.length; bucket += 1) occupied += occupiedBuckets[bucket]
    const coverage = occupied / bucketCount
    // Real guide lines span most of the chart. Red bead blocks and watermark
    // text are localised, so reduce their influence before peak detection.
    scores[position] = coverage < 0.2 ? 0 : score * (0.35 + coverage * 0.65)
  }
  return scores
}

function groupProjectionPeaks(scores) {
  return groupProjectionPeaksAt(scores, 0.34)
}

function groupProjectionPeaksAt(scores, ratio) {
  const maximum = Math.max.apply(null, scores)
  if (!Number.isFinite(maximum) || maximum < 8) return []
  const threshold = Math.max(5, maximum * ratio)
  const peaks = []
  let start = -1

  for (let index = 0; index <= scores.length; index += 1) {
    const score = index < scores.length ? scores[index] : 0
    if (score >= threshold && start < 0) start = index
    if (score < threshold && start >= 0) {
      let best = start
      for (let cursor = start + 1; cursor < index; cursor += 1) {
        if (scores[cursor] > scores[best]) best = cursor
      }
      peaks.push({ position: best, score: scores[best] })
      start = -1
    }
  }
  return peaks
}

function groupGuideProjectionPeaks(scores) {
  return groupProjectionPeaksAt(scores, 0.035)
}

function pixelAt(data, width, x, y) {
  const offset = (y * width + x) * 4
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722
}

function genericLineProjection(imageData, width, height, axis) {
  const data = imageData.data || imageData
  const length = axis === 'x' ? width : height
  const crossLength = axis === 'x' ? height : width
  const crossStep = Math.max(1, Math.floor(crossLength / 700))
  const scores = new Array(length).fill(0)
  for (let position = 1; position < length - 1; position += 1) {
    let score = 0
    for (let cross = 0; cross < crossLength; cross += crossStep) {
      const x = axis === 'x' ? position : cross
      const y = axis === 'x' ? cross : position
      const before = pixelAt(data, width, axis === 'x' ? x - 1 : x, axis === 'x' ? y : y - 1)
      const current = pixelAt(data, width, x, y)
      const after = pixelAt(data, width, axis === 'x' ? x + 1 : x, axis === 'x' ? y : y + 1)
      if (current[3] < 32) continue
      const currentLight = luminance(current)
      const neighborLight = (luminance(before) + luminance(after)) / 2
      const chroma = Math.max(current[0], current[1], current[2]) - Math.min(current[0], current[1], current[2])
      const neighborRgb = [
        (before[0] + after[0]) / 2,
        (before[1] + after[1]) / 2,
        (before[2] + after[2]) / 2
      ]
      const colorContrast = Math.max(
        Math.abs(current[0] - neighborRgb[0]),
        Math.abs(current[1] - neighborRgb[1]),
        Math.abs(current[2] - neighborRgb[2])
      )
      if (currentLight < 238 && chroma < 85 && (Math.abs(neighborLight - currentLight) > 10 || colorContrast > 14)) score += 1
    }
    scores[position] = score
  }
  return scores
}

function regularPeakSequence(peaks, minimumCount) {
  if (!Array.isArray(peaks) || peaks.length < minimumCount) return null
  let best = null
  const minCount = Math.max(5, Number(minimumCount) || 6)
  for (let left = 0; left < peaks.length - 1; left += 1) {
    for (let right = left + 1; right < Math.min(peaks.length, left + 7); right += 1) {
      const step = peaks[right].position - peaks[left].position
      if (step < 3 || step > 96) continue
      const tolerance = Math.max(1.25, step * 0.16)
      const sequence = []
      let expected = peaks[left].position
      let cursor = left
      while (expected <= peaks[peaks.length - 1].position + tolerance) {
        let match = null
        while (cursor < peaks.length && peaks[cursor].position < expected - tolerance) cursor += 1
        for (let candidate = cursor; candidate < Math.min(peaks.length, cursor + 3); candidate += 1) {
          if (Math.abs(peaks[candidate].position - expected) <= tolerance && (!match || peaks[candidate].score > match.score)) match = peaks[candidate]
        }
        if (match) sequence.push(match)
        expected += step
      }
      if (sequence.length < minCount) continue
      const slots = Math.round((sequence[sequence.length - 1].position - sequence[0].position) / step) + 1
      const completeness = sequence.length / Math.max(1, slots)
      if (completeness < 0.78) continue
      const meanStrength = sequence.reduce((sum, item) => sum + item.score, 0) / sequence.length
      const score = sequence.length * completeness * meanStrength / Math.max(1, step)
      if (!best || score > best.score) best = { sequence, step, completeness, meanStrength, score }
    }
  }
  return best
}

function detectGenericGridGeometry(imageData, width, height, options) {
  const settings = options || {}
  const scoresX = genericLineProjection(imageData, width, height, 'x')
  const scoresY = genericLineProjection(imageData, width, height, 'y')
  const peaksX = groupProjectionPeaks(scoresX)
  const peaksY = groupProjectionPeaks(scoresY)
  const regularX = regularPeakSequence(peaksX, 6)
  const regularY = regularPeakSequence(peaksY, 6)
  if (!regularX || !regularY) return { ok: false, reason: 'regular-grid-lines-not-found' }
  if (Math.abs(regularX.step - regularY.step) > Math.max(regularX.step, regularY.step) * 0.28) {
    return { ok: false, reason: 'regular-grid-spacing-mismatch' }
  }
  const firstX = regularX.sequence[0].position
  const lastX = regularX.sequence[regularX.sequence.length - 1].position
  const firstY = regularY.sequence[0].position
  const lastY = regularY.sequence[regularY.sequence.length - 1].position
  const columns = Math.round((lastX - firstX) / regularX.step)
  const rows = Math.round((lastY - firstY) / regularY.step)
  const maxGrid = Number(settings.maxGridSize) || 192
  if (columns < 4 || rows < 4 || columns > maxGrid || rows > maxGrid) return { ok: false, reason: 'regular-grid-size-out-of-range' }
  if ((lastX - firstX) / width < 0.22 || (lastY - firstY) / height < 0.22) return { ok: false, reason: 'regular-grid-region-too-small' }
  return {
    ok: true,
    x: firstX,
    y: firstY,
    cellWidth: regularX.step,
    cellHeight: regularY.step,
    columns,
    rows,
    confidence: Math.min(0.94, 0.62 + (regularX.completeness + regularY.completeness) * 0.14),
    lineColumns: regularX.sequence.length,
    lineRows: regularY.sequence.length
  }
}

function edgeProjection(imageData, width, height, axis) {
  const data = imageData.data || imageData
  const length = axis === 'x' ? width : height
  const crossLength = axis === 'x' ? height : width
  const crossStep = Math.max(1, Math.floor(crossLength / 420))
  const scores = new Array(length).fill(0)
  for (let position = 1; position < length; position += 1) {
    let sum = 0
    let samples = 0
    for (let cross = 0; cross < crossLength; cross += crossStep) {
      const x = axis === 'x' ? position : cross
      const y = axis === 'x' ? cross : position
      const previous = pixelAt(data, width, axis === 'x' ? x - 1 : x, axis === 'x' ? y : y - 1)
      const current = pixelAt(data, width, x, y)
      if (previous[3] < 32 && current[3] < 32) continue
      sum += Math.abs(previous[0] - current[0]) + Math.abs(previous[1] - current[1]) + Math.abs(previous[2] - current[2])
      samples += 1
    }
    scores[position] = samples ? sum / (samples * 3) : 0
  }
  return scores
}

function detectPixelAxis(scores, minimumCells, maximumCells) {
  const length = scores.length
  const overall = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, length - 1)
  const candidates = []
  const maxPitch = Math.min(72, Math.floor(length / Math.max(4, minimumCells || 8)))
  for (let pitch = 2; pitch <= maxPitch; pitch += 1) {
    const cells = Math.floor(length / pitch)
    if (cells < (minimumCells || 8) || cells > (maximumCells || 192)) continue
    for (let phase = 0; phase < pitch; phase += 1) {
      let boundarySum = 0
      let boundaryCount = 0
      let transitions = 0
      for (let position = phase || pitch; position < length; position += pitch) {
        boundarySum += scores[position]
        boundaryCount += 1
        if (scores[position] > Math.max(7, overall * 1.5)) transitions += 1
      }
      if (boundaryCount < 5 || transitions < 3) continue
      const boundaryMean = boundarySum / boundaryCount
      const otherMean = Math.max(0.25, (overall * (length - 1) - boundarySum) / Math.max(1, length - 1 - boundaryCount))
      const ratio = boundaryMean / otherMean
      const coverage = transitions / boundaryCount
      const score = ratio * (0.65 + Math.min(0.35, coverage))
      if (ratio >= 1.7) candidates.push({ pitch, phase, ratio, coverage, score })
    }
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score || a.pitch - b.pitch)
  const bestScore = candidates[0].score
  return candidates.filter((item) => item.score >= bestScore * 0.9).sort((a, b) => a.pitch - b.pitch || b.score - a.score)[0]
}

function detectPixelGridGeometry(imageData, width, height, options) {
  const settings = options || {}
  const axisX = detectPixelAxis(edgeProjection(imageData, width, height, 'x'), 8, Number(settings.maxGridSize) || 192)
  const axisY = detectPixelAxis(edgeProjection(imageData, width, height, 'y'), 8, Number(settings.maxGridSize) || 192)
  if (!axisX || !axisY) return { ok: false, reason: 'pixel-grid-not-found' }
  if (Math.abs(axisX.pitch - axisY.pitch) > Math.max(axisX.pitch, axisY.pitch) * 0.3) return { ok: false, reason: 'pixel-grid-spacing-mismatch' }
  const x = axisX.phase
  const y = axisY.phase
  const columns = Math.floor((width - x) / axisX.pitch)
  const rows = Math.floor((height - y) / axisY.pitch)
  if (columns < 8 || rows < 8 || columns > 192 || rows > 192) return { ok: false, reason: 'pixel-grid-size-out-of-range' }
  return {
    ok: true,
    x,
    y,
    cellWidth: axisX.pitch,
    cellHeight: axisY.pitch,
    columns,
    rows,
    confidence: Math.min(0.92, 0.55 + Math.min(0.2, (axisX.ratio + axisY.ratio - 3.4) * 0.05) + (axisX.coverage + axisY.coverage) * 0.08)
  }
}

function nativePixelLikelihood(imageData, width, height) {
  if (!imageData || !imageData.data || width < 4 || height < 4 || width > 192 || height > 192) return { ok: false, reason: 'native-size-out-of-range' }
  const data = imageData.data
  const bins = Object.create(null)
  const step = Math.max(1, Math.floor(width * height / 18000))
  let samples = 0
  for (let pixel = 0; pixel < width * height; pixel += step) {
    const offset = pixel * 4
    if (data[offset + 3] < 32) continue
    const key = (data[offset] >> 4) + '-' + (data[offset + 1] >> 4) + '-' + (data[offset + 2] >> 4)
    bins[key] = true
    samples += 1
  }
  const unique = Object.keys(bins).length
  const ratio = unique / Math.max(1, samples)
  return { ok: unique <= 96 && ratio <= 0.09, unique, ratio, reason: 'too-many-native-colors' }
}

function alignPeriodicPeaks(peaks, period) {
  const tolerance = Math.max(1.5, period * 0.14)
  const anchors = peaks.slice().sort((a, b) => b.score - a.score).slice(0, 32)
  let best = null
  anchors.forEach((anchor) => {
    const slots = Object.create(null)
    peaks.forEach((peak) => {
      const slot = Math.round((peak.position - anchor.position) / period)
      const expected = anchor.position + slot * period
      if (Math.abs(peak.position - expected) > tolerance) return
      if (!slots[slot] || peak.score > slots[slot].score) slots[slot] = peak
    })
    const slotNumbers = Object.keys(slots).map(Number).sort((a, b) => a - b)
    if (slotNumbers.length < 4) return
    const span = slotNumbers[slotNumbers.length - 1] - slotNumbers[0] + 1
    const completeness = slotNumbers.length / span
    const sequence = slotNumbers.map((slot) => slots[slot])
    const strength = sequence.reduce((sum, peak) => sum + peak.score, 0)
    const score = strength * completeness * completeness
    if (!best || score > best.score) best = { sequence, completeness, score }
  })
  return best
}

function analyzePeakSpacing(peaks) {
  if (!Array.isArray(peaks) || peaks.length < 4) return null
  const maximum = Math.max.apply(null, peaks.map((item) => Number(item.score) || 0))
  const ratios = [0.7, 0.55, 0.4, 0.25, 0.15, 0.09, 0.05, 0.03, 0]
  let best = null
  for (let ratioIndex = 0; ratioIndex < ratios.length; ratioIndex += 1) {
    const selected = peaks.filter((item) => (Number(item.score) || 0) >= maximum * ratios[ratioIndex])
    if (selected.length < 4) continue
    const gaps = []
    for (let index = 1; index < selected.length; index += 1) {
      const gap = selected[index].position - selected[index - 1].position
      if (gap > 3) gaps.push(gap)
    }
    const major = median(gaps)
    if (!major || major < 20) continue
    const consistent = gaps.filter((gap) => Math.abs(gap - major) <= major * 0.14)
    const consistency = consistent.length / Math.max(1, gaps.length)
    if (consistent.length < 3 || consistency < 0.55) continue
    const alignment = alignPeriodicPeaks(peaks, major)
    if (!alignment || alignment.completeness < 0.55) continue
    const score = consistent.length * consistency / major * Math.sqrt(alignment.sequence.length)
    if (!best || score > best.score * 1.04 || (score >= best.score * 0.96 && major < best.major)) {
      best = { major, cell: major / 5, consistency, score, sequence: alignment.sequence }
    }
  }
  return best
}

function reduceSpacingHarmonic(spacing, target, peaks) {
  if (!spacing || !target || spacing.cell <= target.cell) return spacing
  const ratio = spacing.cell / target.cell
  const harmonic = Math.round(ratio)
  if (harmonic < 2 || harmonic > 4 || Math.abs(ratio - harmonic) > 0.18) return spacing
  const major = spacing.major / harmonic
  const alignment = alignPeriodicPeaks(peaks, major)
  if (!alignment || alignment.sequence.length < 4 || alignment.completeness < 0.5) return spacing
  return {
    major,
    cell: major / 5,
    consistency: Math.min(spacing.consistency, alignment.completeness),
    score: spacing.score,
    sequence: alignment.sequence
  }
}

function dominantCellColor(imageData, width, height, left, top, right, bottom) {
  const data = imageData.data || imageData
  const marginX = right - left <= 2 ? 0 : Math.max(1, (right - left) * 0.19)
  const marginY = bottom - top <= 2 ? 0 : Math.max(1, (bottom - top) * 0.19)
  const x0 = Math.max(0, Math.ceil(left + marginX))
  const y0 = Math.max(0, Math.ceil(top + marginY))
  const x1 = Math.min(width - 1, Math.ceil(right) - 1, Math.floor(right - marginX))
  const y1 = Math.min(height - 1, Math.ceil(bottom) - 1, Math.floor(bottom - marginY))
  const stepX = Math.max(1, Math.ceil((x1 - x0 + 1) / 24))
  const stepY = Math.max(1, Math.ceil((y1 - y0 + 1) / 24))
  const redValues = []
  const greenValues = []
  const blueValues = []
  const colorCounts = Object.create(null)
  let darkInk = 0
  let lightInk = 0
  let centerPixels = 0
  let whitePixels = 0

  for (let y = y0; y <= y1; y += stepY) {
    for (let x = x0; x <= x1; x += stepX) {
      const offset = (y * width + x) * 4
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      const a = data[offset + 3]
      if (a < 32) continue

      redValues.push(r)
      greenValues.push(g)
      blueValues.push(b)
      const colorKey = r + ',' + g + ',' + b
      colorCounts[colorKey] = (colorCounts[colorKey] || 0) + 1
      if (Math.min(r, g, b) >= 248 && Math.max(r, g, b) - Math.min(r, g, b) <= 9) whitePixels += 1

      const centerX = (x - left) / Math.max(1, right - left)
      const centerY = (y - top) / Math.max(1, bottom - top)
      if (centerX >= 0.28 && centerX <= 0.72 && centerY >= 0.25 && centerY <= 0.75) {
        centerPixels += 1
        const darkest = Math.max(r, g, b)
        const lightest = Math.min(r, g, b)
        const chroma = Math.max(r, g, b) - Math.min(r, g, b)
        if (darkest < 115 && chroma < 55) darkInk += 1
        if (lightest > 225 && chroma < 55) lightInk += 1
      }
    }
  }

  if (!redValues.length) return { rgb: [255, 255, 255], inkRatio: 0, lightInkRatio: 0, whiteRatio: 1, sampleCount: 0 }
  const dominantKey = Object.keys(colorCounts).reduce((best, key) => !best || colorCounts[key] > colorCounts[best] ? key : best, '')
  const dominantCount = dominantKey ? colorCounts[dominantKey] : 0
  const dominantRgb = dominantCount >= Math.max(3, redValues.length * 0.08)
    ? dominantKey.split(',').map(Number)
    : [Math.round(median(redValues)), Math.round(median(greenValues)), Math.round(median(blueValues))]
  return {
    rgb: dominantRgb,
    inkRatio: centerPixels ? darkInk / centerPixels : 0,
    lightInkRatio: centerPixels ? lightInk / centerPixels : 0,
    whiteRatio: whitePixels / redValues.length,
    sampleCount: redValues.length
  }
}

function isWhiteLike(rgb, threshold) {
  const limit = Number(threshold) || 248
  return Math.min.apply(null, rgb) >= limit && Math.max.apply(null, rgb) - Math.min.apply(null, rgb) <= 9
}

function isAxisLabelBand(imageData, width, height, x0, y0, columns, cellWidth, cellHeight, rowIndex) {
  let white = 0
  let ink = 0
  let checked = 0
  const colors = Object.create(null)
  const sampleEvery = Math.max(1, Math.floor(columns / 48))
  for (let column = 0; column < columns; column += sampleEvery) {
    const cell = dominantCellColor(
      imageData,
      width,
      height,
      x0 + column * cellWidth,
      y0 + rowIndex * cellHeight,
      x0 + (column + 1) * cellWidth,
      y0 + (rowIndex + 1) * cellHeight
    )
    checked += 1
    if (isWhiteLike(cell.rgb, 244)) white += 1
    if (cell.inkRatio >= 0.012) ink += 1
    const colorKey = cell.rgb.map((value) => Math.round(value / 16)).join('-')
    colors[colorKey] = (colors[colorKey] || 0) + 1
  }
  const dominant = Object.keys(colors).reduce((best, key) => Math.max(best, colors[key]), 0)
  return checked >= 8 && (
    (white / checked >= 0.72 && ink / checked >= 0.55) ||
    (ink / checked >= 0.82 && dominant / checked >= 0.72)
  )
}

function isAxisLabelColumn(imageData, width, height, x0, y0, rows, cellWidth, cellHeight, columnIndex) {
  let white = 0
  let ink = 0
  let checked = 0
  const colors = Object.create(null)
  const sampleEvery = Math.max(1, Math.floor(rows / 48))
  for (let row = 0; row < rows; row += sampleEvery) {
    const cell = dominantCellColor(
      imageData,
      width,
      height,
      x0 + columnIndex * cellWidth,
      y0 + row * cellHeight,
      x0 + (columnIndex + 1) * cellWidth,
      y0 + (row + 1) * cellHeight
    )
    checked += 1
    if (isWhiteLike(cell.rgb, 244)) white += 1
    if (cell.inkRatio >= 0.012) ink += 1
    const colorKey = cell.rgb.map((value) => Math.round(value / 16)).join('-')
    colors[colorKey] = (colors[colorKey] || 0) + 1
  }
  const dominant = Object.keys(colors).reduce((best, key) => Math.max(best, colors[key]), 0)
  return checked >= 8 && (
    (white / checked >= 0.72 && ink / checked >= 0.55) ||
    (ink / checked >= 0.82 && dominant / checked >= 0.72)
  )
}

function buildCounts(matrix) {
  const counts = Object.create(null)
  matrix.forEach((row) => row.forEach((code) => {
    if (code) counts[code] = (counts[code] || 0) + 1
  }))
  return counts
}

function createCachedColorMatcher(palette) {
  const cache = Object.create(null)
  let misses = 0
  return {
    find(rgb) {
      const key = rgb.join(',')
      if (!Object.prototype.hasOwnProperty.call(cache, key)) {
        cache[key] = findNearestColor(rgb, palette)
        misses += 1
      }
      return cache[key]
    },
    get size() { return misses }
  }
}

function rgbDistance(left, right) {
  return Math.sqrt(
    Math.pow(left[0] - right[0], 2) +
    Math.pow(left[1] - right[1], 2) +
    Math.pow(left[2] - right[2], 2)
  )
}

function stabilizeLabeledMatrix(sampleRows, matrix, variantsByCode) {
  const stableCenters = []
  Object.keys(variantsByCode).forEach((code) => {
    const variants = Object.keys(variantsByCode[code])
      .map((rgb) => ({ rgb: rgb.split(',').map(Number), count: variantsByCode[code][rgb] }))
      .sort((a, b) => b.count - a.count)
    const total = variants.reduce((sum, item) => sum + item.count, 0)
    if (code !== 'T1' && variants[0] && variants[0].count >= 8 && variants[0].count / Math.max(1, total) >= 0.45) {
      stableCenters.push({ code, rgb: variants[0].rgb })
    }
  })
  if (stableCenters.length < 2) return matrix

  const centers = preparePalette(stableCenters)
  const centerMatcher = createCachedColorMatcher(centers)
  const centerMap = stableCenters.reduce((result, item) => {
    result[item.code] = item.rgb
    return result
  }, Object.create(null))
  const reliable = matrix.map((row, rowIndex) => row.map((code, columnIndex) => {
    const center = centerMap[code]
    return center && rgbDistance(sampleRows[rowIndex][columnIndex].rgb, center) <= 18 ? code : ''
  }))

  return matrix.map((row, rowIndex) => row.map((code, columnIndex) => {
    // An uncommon colour is not noise: retain colours for which there is no
    // stable centre instead of replacing real details with a neighbour.
    if (!code || !centerMap[code] || reliable[rowIndex][columnIndex]) return code
    const neighbors = Object.create(null)
    for (let y = Math.max(0, rowIndex - 1); y <= Math.min(matrix.length - 1, rowIndex + 1); y += 1) {
      for (let x = Math.max(0, columnIndex - 1); x <= Math.min(row.length - 1, columnIndex + 1); x += 1) {
        if (x === columnIndex && y === rowIndex) continue
        const neighbor = reliable[y][x]
        if (neighbor) neighbors[neighbor] = (neighbors[neighbor] || 0) + 1
      }
    }
    const neighborCode = Object.keys(neighbors).sort((a, b) => neighbors[b] - neighbors[a])[0]
    if (neighborCode && neighbors[neighborCode] >= 3) return neighborCode
    const rgb = sampleRows[rowIndex][columnIndex].rgb
    if (Math.min.apply(null, rgb) >= 254 && Math.max.apply(null, rgb) - Math.min.apply(null, rgb) === 0) return ''
    const nearest = centerMatcher.find(rgb)
    return nearest ? nearest.code : code
  }))
}

function hasCellLabel(cell) {
  const rgb = cell.rgb || [255, 255, 255]
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  if (luminance < 135) {
    return ((cell.lightInkRatio >= 0.01 && cell.lightInkRatio <= 0.24) || cell.inkRatio >= 0.02) && cell.whiteRatio <= 0.18
  }
  return cell.inkRatio >= 0.01
}

function sampleGridCells(imageData, width, height, geometry) {
  const sampleRows = []
  for (let row = 0; row < geometry.rows; row += 1) {
    const samples = []
    for (let column = 0; column < geometry.columns; column += 1) {
      samples.push(dominantCellColor(
        imageData,
        width,
        height,
        geometry.x + column * geometry.cellWidth,
        geometry.y + row * geometry.cellHeight,
        geometry.x + (column + 1) * geometry.cellWidth,
        geometry.y + (row + 1) * geometry.cellHeight
      ))
    }
    sampleRows.push(samples)
  }
  return sampleRows
}

function* classifySampleRowsSteps(sampleRows, rawPalette, options, metadata) {
  const settings = options || {}
  const details = metadata || {}
  const rows = sampleRows.length
  const columns = rows && sampleRows[0] ? sampleRows[0].length : 0
  const palette = preparePalette(rawPalette)
  const pixelInput = ['native-pixel', 'pixel-grid'].indexOf(details.recognitionMode) >= 0
  const recognitionPalette = pixelInput ? palette : prepareRecognitionPalette(rawPalette)
  const matcher = createCachedColorMatcher(recognitionPalette)
  const labeledCells = sampleRows.reduce((sum, row) => sum + row.filter(hasCellLabel).length, 0)
  const labeledGrid = !pixelInput && labeledCells / Math.max(1, columns * rows) >= 0.08
  const matrix = []
  const observedVariants = Object.create(null)
  for (let row = 0; row < rows; row += 1) {
    const output = []
    for (let column = 0; column < columns; column += 1) {
      const cell = sampleRows[row][column]
      const labeled = !pixelInput && hasCellLabel(cell)
      const noLabel = labeledGrid && !labeled
      if (noLabel || ((isWhiteLike(cell.rgb, Number(settings.blankThreshold) || 249) || cell.whiteRatio >= 0.36) && !labeled)) {
        output.push('')
      } else {
        const nearest = matcher.find(cell.rgb)
        const code = nearest ? nearest.code : ''
        output.push(code)
        if (code) {
          if (!observedVariants[code]) observedVariants[code] = Object.create(null)
          const key = cell.rgb.join(',')
          observedVariants[code][key] = (observedVariants[code][key] || 0) + 1
        }
      }
    }
    matrix.push(output)
    yield (row + 1) / Math.max(1, rows)
  }
  const stabilizedMatrix = labeledGrid ? stabilizeLabeledMatrix(sampleRows, matrix, observedVariants) : matrix
  const counts = buildCounts(stabilizedMatrix)
  const beadCount = Object.keys(counts).reduce((sum, code) => sum + counts[code], 0)
  return {
    ok: true,
    matrix: stabilizedMatrix,
    stats: buildStats(counts, palette),
    palette,
    width: columns,
    height: rows,
    beadCount,
    blankCount: columns * rows - beadCount,
    usedColorCount: Object.keys(counts).length,
    recognitionMode: details.recognitionMode || 'guide-grid',
    confidence: Math.max(0, Math.min(0.99, Number(details.confidence) || 0.9)),
    labeledGrid,
    observedVariants: Object.keys(observedVariants).reduce((result, code) => {
      result[code] = Object.keys(observedVariants[code])
        .map((rgb) => ({ rgb: rgb.split(',').map(Number), count: observedVariants[code][rgb] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
      return result
    }, {}),
    uniqueSampleColorCount: matcher.size,
    grid: details.grid || null
  }
}

function classifySampleRows(sampleRows, rawPalette, options, metadata) {
  const task = classifySampleRowsSteps(sampleRows, rawPalette, options, metadata)
  let next = task.next()
  while (!next.done) next = task.next()
  return next.value
}

async function classifySampleRowsAsync(sampleRows, rawPalette, options, metadata) {
  const settings = options || {}
  const task = classifySampleRowsSteps(sampleRows, rawPalette, settings, metadata)
  let checkpoint = Date.now()
  let next = task.next()
  while (!next.done) {
    if (Date.now() - checkpoint >= 8 || next.value === 1) {
      if (typeof settings.onClassificationProgress === 'function') {
        await settings.onClassificationProgress(next.value)
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      checkpoint = Date.now()
    }
    next = task.next()
  }
  return next.value
}

function recognizeKnownGrid(imageData, width, height, columns, rows, rawPalette, options) {
  const settings = options || {}
  const geometry = {
    x: Number(settings.x) || 0,
    y: Number(settings.y) || 0,
    cellWidth: Number(settings.cellWidth) || width / columns,
    cellHeight: Number(settings.cellHeight) || height / rows,
    columns: Number(columns),
    rows: Number(rows)
  }
  if (!imageData || !imageData.data || geometry.columns < 1 || geometry.rows < 1) return { ok: false, reason: 'invalid-grid' }
  return classifySampleRows(sampleGridCells(imageData, width, height, geometry), rawPalette, settings, {
    confidence: settings.confidence || 0.96,
    grid: geometry,
    recognitionMode: settings.recognitionMode || 'known-grid'
  })
}

function recognizeGenericGrid(imageData, width, height, rawPalette, options) {
  const geometry = detectGenericGridGeometry(imageData, width, height, options)
  if (!geometry.ok) return geometry
  return classifySampleRows(sampleGridCells(imageData, width, height, geometry), rawPalette, options, {
    confidence: geometry.confidence,
    recognitionMode: 'regular-grid',
    grid: geometry
  })
}

function recognizePixelGrid(imageData, width, height, rawPalette, options) {
  const geometry = detectPixelGridGeometry(imageData, width, height, options)
  if (!geometry.ok) return geometry
  return classifySampleRows(sampleGridCells(imageData, width, height, geometry), rawPalette, options, {
    confidence: geometry.confidence,
    recognitionMode: 'pixel-grid',
    grid: geometry
  })
}

function detectGuideGridGeometry(imageData, width, height, options) {
  const settings = options || {}
  if (!imageData || !imageData.data || width < 120 || height < 120) return { ok: false, reason: 'image-too-small' }
  const guidePeaksX = groupGuideProjectionPeaks(guideProjection(imageData, width, height, 'x'))
  const guidePeaksY = groupGuideProjectionPeaks(guideProjection(imageData, width, height, 'y'))
  let spacingX = analyzePeakSpacing(guidePeaksX)
  let spacingY = analyzePeakSpacing(guidePeaksY)
  if (!spacingX || !spacingY) return { ok: false, reason: 'guide-lines-not-found' }
  spacingX = reduceSpacingHarmonic(spacingX, spacingY, guidePeaksX)
  spacingY = reduceSpacingHarmonic(spacingY, spacingX, guidePeaksY)
  if (Math.abs(spacingX.cell - spacingY.cell) > Math.max(spacingX.cell, spacingY.cell) * 0.22) {
    return {
      ok: false,
      reason: 'grid-spacing-mismatch',
      horizontalCell: spacingX.cell,
      verticalCell: spacingY.cell
    }
  }

  const peaksX = spacingX.sequence
  const peaksY = spacingY.sequence

  const cellWidth = spacingX.cell
  const cellHeight = spacingY.cell
  const x0 = peaksX[0].position - cellWidth
  // The exported MARD charts place the first red major guide after the first
  // data cell; the preceding lattice line is the real grid origin.
  const y0 = peaksY[0].position - cellHeight
  const lastGuideX = peaksX[peaksX.length - 1].position
  const lastGuideColumn = Math.round((lastGuideX - x0) / cellWidth)
  let columns = lastGuideColumn + 1
  let rightAxisFound = false
  const lastGuideRow = Math.round((peaksY[peaksY.length - 1].position - y0) / cellHeight)
  let rows = 0
  for (let candidate = lastGuideRow + 1; candidate <= lastGuideRow + 7; candidate += 1) {
    if (y0 + (candidate + 1) * cellHeight > height + cellHeight * 0.5) break
    if (isAxisLabelBand(imageData, width, height, x0, y0, columns, cellWidth, cellHeight, candidate)) {
      rows = candidate
      break
    }
  }
  if (!rows) rows = Math.max(lastGuideRow + 1, Math.round((height - y0 - cellHeight * 2) / cellHeight))

  // Widths such as 99 do not end one cell after the final five-cell guide.
  // Prefer the printed right-hand axis label column; if it is cropped, use
  // the small remaining tail rather than assuming a fixed trailing cell.
  for (let candidate = lastGuideColumn + 1; candidate <= lastGuideColumn + 16; candidate += 1) {
    if (x0 + (candidate + 1) * cellWidth > width + cellWidth * 0.5) break
    if (isAxisLabelColumn(imageData, width, height, x0, y0, rows, cellWidth, cellHeight, candidate)) {
      columns = candidate
      rightAxisFound = true
      break
    }
  }
  if (!rightAxisFound) {
    const remaining = Math.round((width - lastGuideX) / cellWidth) - 1
    if (remaining >= 1 && remaining <= 15) columns = lastGuideColumn + remaining
  }

  const maxGrid = Number(settings.maxGridSize) || 192
  if (columns < 4 || rows < 4 || columns > maxGrid || rows > maxGrid) {
    return { ok: false, reason: 'grid-size-out-of-range', width: columns, height: rows }
  }

  const confidence = Math.max(0, Math.min(0.99,
    0.58 + Math.min(0.16, peaksX.length / 100) + Math.min(0.16, peaksY.length / 120) +
    (spacingX.consistency + spacingY.consistency) * 0.045
  ))

  return {
    ok: true,
    x: x0,
    y: y0,
    cellWidth,
    cellHeight,
    columns,
    rows,
    confidence,
    guideColumns: peaksX.length,
    guideRows: peaksY.length,
    firstGuideX: peaksX[0].position,
    lastGuideX: peaksX[peaksX.length - 1].position,
    firstGuideY: peaksY[0].position,
    lastGuideY: peaksY[peaksY.length - 1].position,
    guideBalance: Math.min(peaksX.length / Math.max(1, Math.ceil((columns - 1) / 5)),
      peaksY.length / Math.max(1, Math.ceil((rows - 1) / 5))),
    spacingConsistency: Math.min(spacingX.consistency, spacingY.consistency)
  }
}

function recognizeGuideGrid(imageData, width, height, rawPalette, options) {
  const geometry = detectGuideGridGeometry(imageData, width, height, options)
  if (!geometry.ok) return geometry
  const grid = {
    x: geometry.x,
    y: geometry.y,
    cellWidth: geometry.cellWidth,
    cellHeight: geometry.cellHeight,
    guideColumns: geometry.guideColumns,
    guideRows: geometry.guideRows
  }
  return classifySampleRows(sampleGridCells(imageData, width, height, geometry), rawPalette, options, {
    confidence: geometry.confidence,
    recognitionMode: 'guide-grid',
    grid
  })
}

module.exports = {
  isGuideRed,
  groupProjectionPeaks,
  analyzePeakSpacing,
  regularPeakSequence,
  detectGuideGridGeometry,
  detectGenericGridGeometry,
  detectPixelGridGeometry,
  nativePixelLikelihood,
  dominantCellColor,
  hasCellLabel,
  prepareRecognitionPalette,
  createCachedColorMatcher,
  sampleGridCells,
  classifySampleRows,
  classifySampleRowsAsync,
  recognizeKnownGrid,
  recognizeGenericGrid,
  recognizePixelGrid,
  recognizeGuideGrid
}
