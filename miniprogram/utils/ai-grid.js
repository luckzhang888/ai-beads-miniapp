const { dominantCellColor } = require('./grid-recognition')

function requireUnit(number) {
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1) throw new Error('AI 网格坐标无效，请使用本地识别。')
  return number
}

function validateGuidedAnalysis(analysis) {
  if (!analysis || !analysis.hasGrid || !Number.isInteger(analysis.rows) || !Number.isInteger(analysis.columns) ||
      analysis.rows < 1 || analysis.rows > 256 || analysis.columns < 1 || analysis.columns > 256 ||
      typeof analysis.confidence !== 'number' || analysis.confidence < 0 || analysis.confidence > 1) {
    throw new Error('AI 网格尺寸无效，请使用本地识别。')
  }
  const b = analysis.grid
  if (!b || requireUnit(b.right) - requireUnit(b.left) < 0.02 || requireUnit(b.bottom) - requireUnit(b.top) < 0.02) {
    throw new Error('AI 网格范围无效，请使用本地识别。')
  }
  const defaultCorners = {
    topLeft: [b.left, b.top], topRight: [b.right, b.top],
    bottomLeft: [b.left, b.bottom], bottomRight: [b.right, b.bottom]
  }
  if (Math.abs(Number(analysis.rotation) || 0) > 2 && !analysis.perspective) {
    throw new Error('旋转图纸缺少四角定位，请使用本地识别。')
  }
  const corners = analysis.perspective || defaultCorners
  ;['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].forEach((key) => {
    if (!Array.isArray(corners[key]) || corners[key].length !== 2) throw new Error('AI 透视坐标无效，请使用本地识别。')
    requireUnit(corners[key][0]); requireUnit(corners[key][1])
  })
  const ring = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
  const turns = ring.map((point, index) => {
    const next = ring[(index + 1) % 4]
    const after = ring[(index + 2) % 4]
    return (next[0] - point[0]) * (after[1] - next[1]) -
      (next[1] - point[1]) * (after[0] - next[0])
  })
  if (turns.some((turn) => turn < 0.0004)) throw new Error('AI 透视四角交叉或退化，请使用本地识别。')
  return corners
}

function guidedGridDisagreesWithLocal(analysis, detected, width, height) {
  // A clearly printed title such as 77x93 or 99x106 is authoritative. Red
  // 10/12-cell guide lines can look like the primary grid to the local line
  // detector, so disagreement must not force a lower-quality local fallback.
  if (analysis && analysis.dimensionSource === 'title') return false
  if (!detected || !detected.ok || Number(detected.confidence) < 0.85 ||
      Math.abs(Number(analysis.rotation) || 0) > 2 ||
      !Number.isFinite(detected.cellWidth) || !Number.isFinite(detected.cellHeight)) return false
  const cellRatio = Math.max(detected.cellWidth, detected.cellHeight) /
    Math.max(0.001, Math.min(detected.cellWidth, detected.cellHeight))
  const columnCoverage = detected.columns * detected.cellWidth / width
  const rowCoverage = detected.rows * detected.cellHeight / height
  if (cellRatio > 1.15 || columnCoverage < 0.7 || rowCoverage < 0.7) return false
  return Math.abs(analysis.columns - detected.columns) > Math.max(2, Math.round(detected.columns * 0.12)) ||
    Math.abs(analysis.rows - detected.rows) > Math.max(2, Math.round(detected.rows * 0.12))
}

function createGridMapper(corners) {
  const p00 = corners.topLeft
  const p10 = corners.topRight
  const p01 = corners.bottomLeft
  const p11 = corners.bottomRight
  const dx1 = p10[0] - p11[0]
  const dx2 = p01[0] - p11[0]
  const dx3 = p00[0] - p10[0] + p11[0] - p01[0]
  const dy1 = p10[1] - p11[1]
  const dy2 = p01[1] - p11[1]
  const dy3 = p00[1] - p10[1] + p11[1] - p01[1]
  const divisor = dx1 * dy2 - dx2 * dy1
  if (Math.abs(divisor) < 0.000001) throw new Error('AI 透视四角无法校正，请使用本地识别。')
  const g = (dx3 * dy2 - dx2 * dy3) / divisor
  const h = (dx1 * dy3 - dx3 * dy1) / divisor
  const a = p10[0] - p00[0] + g * p10[0]
  const b = p01[0] - p00[0] + h * p01[0]
  const d = p10[1] - p00[1] + g * p10[1]
  const e = p01[1] - p00[1] + h * p01[1]
  return (u, v) => {
    const denominator = g * u + h * v + 1
    if (Math.abs(denominator) < 0.000001) throw new Error('AI 网格映射无效，请使用本地识别。')
    return [(a * u + b * v + p00[0]) / denominator, (d * u + e * v + p00[1]) / denominator]
  }
}

