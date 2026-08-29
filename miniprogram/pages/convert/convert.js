const mardPalette = require('../../data/colors/mard')
const {
  imageToPattern,
  recommendPatternSize,
  calculatePatternDimensions
} = require('../../utils/image')
const {
  createPattern,
  savePattern,
  setCurrentPattern,
  getPatternByShareCode
} = require('../../utils/pattern')

const METHODS = [
  { id: 'diagram', icon: '▧', title: '图纸导入', description: '从相册或相机导入图纸，自动识别并匹配色号', badge: '推荐' },
  { id: 'pdf', icon: '▤', title: 'PDF 导入', description: '选择聊天文件中的 PDF 图纸，当前为 Beta 入口', badge: 'Beta' },
  { id: 'share', icon: '⌘', title: '分享口令导入', description: '通过 AI 豆仓分享口令打开同设备上的图纸' },
  { id: 'pixel', icon: '▦', title: '像素画转图纸', description: '将像素画重新匹配为 MARD 221 色图纸' },
  { id: 'recognize', icon: '◎', title: '无图例识别', description: '没有图例也能按画面颜色自动统计数量' }
]

Page({
  data: {
    stage: 'methods',
    methods: METHODS,
    selectedMethod: '',
    selectedMethodTitle: '',
    pdfFile: null,
    showShareDialog: false,
    shareCode: '',
    sizes: [32, 48, 64, 80, 96, 128],
    selectedSize: 80,
    recommendedSize: 80,
    imagePath: '',
    imageInfo: null,
    outputWidth: 80,
    outputHeight: 80,
    generating: false,
    paletteName: 'MARD 221 标准色',
    cropMode: 'ratio',
    imageMode: 'aspectFit',
    optimizePreset: 'photo',
    qualityMode: 'balanced',
    optimizeOptions: [
      { value: 'soft', label: '柔和' },
      { value: 'natural', label: '自然' },
      { value: 'photo', label: '照片优化' },
      { value: 'vivid', label: '增强' }
    ],
    qualityOptions: [
      { value: 'easy', label: '易制作', hint: '≤24色' },
      { value: 'balanced', label: '平衡', hint: '≤40色' },
      { value: 'detail', label: '高还原', hint: '≤64色' },
      { value: 'full', label: '全色', hint: '不限色' }
    ]
  },

  selectMethod(event) {
    const id = event.currentTarget.dataset.id
    const method = METHODS.find((item) => item.id === id)
    if (!method) return
    if (id === 'share') {
      this.setData({ showShareDialog: true, shareCode: '' })
      return
    }
    if (id === 'pdf') {
      this.choosePdf(method)
      return
    }
    const changes = {
      selectedMethod: id,
      selectedMethodTitle: method.title
    }
    if (id === 'pixel') Object.assign(changes, { optimizePreset: 'natural', qualityMode: 'full' })
    if (id === 'recognize') Object.assign(changes, { optimizePreset: 'photo', qualityMode: 'balanced' })
    this.setData(changes, () => this.chooseImage())
  },

  resetMethods() {
    this.setData({ stage: 'methods', imagePath: '', imageInfo: null, pdfFile: null })
  },

  choosePdf(method) {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf'],
      success: (result) => {
        this.setData({
          stage: 'pdf',
          selectedMethod: method.id,
          selectedMethodTitle: method.title,
          pdfFile: result.tempFiles && result.tempFiles[0]
        })
      }
    })
  },

  previewPdf() {
    const file = this.data.pdfFile
    if (!file || !file.path) return
    wx.openDocument({
      filePath: file.path,
      fileType: 'pdf',
      showMenu: true,
      fail() { wx.showToast({ title: 'PDF 打开失败', icon: 'none' }) }
    })
  },

  onShareInput(event) {
    this.setData({ shareCode: event.detail.value })
  },

  closeShareDialog() {
    this.setData({ showShareDialog: false })
  },

  noop() {},

  importShareCode() {
    const pattern = getPatternByShareCode(this.data.shareCode)
    if (!pattern) {
      wx.showToast({ title: '未找到该口令对应的本地图纸', icon: 'none' })
      return
    }
    setCurrentPattern(pattern)
    this.setData({ showShareDialog: false })
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(pattern.id) })
  },

  refreshOutputSize(extra) {
    const state = Object.assign({}, this.data, extra || {})
    if (!state.imageInfo) return
    const dims = calculatePatternDimensions(
      state.imageInfo.width,
      state.imageInfo.height,
      state.selectedSize,
      state.cropMode
    )
    this.setData({ outputWidth: dims.width, outputHeight: dims.height })
  },

  selectSize(event) {
    const selectedSize = Number(event.currentTarget.dataset.size)
    this.setData({ selectedSize })
    this.refreshOutputSize({ selectedSize })
  },

  selectCrop(event) {
    const cropMode = event.currentTarget.dataset.mode
    this.setData({
      cropMode,
      imageMode: cropMode === 'cover' ? 'aspectFill' : 'aspectFit'
    })
    this.refreshOutputSize({ cropMode })
  },

  selectOptimize(event) {
    this.setData({ optimizePreset: event.currentTarget.dataset.preset })
  },

  selectQuality(event) {
    this.setData({ qualityMode: event.currentTarget.dataset.mode })
  },

  updateRecommendedSize(path) {
    wx.getImageInfo({
      src: path,
      success: (info) => {
        const recommendedSize = recommendPatternSize(info.width, info.height)
        const dims = calculatePatternDimensions(info.width, info.height, recommendedSize, this.data.cropMode)
        this.setData({
          imageInfo: info,
          recommendedSize,
          selectedSize: recommendedSize,
          outputWidth: dims.width,
          outputHeight: dims.height
        })
      }
    })
  },

  chooseImage() {
    const done = (path) => {
      if (path) {
        this.setData({ imagePath: path, stage: 'config' })
        this.updateRecommendedSize(path)
      }
    }

    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success(res) {
          const file = res.tempFiles && res.tempFiles[0]
          done(file ? file.tempFilePath : '')
        }
      })
      return
    }

    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(res) {
        done(res.tempFilePaths && res.tempFilePaths[0])
      }
    })
  },

  async generatePattern() {
    if (!this.data.imagePath || this.data.generating) {
      if (!this.data.imagePath) wx.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }

    this.setData({ generating: true })
    wx.showLoading({ title: '生成图纸中', mask: true })

    try {
      const result = await imageToPattern(
        this.data.imagePath,
        this.data.selectedSize,
        mardPalette,
        {
          cropMode: this.data.cropMode,
          optimizePreset: this.data.optimizePreset,
          qualityMode: this.data.qualityMode
        }
      )

      const pattern = savePattern(createPattern({
        name: '图片图纸 ' + result.width + '×' + result.height,
        matrix: result.matrix,
        stats: result.stats,
        palette: result.palette,
        brand: 'MARD',
        width: result.width,
        height: result.height,
        qualityMode: this.data.qualityMode,
        status: '待拼',
        tags: [this.data.selectedMethodTitle || '图片导入']
      }), mardPalette)

      wx.navigateTo({
        url: '/pages/detail/detail?id=' + encodeURIComponent(pattern.id)
      })
    } catch (error) {
      console.error(error)
      wx.showModal({
        title: '生成失败',
        content: error && error.message ? error.message : '图片处理失败，请换一张图片后重试。',
        showCancel: false
      })
    } finally {
      wx.hideLoading()
      this.setData({ generating: false })
    }
  }
})
