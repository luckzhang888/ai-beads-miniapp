const mardPalette = require('../../data/colors/mard')
const {
  imageToPattern,
  recommendPatternSize,
  calculatePatternDimensions
} = require('../../utils/image')
const { createPattern, savePattern } = require('../../utils/pattern')

Page({
  data: {
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
        this.setData({ imagePath: path })
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
        qualityMode: this.data.qualityMode
      }), mardPalette)

      wx.navigateTo({
        url: '/pages/pattern/pattern?id=' + encodeURIComponent(pattern.id)
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
