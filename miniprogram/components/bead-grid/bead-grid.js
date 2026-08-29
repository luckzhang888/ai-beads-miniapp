Component({
  properties: {
    matrix: { type: Array, value: [] },
    palette: { type: Object, value: {} },
    showCodes: { type: Boolean, value: false },
    showGrid: { type: Boolean, value: true },
    highlightCode: { type: String, value: '' },
    zoom: { type: Number, value: 1 },
    interactive: { type: Boolean, value: false },
    majorGrid: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
    previewSize: { type: Number, value: 148 },
    locked: { type: Boolean, value: false },
    maxZoom: { type: Number, value: 6 }
  },

  data: {
    canvasWidth: 320,
    canvasHeight: 320,
    viewportSize: 320,
    viewportHeight: 320
  },

  observers: {
    'matrix,palette,showCodes,showGrid,highlightCode,zoom,majorGrid,compact,previewSize,locked': function () {
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

    touchDistance(touches) {
      if (!touches || touches.length < 2) return 0
      const first = touches[0]
      const second = touches[1]
      const dx = Number(first.clientX) - Number(second.clientX)
      const dy = Number(first.clientY) - Number(second.clientY)
      return Math.sqrt(dx * dx + dy * dy)
    },

    handleTouchStart(event) {
      if (this.data.compact || this.data.locked || !event.touches || event.touches.length !== 2) return
      const distance = this.touchDistance(event.touches)
      if (!distance) return
      this._pinching = true
      this._pinchStartDistance = distance
      this._pinchStartZoom = Number(this.data.zoom) || 1
      this._lastPinchZoom = this._pinchStartZoom
    },

    handleTouchMove(event) {
      if (!this._pinching || !event.touches || event.touches.length !== 2) return
      const distance = this.touchDistance(event.touches)
      if (!distance || !this._pinchStartDistance) return
      const maxZoom = Math.max(1, Number(this.data.maxZoom) || 6)
      const rawZoom = this._pinchStartZoom * distance / this._pinchStartDistance
      const nextZoom = Math.max(1, Math.min(maxZoom, Math.round(rawZoom * 20) / 20))
      if (Math.abs(nextZoom - this._lastPinchZoom) < 0.05) return
      this._lastPinchZoom = nextZoom
      this.triggerEvent('zoomchange', { zoom: nextZoom })
    },

    handleTouchEnd(event) {
      if (!event.touches || event.touches.length < 2) {
        this._pinching = false
        this._pinchStartDistance = 0
      }
    },

    draw() {
      const matrix = this.data.matrix
      if (!Array.isArray(matrix) || !matrix.length || !matrix[0] || !matrix[0].length) return

      const rows = matrix.length
      const cols = matrix[0].length
      const system = wx.getSystemInfoSync()
      const base = this.data.compact
        ? Math.max(88, Number(this.data.previewSize) || 148)
        : Math.max(280, Math.min(system.windowWidth - 24, 680))
      const maxZoom = Math.max(1, Number(this.data.maxZoom) || 6)
      const zoom = this.data.compact ? 1 : Math.max(1, Math.min(Number(this.data.zoom) || 1, maxZoom))
      const canvasWidth = Math.round(base * zoom)
      const canvasHeight = Math.max(1, Math.round(canvasWidth * rows / cols))
      const viewportSize = base
      const viewportHeight = this.data.compact
        ? base
        : Math.min(
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

        if (this.data.majorGrid && Math.min(cellX, cellY) >= 3) {
          ctx.beginPath()
          ctx.strokeStyle = 'rgba(210, 35, 62, 0.82)'
          ctx.lineWidth = Math.min(cellX, cellY) >= 9 ? 1.4 : 0.9
          for (let x = 0; x <= cols; x += 5) {
            const pos = Math.min(width, x * cellX)
            ctx.moveTo(pos, 0)
            ctx.lineTo(pos, height)
          }
          for (let y = 0; y <= rows; y += 5) {
            const pos = Math.min(height, y * cellY)
            ctx.moveTo(0, pos)
            ctx.lineTo(width, pos)
          }
          ctx.stroke()
        }
      }

      if (this.data.showCodes && Math.min(cellX, cellY) >= 8) {
        const cell = Math.min(cellX, cellY)
        const fontSize = Math.max(4.5, Math.min(12, cell * 0.48))
        ctx.font = '600 ' + fontSize + 'px sans-serif'
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
