const { rgbToLab, deltaE2000 } = require('./lab')

function preparePalette(colors) {
  return colors.map((item) => {
    const copy = Object.assign({}, item)
    copy.lab = Array.isArray(item.lab) ? item.lab : rgbToLab(item.rgb)
    return copy
  })
}

function findNearestColor(rgb, palette) {
  const lab = rgbToLab(rgb)
  let best = palette[0]
  let bestDistance = Infinity

  for (let i = 0; i < palette.length; i += 1) {
    const distance = deltaE2000(lab, palette[i].lab)
    if (distance < bestDistance) {
      bestDistance = distance
      best = palette[i]
    }
  }

  return best
}

function findNearestColors(rgb, palette, limit, excludedCodes) {
  const lab = rgbToLab(rgb)
  const excluded = new Set(excludedCodes || [])
  return palette
    .filter((item) => !excluded.has(item.code))
    .map((item) => Object.assign({}, item, { distance: deltaE2000(lab, item.lab || rgbToLab(item.rgb)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(1, Number(limit) || 5))
}

function shouldTreatAsBlank(r, g, b, alpha, settings) {
  const options = settings || {}
  if (options.removeTransparent !== false && alpha < Number(options.alphaThreshold || 32)) return true
  if (!options.removeBackground) return false
  const threshold = Math.max(200, Math.min(255, Number(options.whiteThreshold) || 245))
  const tolerance = Math.max(0, Math.min(80, Number(options.whiteTolerance) || 20))
  const brightest = Math.max(r, g, b)
  const darkest = Math.min(r, g, b)
  return darkest >= threshold && brightest - darkest <= tolerance
}

function matchPixels(data, width, height, palette, settings) {
  const cache = Object.create(null)
  const matrix = new Array(height)
  const counts = Object.create(null)

  for (let y = 0; y < height; y += 1) {
    const row = new Array(width)
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3]
      let r = data[offset]
      let g = data[offset + 1]
      let b = data[offset + 2]

      if (shouldTreatAsBlank(r, g, b, alpha, settings)) {
        row[x] = ''
        continue
      }

      // 5 bits/channel cache keeps CIEDE2000 practical on a phone.
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      let color = cache[key]
      if (!color) {
        color = findNearestColor([r, g, b], palette)
        cache[key] = color
      }

      row[x] = color.code
      counts[color.code] = (counts[color.code] || 0) + 1
    }
    matrix[y] = row
  }

  return { matrix, counts }
}

function selectPaletteByUsage(counts, palette, limit) {
  const maxColors = Number(limit) || 0
  const used = Object.keys(counts)
  if (!maxColors || used.length <= maxColors) {
    return palette.filter((item) => counts[item.code])
  }

  const selectedCodes = used
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, maxColors)

  const selectedSet = Object.create(null)
  selectedCodes.forEach((code) => { selectedSet[code] = true })
  return palette.filter((item) => selectedSet[item.code])
}

function countMatrix(matrix) {
  const counts = Object.create(null)
  matrix.forEach((row) => {
    row.forEach((code) => {
      if (!code) return
      counts[code] = (counts[code] || 0) + 1
    })
  })
  return counts
}

function cleanupMatrix(matrix, passes) {
  let current = Array.isArray(matrix) ? matrix.map((row) => row.slice()) : []
  const totalPasses = Math.max(0, Math.min(Number(passes) || 0, 2))

  for (let pass = 0; pass < totalPasses; pass += 1) {
    const height = current.length
    const width = height && current[0] ? current[0].length : 0
    const next = current.map((row) => row.slice())

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const currentCode = current[y][x]
        if (!currentCode) continue
        const neighborCounts = Object.create(null)
        let neighborTotal = 0
        let sameCount = 0

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const code = current[ny][nx]
            neighborCounts[code] = (neighborCounts[code] || 0) + 1
            neighborTotal += 1
            if (code === currentCode) sameCount += 1
          }
        }

        let dominantCode = ''
        let dominantCount = 0
        Object.keys(neighborCounts).forEach((code) => {
          if (neighborCounts[code] > dominantCount) {
            dominantCount = neighborCounts[code]
            dominantCode = code
          }
        })

        // Conservative: only remove truly isolated speckles surrounded by one region.
        const required = neighborTotal >= 8 ? 5 : Math.max(3, Math.ceil(neighborTotal * 0.7))
        if (sameCount === 0 && dominantCode && dominantCount >= required) {
          next[y][x] = dominantCode
        }
      }
    }

    current = next
  }

  return current
}

function matchImageData(imageData, width, height, rawPalette, options) {
  const settings = options || {}
  const palette = preparePalette(rawPalette)
  const first = matchPixels(imageData.data, width, height, palette, settings)
  const selectedPalette = selectPaletteByUsage(first.counts, palette, settings.colorLimit)

  let matrix = first.matrix
  if (selectedPalette.length && selectedPalette.length < Object.keys(first.counts).length) {
    matrix = matchPixels(imageData.data, width, height, selectedPalette, settings).matrix
  }

  matrix = cleanupMatrix(matrix, settings.cleanupPasses)
  const counts = countMatrix(matrix)

  return {
    matrix,
    stats: buildStats(counts, palette),
    palette,
    usedColorCount: Object.keys(counts).length
  }
}

function buildStats(counts, palette) {
  const map = Object.create(null)
  palette.forEach((item) => {
    map[item.code] = item
  })

  return Object.keys(counts)
    .map((code) => {
      const color = map[code]
      return {
        code,
        name: color ? color.name : code,
        brand: color ? color.brand : '',
        series: color ? color.series : code.replace(/[0-9]/g, ''),
        rgb: color ? color.rgb : [0, 0, 0],
        hex: color ? color.hex : '#000000',
        required: counts[code]
      }
    })
    .sort((a, b) => b.required - a.required)
}

function createPaletteMap(rawPalette) {
  const map = Object.create(null)
  rawPalette.forEach((item) => {
    map[item.code] = item
  })
  return map
}

function mergeSimilarColors(matrix, rawPalette, threshold, lockedCodes) {
  const palette = preparePalette(rawPalette)
  const paletteMap = Object.create(null)
  palette.forEach((item) => { paletteMap[item.code] = item })
  const counts = countMatrix(matrix)
  const locked = new Set(lockedCodes || [])
  const usedCodes = Object.keys(counts)
  const replacements = Object.create(null)

  usedCodes
    .slice()
    .sort((a, b) => counts[a] - counts[b])
    .forEach((code) => {
      if (locked.has(code) || replacements[code] || !paletteMap[code]) return
      let bestCode = ''
      let bestDistance = Infinity
      usedCodes.forEach((candidate) => {
        if (candidate === code || replacements[candidate] || !paletteMap[candidate]) return
        if (counts[candidate] < counts[code] && !locked.has(candidate)) return
        const distance = deltaE2000(paletteMap[code].lab, paletteMap[candidate].lab)
        if (distance < bestDistance) {
          bestDistance = distance
          bestCode = candidate
        }
      })
      if (bestCode && bestDistance <= Number(threshold || 0)) replacements[code] = bestCode
    })

  return {
    matrix: matrix.map((row) => row.map((code) => replacements[code] || code)),
    replacements
  }
}

module.exports = {
  preparePalette,
  findNearestColor,
  findNearestColors,
  shouldTreatAsBlank,
  matchImageData,
  cleanupMatrix,
  buildStats,
  createPaletteMap,
  mergeSimilarColors
}
