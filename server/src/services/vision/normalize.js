const IMAGE_TYPES = new Set(['bead_pattern', 'pixel_art', 'photo', 'screenshot', 'unknown'])
const BACKGROUNDS = new Set(['white', 'transparent', 'colored', 'complex', 'unknown'])
const DIMENSION_SOURCES = new Set(['title', 'counted', 'estimated', 'unknown'])
const MARD_221_LIMITS = { A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21, H: 23, M: 15 }

class InvalidAnalysisError extends Error {
  constructor(reason) {
    super('AI 返回的图纸结构无效：' + reason)
    this.code = 'AI_INVALID_RESULT'
  }
}

function unit(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new InvalidAnalysisError(label)
  return value
}

function point(value, label) {
  if (!Array.isArray(value) || value.length !== 2) throw new InvalidAnalysisError(label)
  return [unit(value[0], label + '.x'), unit(value[1], label + '.y')]
}

function parseAiJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new InvalidAnalysisError('空响应')
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(clean) } catch (error) { throw new InvalidAnalysisError('不是合法 JSON') }
}

function parseCodes(value) {
  const codes = []
  const seen = new Set()
  if (!Array.isArray(value)) return codes
  value.forEach((rawCode) => {
    const code = String(rawCode || '').trim().toUpperCase()
    const match = code.match(/^([A-Z])([0-9]{1,3})$/)
    if (!match || !MARD_221_LIMITS[match[1]] || Number(match[2]) < 1 ||
      Number(match[2]) > MARD_221_LIMITS[match[1]] || seen.has(code) || codes.length >= 96) return
    seen.add(code)
    codes.push(code)
  })
  return codes
}

function parseLegendEntries(value) {
  const entries = []
  const seen = new Set()
  if (!Array.isArray(value)) return entries
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const code = parseCodes([item.code])[0]
    const count = Number(item.count)
    if (!code || seen.has(code) || !Number.isInteger(count) || count < 1 || count > 65536 || entries.length >= 96) return
    seen.add(code)
    entries.push({ code, count })
  })
  return entries
}

function optionalInteger(value, minimum, maximum, label) {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new InvalidAnalysisError(label)
  return value
}

function normalizeDimensionSource(value) {
  if (value.dimensionSource !== undefined && value.dimensionSource !== null) {
    if (!DIMENSION_SOURCES.has(value.dimensionSource)) throw new InvalidAnalysisError('dimensionSource')
    return value.dimensionSource
  }
  const warningText = Array.isArray(value.warnings) ? value.warnings.join('；') : ''
  if (/标题|标注尺寸|声明尺寸|写明.*[x×]/i.test(warningText)) return 'title'
  if (/逐格计数|数格|逐行.*逐列|网格线计数/.test(warningText)) return 'counted'
  if (/估算|估计|推测|密集方格|±/.test(warningText)) return 'estimated'
  return 'unknown'
}

function validateAiAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidAnalysisError('缺少对象')
  if (!IMAGE_TYPES.has(value.imageType)) throw new InvalidAnalysisError('imageType')
  if (typeof value.hasGrid !== 'boolean') throw new InvalidAnalysisError('hasGrid')
  if (typeof value.hasLabels !== 'boolean') throw new InvalidAnalysisError('hasLabels')
  if (typeof value.rotation !== 'number' || !Number.isFinite(value.rotation) || Math.abs(value.rotation) > 180) throw new InvalidAnalysisError('rotation')
  const confidence = unit(value.confidence, 'confidence')
  if (!BACKGROUNDS.has(value.background)) throw new InvalidAnalysisError('background')
  if (!Array.isArray(value.warnings) || value.warnings.some((item) => typeof item !== 'string')) throw new InvalidAnalysisError('warnings')
  let rows = null
  let columns = null
  let grid = null
  let perspective = null
  const detectedCodes = parseCodes(value.detectedCodes)
  const legendCodes = parseCodes(value.legendCodes)
  const legendEntries = parseLegendEntries(value.legendEntries)
  const declaredColorCount = optionalInteger(value.declaredColorCount, 1, 96, 'declaredColorCount')
  const declaredBeadCount = optionalInteger(value.declaredBeadCount, 1, 65536, 'declaredBeadCount')
  const dimensionSource = normalizeDimensionSource(value)
  if (value.hasGrid) {
    rows = value.rows
    columns = value.columns
    if (!Number.isInteger(rows) || rows < 1 || rows > 256) throw new InvalidAnalysisError('rows')
    if (!Number.isInteger(columns) || columns < 1 || columns > 256) throw new InvalidAnalysisError('columns')
    const raw = value.grid
    if (!raw || typeof raw !== 'object') throw new InvalidAnalysisError('grid')
    grid = {
      left: unit(raw.left, 'grid.left'), top: unit(raw.top, 'grid.top'),
      right: unit(raw.right, 'grid.right'), bottom: unit(raw.bottom, 'grid.bottom')
    }
    if (grid.right - grid.left < 0.02 || grid.bottom - grid.top < 0.02) throw new InvalidAnalysisError('grid 范围过小')
    if (value.perspective !== null && value.perspective !== undefined) {
      const p = value.perspective
      perspective = {
        topLeft: point(p.topLeft, 'topLeft'), topRight: point(p.topRight, 'topRight'),
        bottomLeft: point(p.bottomLeft, 'bottomLeft'), bottomRight: point(p.bottomRight, 'bottomRight')
      }
      const ring = [perspective.topLeft, perspective.topRight, perspective.bottomRight, perspective.bottomLeft]
      const turns = ring.map((point, index) => {
        const next = ring[(index + 1) % 4]
        const after = ring[(index + 2) % 4]
        return (next[0] - point[0]) * (after[1] - next[1]) -
          (next[1] - point[1]) * (after[0] - next[0])
      })
      if (turns.some((turn) => turn < 0.0004)) throw new InvalidAnalysisError('透视四角交叉或退化')
    }
    if (Math.abs(value.rotation) > 2 && !perspective) throw new InvalidAnalysisError('旋转图纸缺少四角坐标')
  }
  return {
    imageType: value.imageType, hasGrid: value.hasGrid, rows, columns, dimensionSource,
    rotation: value.rotation, confidence, hasLabels: value.hasLabels,
    background: value.background, grid, perspective,
    detectedCodes, legendCodes, legendEntries, declaredColorCount, declaredBeadCount,
    warnings: value.warnings.slice(0, 12).map((item) => item.slice(0, 160))
  }
}

module.exports = { parseAiJson, validateAiAnalysis, InvalidAnalysisError }
