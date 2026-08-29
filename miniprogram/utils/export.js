function buildPageRanges(width, height, pageSize) {
  const size = Math.max(16, Number(pageSize) || 60)
  const ranges = []
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      ranges.push({
        x,
        y,
        width: Math.min(size, width - x),
        height: Math.min(size, height - y)
      })
    }
  }
  return ranges
}

function canvasToTempFile(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'png',
      quality: 1,
      success(result) { resolve(result.tempFilePath) },
      fail: reject
    })
  })
}

function drawText(ctx, text, x, y, options) {
  const settings = options || {}
  ctx.fillStyle = settings.color || '#2d2732'
  ctx.font = (settings.weight || 400) + ' ' + (settings.size || 16) + 'px sans-serif'
  ctx.textAlign = settings.align || 'left'
  ctx.textBaseline = settings.baseline || 'alphabetic'
  ctx.fillText(String(text), x, y, settings.maxWidth)
}

function drawLegend(ctx, stats, paletteMap, width, top) {
  const columns = Math.max(2, Math.min(5, Math.floor(width / 220)))
  const columnWidth = width / columns
  const rowHeight = 32
  stats.forEach((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = column * columnWidth + 14
    const y = top + row * rowHeight
    const color = paletteMap[item.code]
    ctx.fillStyle = color ? color.hex : '#dddddd'
    ctx.beginPath()
    ctx.arc(x + 8, y + 11, 7, 0, Math.PI * 2)
    ctx.fill()
    drawText(ctx, item.code + '  ×' + item.required, x + 23, y + 16, { size: 14, weight: 600 })
  })
  return Math.ceil(stats.length / columns) * rowHeight
}

function drawPatternPage(pattern, paletteMap, range, options) {
  const settings = options || {}
  const cell = Math.max(8, Number(settings.cellSize) || 20)
  const left = 48
  const top = 70
  const right = 24
  const legendHeight = settings.includeLegend === false
    ? 0
    : Math.ceil((pattern.stats || []).length / Math.max(2, Math.min(5, Math.floor((left + range.width * cell + right) / 220)))) * 32 + 52
  const width = left + range.width * cell + right
  const height = top + range.height * cell + 24 + legendHeight
  const canvas = wx.createOffscreenCanvas({ type: '2d', width, height })
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const pageLabel = settings.pageLabel ? ' · ' + settings.pageLabel : ''
  drawText(ctx, pattern.name + pageLabel, 14, 28, { size: 18, weight: 700 })
  drawText(ctx, pattern.brand + ' · ' + pattern.width + '×' + pattern.height, 14, 50, { size: 12, color: '#807789' })

  for (let localY = 0; localY < range.height; localY += 1) {
    const sourceY = range.y + localY
    for (let localX = 0; localX < range.width; localX += 1) {
      const sourceX = range.x + localX
      const code = pattern.matrix[sourceY][sourceX]
      const color = paletteMap[code]
      ctx.fillStyle = code && color ? color.hex : ((sourceX + sourceY) % 2 ? '#f2f2f2' : '#ffffff')
      ctx.fillRect(left + localX * cell, top + localY * cell, cell, cell)
      if (settings.showCodes !== false && code && cell >= 10) {
        const rgb = color && color.rgb ? color.rgb : [220, 220, 220]
        const luminance = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114
        drawText(ctx, code, left + localX * cell + cell / 2, top + localY * cell + cell / 2, {
          size: Math.max(5, Math.min(10, cell * 0.43)),
          weight: 650,
          color: luminance > 150 ? '#17141a' : '#ffffff',
          align: 'center',
          baseline: 'middle',
          maxWidth: cell * 0.92
        })
      }
    }
  }

  for (let x = 0; x <= range.width; x += 1) {
    const sourceX = range.x + x
    ctx.beginPath()
    ctx.strokeStyle = sourceX % 10 === 0 ? '#7d2140' : (sourceX % 5 === 0 ? '#d32952' : 'rgba(30,25,35,.22)')
    ctx.lineWidth = sourceX % 5 === 0 ? 1.2 : 0.45
    ctx.moveTo(left + x * cell, top)
    ctx.lineTo(left + x * cell, top + range.height * cell)
    ctx.stroke()
    if (x < range.width && sourceX % 5 === 0) {
      drawText(ctx, sourceX + 1, left + x * cell + 3, top - 8, { size: 10, color: '#6f6676' })
    }
  }
  for (let y = 0; y <= range.height; y += 1) {
    const sourceY = range.y + y
    ctx.beginPath()
    ctx.strokeStyle = sourceY % 10 === 0 ? '#7d2140' : (sourceY % 5 === 0 ? '#d32952' : 'rgba(30,25,35,.22)')
    ctx.lineWidth = sourceY % 5 === 0 ? 1.2 : 0.45
    ctx.moveTo(left, top + y * cell)
    ctx.lineTo(left + range.width * cell, top + y * cell)
    ctx.stroke()
    if (y < range.height && sourceY % 5 === 0) {
      drawText(ctx, sourceY + 1, left - 8, top + y * cell + 4, { size: 10, color: '#6f6676', align: 'right' })
    }
  }

  if (settings.includeLegend !== false) {
    const legendTop = top + range.height * cell + 34
    drawText(ctx, '色号清单', 14, legendTop - 10, { size: 14, weight: 700 })
    drawLegend(ctx, pattern.stats || [], paletteMap, width, legendTop)
  }
  return canvasToTempFile(canvas)
}

async function exportPatternImages(pattern, paletteMap, options) {
  const settings = options || {}
  const fullRange = { x: 0, y: 0, width: pattern.width, height: pattern.height }
  const fullCell = Math.max(8, Math.min(22, Math.floor(3400 / Math.max(pattern.width, pattern.height))))
  const images = [await drawPatternPage(pattern, paletteMap, fullRange, {
    cellSize: fullCell,
    showCodes: true,
    includeLegend: true
  })]
  if (settings.paginate && Math.max(pattern.width, pattern.height) > 60) {
    const ranges = buildPageRanges(pattern.width, pattern.height, 60)
    for (let index = 0; index < ranges.length; index += 1) {
      images.push(await drawPatternPage(pattern, paletteMap, ranges[index], {
        cellSize: 22,
        showCodes: true,
        includeLegend: false,
        pageLabel: '分页 ' + (index + 1) + '/' + ranges.length
      }))
    }
  }
  return images
}

function saveImagesToAlbum(paths) {
  return paths.reduce((promise, filePath) => promise.then(() => new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })
  })), Promise.resolve())
}

module.exports = {
  buildPageRanges,
  exportPatternImages,
  saveImagesToAlbum
}
