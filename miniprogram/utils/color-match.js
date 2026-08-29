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

function matchPixels(data, width, height, palette) {
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

      if (alpha < 32) {
        r = 255
        g = 255
        b = 255
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
  const first = matchPixels(imageData.data, width, height, palette)
  const selectedPalette = selectPaletteByUsage(first.counts, palette, settings.colorLimit)

  let matrix = first.matrix
  if (selectedPalette.length && selectedPalette.length < Object.keys(first.counts).length) {
    matrix = matchPixels(imageData.data, width, height, selectedPalette).matrix
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

module.exports = {
  preparePalette,
  findNearestColor,
  matchImageData,
  cleanupMatrix,
  buildStats,
  createPaletteMap
}
