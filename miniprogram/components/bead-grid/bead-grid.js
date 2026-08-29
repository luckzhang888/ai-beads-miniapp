Component({
  properties: {
    matrix: {
      type: Array,
      value: []
    },
    palette: {
      type: Object,
      value: {}
    },
    showCodes: {
      type: Boolean,
      value: false
    },
    showGrid: {
      type: Boolean,
      value: true
    },
    highlightCode: {
      type: String,
      value: ''
    },
    zoom: {
      type: Number,
      value: 1
    }
  },

  data: {
    canvasSize: 320,
    viewportSize: 320
  },

  observers: {
    'matrix,palette,showCodes,showGrid,highlightCode,zoom': function () {
      this.scheduleDraw()
    }
  },

  lifetimes: {
    ready() {
      this.scheduleDraw()
    }
  },

  methods: {
    scheduleDraw() {
      if (this._drawTimer) {
        clearTimeout(this._drawTimer)
      }
      this._drawTimer = setTimeout(() => {
        this.draw()
      }, 30)
    },

    draw() {
      const matrix = this.data.matrix
      if (!Array.isArray(matrix) || !matrix.length) {
        return
      }

      const system = wx.getSystemInfoSync()
      const base = Math.max(280, Math.min(system.windowWidth - 24, 680))
      const zoom = Math.max(1, Math.min(Number(this.data.zoom) || 1, 2))
      const canvasSize = Math.round(base * zoom)
      const viewportSize = base

      this.setData({
        canvasSize,
        viewportSize
      }, () => {
        this.createSelectorQuery()
          .select('#beadCanvas')
          .fields({ node: true, size: true })
          .exec((result) => {
            const res = result && result[0]
            if (!res || !res.node) {
              return
            }
            this.paint(res.node, res.width || canvasSize, matrix)
          })
      })
    },

    paint(canvas, cssSize, matrix) {
      const n = matrix.length
      const system = wx.getSystemInfoSync()
      const maxDpr = n >= 96 ? 1.25 : 2
      const dpr = Math.min(system.pixelRatio || 1, maxDpr)
      const width = Math.max(1, Math.floor(cssSize))

      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(width * dpr)

      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, width)

      const cell = width / n
      const palette = this.data.palette || {}
      const highlight = this.data.highlightCode

      for (let y = 0; y < n; y += 1) {
        const row = matrix[y]
        for (let x = 0; x < row.length; x += 1) {
          const code = row[x]
          const color = palette[code]
          ctx.globalAlpha = highlight && code !== highlight ? 0.14 : 1
          ctx.fillStyle = color && color.hex ? color.hex : '#dddddd'
          ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5)
        }
      }

      ctx.globalAlpha = 1

      if (this.data.showGrid && cell >= 2.2) {
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(0,0,0,0.20)'
        ctx.lineWidth = 0.5

        for (let i = 0; i <= n; i += 1) {
          const pos = Math.min(width, i * cell)
          ctx.moveTo(pos, 0)
          ctx.lineTo(pos, width)
          ctx.moveTo(0, pos)
          ctx.lineTo(width, pos)
        }
        ctx.stroke()
      }

      if (this.data.showCodes && cell >= 13) {
        const fontSize = Math.max(7, Math.min(11, cell * 0.33))
        ctx.font = fontSize + 'px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        for (let y = 0; y < n; y += 1) {
          for (let x = 0; x < matrix[y].length; x += 1) {
            const code = matrix[y][x]
            const color = palette[code]
            const rgb = color && color.rgb ? color.rgb : [220, 220, 220]
            const luminance = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114
            ctx.globalAlpha = highlight && code !== highlight ? 0.2 : 0.92
            ctx.fillStyle = luminance > 150 ? '#111111' : '#ffffff'
            ctx.fillText(
              code,
              x * cell + cell / 2,
              y * cell + cell / 2,
              cell * 0.94
            )
          }
        }
        ctx.globalAlpha = 1
      }
    }
  }
})