function fitDetectedGridToDeclaredDimensions(detected, analysis, width, height) {
  if (!detected || !detected.ok || !analysis || !Number.isInteger(analysis.rows) ||
      !Number.isInteger(analysis.columns)) return detected

  const refineGuideAxis = (start, cellSize, guideCount, firstGuide, lastGuide, declaredCount) => {
    const expectedGuides = Math.ceil((declaredCount - 1) / 5)
    if (guideCount !== expectedGuides || guideCount < 4 || !Number.isFinite(firstGuide) ||
        !Number.isFinite(lastGuide) || lastGuide <= firstGuide) return { start, cellSize }
    const refinedCellSize = (lastGuide - firstGuide) / ((guideCount - 1) * 5)
    if (refinedCellSize < cellSize * 0.88 || refinedCellSize > cellSize * 1.12) return { start, cellSize }
    return { start: firstGuide - refinedCellSize, cellSize: refinedCellSize }
  }

  const refinedX = refineGuideAxis(detected.x, detected.cellWidth, detected.guideColumns,
    detected.firstGuideX, detected.lastGuideX, analysis.columns)
  const refinedY = refineGuideAxis(detected.y, detected.cellHeight, detected.guideRows,
    detected.firstGuideY, detected.lastGuideY, analysis.rows)

  const fitAxis = (start, cellSize, declaredCount, extent) => {
    const targetSpan = cellSize * declaredCount
    // `start` comes from real guide-line pixels and identifies the first
    // data-cell boundary. AI bounds are deliberately coarse, while an extra
    // or missing detected count normally comes from the far-side printed
    // axis. Change only the number of cells; never move the measured origin.
    return Math.max(0, Math.min(Math.max(0, extent - targetSpan), start))
  }

  const x = fitAxis(refinedX.start, refinedX.cellSize, analysis.columns, width)
  const y = fitAxis(refinedY.start, refinedY.cellSize, analysis.rows, height)
  return Object.assign({}, detected, {
    x,
    y,
    cellWidth: refinedX.cellSize,
    cellHeight: refinedY.cellSize,
    rows: analysis.rows,
    columns: analysis.columns,
    detectedRows: detected.rows,
    detectedColumns: detected.columns,
    declaredDimensionsApplied: detected.rows !== analysis.rows || detected.columns !== analysis.columns
  })
}

async function sampleGuidedGrid(imageData, width, height, analysis, onProgress) {
  const corners = validateGuidedAnalysis(analysis)
  const map = createGridMapper(corners)
  const source = imageData.data || imageData
  // Normalize every source cell to a larger tile before extracting its fill
  // colour and centre-ink signature. This is deterministic enlargement, not
  // generative repair, so it cannot invent pixels that are absent in source.
  const side = 16
  const cellData = new Uint8ClampedArray(side * side * 4)
  const rows = []
  for (let row = 0; row < analysis.rows; row += 1) {
    const cells = []
    for (let column = 0; column < analysis.columns; column += 1) {
      for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) {
          const [normalizedX, normalizedY] = map((column + (x + 0.5) / side) / analysis.columns,
            (row + (y + 0.5) / side) / analysis.rows)
          const sourceX = Math.max(0, Math.min(width - 1, Math.round(normalizedX * (width - 1))))
          const sourceY = Math.max(0, Math.min(height - 1, Math.round(normalizedY * (height - 1))))
          const from = (sourceY * width + sourceX) * 4
          const to = (y * side + x) * 4
          cellData[to] = source[from]
          cellData[to + 1] = source[from + 1]
          cellData[to + 2] = source[from + 2]
          cellData[to + 3] = source[from + 3]
        }
      }
      cells.push(dominantCellColor({ data: cellData }, side, side, 0, 0, side, side))
    }
    rows.push(cells)
    if (row % 2 === 1 || row + 1 === analysis.rows) {
      if (typeof onProgress === 'function') await onProgress((row + 1) / analysis.rows)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return rows
}

module.exports = {
  validateGuidedAnalysis,
  guidedGridDisagreesWithLocal,
  createGridMapper,
  fitDetectedGridToDeclaredDimensions,
  sampleGuidedGrid
}
