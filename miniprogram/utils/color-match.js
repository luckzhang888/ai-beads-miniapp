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

function matchImageData(imageData, width, height, rawPalette) {
  const palette = preparePalette(rawPalette)
  const cache = Object.create(null)
  const matrix = new Array(height)
  const counts = Object.create(null)
  const data = imageData.data

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

      // 5 bit/channel cache keeps conversion fast while retaining enough precision.
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

  return {
    matrix,
    stats: buildStats(counts, palette),
    palette
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
  buildStats,
  createPaletteMap
}
