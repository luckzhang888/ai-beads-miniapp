Component({
  properties: {
    matrix: { type: Array, value: [] },
    palette: { type: Object, value: {} },
    showCodes: { type: Boolean, value: false },
    showGrid: { type: Boolean, value: true },
    highlightCode: { type: String, value: '' },
    zoom: { type: Number, value: 1 },
    interactive: { type: Boolean, value: false }
  },

  data: {
    canvasWidth: 320,
    canvasHeight: 320,
    viewportSize: 320,
    viewportHeight: 320
  },

  observers: {
    'matrix,palette,showCodes,showGrid,highlightCode,zoom': function () {
      this.scheduleDraw()
    }
  },

  lifetimes: {
    ready() { this.scheduleDraw() },
    detached() {
      if (this._drawTimer) clearTimeout(this._drawTimer)
    }
  },

  methods: {
    scheduleDraw() {
      if (this._drawTimer) clearTimeout(this._drawTimer)
      this._drawTimer = setTimeout(() => this.draw(), 30)
    },

    draw() {
      const matrix = this.data.matrix
      if (!Array.isArray(matrix) || !matrix.length || !matrix[0] || !matrix[0].length) return

      const rows = matrix.length
      const cols = matrix[0].length
      const system = wx.getSystemInfoSync()
      const base = Math.max(280, Math.min(system.windowWidth - 24, 680))
      const zoom = Math.max(1, Math.min(Number(this.data.zoom) || 1, 3))
      const canvasWidth = Math.round(base * zoom)
      const canvasHeight = Math.max(1, Math.round(canvasWidth * rows / cols))
      const viewportSize = base
      const viewportHeight = Math.min(
        Math.max(280, Math.round(base * 1.25)),
        Math.max(320, Math.round((system.windowHeight || 700) * 0.62))
      )

      this.setData({ canvasWidth, canvasHeight, viewportSize, viewportHeight }, () => {
        this.createSelectorQuery()
          .select('#beadCanvas')
          .fields({ node: true, size: true })
          .exec((result) => {
            const res = result && result[0]
            if (!res || !res.node) return
            this._canvasNode = res.node
            this.paint(res.node, res.width || canvasWidth, res.height || canvasHeight, matrix)
          })
      })
    },

    paint(canvas, cssWidth, cssHeight, matrix) {
      const rows = matrix.length
      const cols = matrix[0].length
      const system = wx.getSystemInfoSync()
      const cells = rows * cols
      const maxDpr = cells >= 12000 ? 1.15 : (cells >= 7000 ? 1.4 : 2)
      const dpr = Math.min(system.pixelRatio || 1, maxDpr)
      const width = Math.max(1, Math.floor(cssWidth))
      const height = Math.max(1, Math.floor(cssHeight))

      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)

      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      const cellX = width / cols
      const cellY = height / rows
      const palette = this.data.palette || {}
      const highlight = this.data.highlightCode

      for (let y = 0; y < rows; y += 1) {
        const row = matrix[y]
        for (let x = 0; x < cols; x += 1) {
          const code = row[x]
          const color = palette[code]
          ctx.globalAlpha = highlight && code !== highlight ? 0.14 : 1
          ctx.fillStyle = color && color.hex ? color.hex : '#dddddd'
          ctx.fillRect(x * cellX, y * cellY, cellX + 0.5, cellY + 0.5)
        }
      }

      ctx.globalAlpha = 1

      if (this.data.showGrid && Math.min(cellX, cellY) >= 2.2) {
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(0,0,0,0.20)'
        ctx.lineWidth = 0.5
        for (let x = 0; x <= cols; x += 1) {
          const pos = Math.min(width, x * cellX)
          ctx.moveTo(pos, 0)
          ctx.lineTo(pos, height)
        }
        for (let y = 0; y <= rows; y += 1) {
          const pos = Math.min(height, y * cellY)
          ctx.moveTo(0, pos)
          ctx.lineTo(width, pos)
        }
        ctx.stroke()
      }

      if (this.data.showCodes && Math.min(cellX, cellY) >= 13) {
        const cell = Math.min(cellX, cellY)
        const fontSize = Math.max(7, Math.min(11, cell * 0.33))
        ctx.font = fontSize + 'px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < cols; x += 1) {
            const code = matrix[y][x]
            const color = palette[code]
            const rgb = color && color.rgb ? color.rgb : [220, 220, 220]
            const luminance = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114
            ctx.globalAlpha = highlight && code !== highlight ? 0.2 : 0.92
            ctx.fillStyle = luminance > 150 ? '#111111' : '#ffffff'
            ctx.fillText(code, x * cellX + cellX / 2, y * cellY + cellY / 2, cellX * 0.94)
          }
        }
        ctx.globalAlpha = 1
      }
    },

    handleTap(event) {
      const matrix = this.data.matrix
      if (!this.data.interactive || !matrix.length || !matrix[0] || !matrix[0].length) return

      const touch = event.changedTouches && event.changedTouches[0]
      const clientX = touch ? touch.clientX : event.detail.x
      const clientY = touch ? touch.clientY : event.detail.y

      this.createSelectorQuery()
        .select('#beadCanvas')
        .boundingClientRect()
        .exec((result) => {
          const rect = result && result[0]
          if (!rect || typeof clientX !== 'number' || typeof clientY !== 'number') return

          const localX = clientX - rect.left
          const localY = clientY - rect.top
          const rows = matrix.length
          const cols = matrix[0].length
          const x = Math.floor((localX / rect.width) * cols)
          const y = Math.floor((localY / rect.height) * rows)

          if (x < 0 || y < 0 || x >= cols || y >= rows) return
          this.triggerEvent('celltap', { x, y, code: matrix[y][x] })
        })
    },

    exportImage() {
      return new Promise((resolve, reject) => {
        const canvas = this._canvasNode
        if (!canvas) {
          reject(new Error('canvas not ready'))
          return
        }
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          quality: 1,
          success: (result) => resolve(result.tempFilePath),
          fail: reject
        }, this)
      })
    }
  }
})
