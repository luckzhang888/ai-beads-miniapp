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
    maxZoom: { type: Number, value: 6 },
    completedIndices: { type: Array, value: [] },
    scrollLeft: { type: Number, value: 0 },
    scrollTop: { type: Number, value: 0 }
  },

  data: {
    canvasWidth: 320,
    canvasHeight: 320,
    viewportSize: 320,
    viewportHeight: 320
  },

  observers: {
    'matrix,palette,showCodes,showGrid,highlightCode,zoom,majorGrid,compact,previewSize,locked,completedIndices': function () {
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

    handleNativeTouchStart(event) {
      this._nativeGestureStartedAt = Date.now()
      this._nativeStartZoom = Number(this.data.zoom) || 1
      this._nativeScale = this._nativeStartZoom
      this._nativeMoved = false
      this._nativeWasPinching = Boolean(event.touches && event.touches.length >= 2)
      if (this._nativeWasPinching) this._pinching = true
    },

    handleNativeScale(event) {
      const scale = event.detail && Number(event.detail.scale)
      if (!Number.isFinite(scale)) return
      this._pinching = true
      this._nativeWasPinching = true
      this._nativeScale = Math.max(1, Math.min(Number(this.data.maxZoom) || 6, scale))
    },

    handleNativeChange(event) {
      const detail = event.detail || {}
      if (Number.isFinite(Number(detail.x))) this._nativeX = Number(detail.x)
      if (Number.isFinite(Number(detail.y))) this._nativeY = Number(detail.y)
      if (detail.source) this._nativeMoved = true
    },

    handleNativeTouchEnd() {
      const finalZoom = Math.round((Number(this._nativeScale) || Number(this.data.zoom) || 1) * 100) / 100
      const startZoom = Number(this._nativeStartZoom) || Number(this.data.zoom) || 1
      const changed = Math.abs(finalZoom - startZoom) >= 0.01
      this._pinching = false
      if (this._nativeMoved || this._nativeWasPinching) this._lastGestureAt = Date.now()
      if (changed) this.triggerEvent('zoomchange', { zoom: finalZoom })
      if (this._nativeMoved) {
        this.triggerEvent('viewchange', {
          scrollLeft: Math.max(0, -(Number(this._nativeX) || 0)),
          scrollTop: Math.max(0, -(Number(this._nativeY) || 0))
        })
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
      const canvasWidth = Math.round(base)
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
      const width = Math.max(1, Math.floor(cssWidth))
      const height = Math.max(1, Math.floor(cssHeight))
      const zoom = this.data.compact ? 1 : Math.max(1, Number(this.data.zoom) || 1)
      const desiredDpr = this.data.compact
        ? Math.min(system.pixelRatio || 1, 2)
        : Math.max(2, Math.min(6, zoom * 1.15))
      const budgetDpr = Math.sqrt(6000000 / Math.max(1, width * height))
      const dpr = Math.max(1, Math.min(desiredDpr, budgetDpr))

      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)

      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      const cellX = width / cols
      const cellY = height / rows
      const palette = this.data.palette || {}
      const highlight = this.data.highlightCode
      const completed = new Set(this.data.completedIndices || [])
      const effectiveZoom = this.data.compact ? 1 : Math.max(1, Number(this.data.zoom) || 1)
      const effectiveCell = Math.min(cellX, cellY) * effectiveZoom

      for (let y = 0; y < rows; y += 1) {
        const row = matrix[y]
        for (let x = 0; x < cols; x += 1) {
          const code = row[x]
          const color = palette[code]
          ctx.globalAlpha = highlight && code !== highlight ? 0.14 : 1
          if (!code) {
            ctx.fillStyle = (x + y) % 2 ? '#f2f2f2' : '#ffffff'
          } else {
            ctx.fillStyle = color && color.hex ? color.hex : '#dddddd'
          }
          ctx.fillRect(x * cellX, y * cellY, cellX + 0.5, cellY + 0.5)
          if (code && completed.has(y * cols + x)) {
            ctx.globalAlpha = 0.58
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(x * cellX, y * cellY, cellX + 0.5, cellY + 0.5)
          }
        }
      }

      ctx.globalAlpha = 1

      if (this.data.showGrid && effectiveCell >= 2.2) {
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(0,0,0,0.20)'
        ctx.lineWidth = 0.5 / effectiveZoom
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

        if (this.data.majorGrid && effectiveCell >= 3) {
          ctx.beginPath()
          ctx.strokeStyle = 'rgba(210, 35, 62, 0.82)'
          ctx.lineWidth = (effectiveCell >= 9 ? 1.4 : 0.9) / effectiveZoom
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

      if (this.data.showCodes && effectiveCell >= 8) {
        const cell = Math.min(cellX, cellY)
        const fontSize = Math.max(1.3, Math.min(12, effectiveCell * 0.48) / effectiveZoom)
        ctx.font = '600 ' + fontSize + 'px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        const startX = 0
        const endX = cols
        const startY = 0
        const endY = rows

        for (let y = startY; y < endY; y += 1) {
          for (let x = startX; x < endX; x += 1) {
            const code = matrix[y][x]
            if (!code) continue
            const color = palette[code]
            const rgb = color && color.rgb ? color.rgb : [220, 220, 220]
            const luminance = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114
            ctx.globalAlpha = highlight && code !== highlight ? 0.2 : 0.92
            ctx.fillStyle = luminance > 150 ? '#111111' : '#ffffff'
            ctx.fillText(code, x * cellX + cellX / 2, y * cellY + cellY / 2, cellX * 0.94)
            if (completed.has(y * cols + x) && effectiveCell >= 11) {
              ctx.globalAlpha = 0.9
              ctx.fillStyle = '#59446f'
              ctx.fillText('✓', x * cellX + cellX / 2, y * cellY + cellY / 2, cellX * 0.8)
            }
          }
        }
        ctx.globalAlpha = 1
      }
    },

    handleTap(event) {
      const matrix = this.data.matrix
      if (!this.data.interactive || !matrix.length || !matrix[0] || !matrix[0].length) return
      if (this._pinching || (this._lastGestureAt && Date.now() - this._lastGestureAt < 220)) return

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
