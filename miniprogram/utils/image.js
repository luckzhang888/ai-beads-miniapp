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

async function imageToPattern(imagePath, size, palette) {
  const info = await getImageInfo(imagePath)
  const canvas = createProcessorCanvas(size)
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  const image = await loadCanvasImage(canvas, info.path)

  const sourceWidth = info.width
  const sourceHeight = info.height
  const side = Math.min(sourceWidth, sourceHeight)
  const sx = Math.floor((sourceWidth - side) / 2)
  const sy = Math.floor((sourceHeight - side) / 2)

  ctx.clearRect(0, 0, size, size)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(
    image,
    sx,
    sy,
    side,
    side,
    0,
    0,
    size,
    size
  )

  const imageData = ctx.getImageData(0, 0, size, size)
  return matchImageData(imageData, size, size, palette)
}

module.exports = {
  imageToPattern
}
