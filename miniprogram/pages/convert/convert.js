const demoPalette = require('../../data/colors/demo')
const { imageToPattern, recommendPatternSize } = require('../../utils/image')
const { createPattern, savePattern } = require('../../utils/pattern')

Page({
  data: {
    sizes: [32, 48, 64, 128],
    selectedSize: 64,
    recommendedSize: 64,
    imagePath: '',
    generating: false,
    paletteName: 'DEMO 演示色卡',
    cropMode: 'cover',
    imageMode: 'aspectFill',
    optimizePreset: 'natural',
    optimizeOptions: [
      { value: 'soft', label: '柔和' },
      { value: 'natural', label: '自然' },
      { value: 'vivid', label: '增强' }
    ]
  },

  selectSize(event) {
    const size = Number(event.currentTarget.dataset.size)
    this.setData({ selectedSize: size })
  },

  selectCrop(event) {
    const cropMode = event.currentTarget.dataset.mode
    this.setData({
      cropMode,
      imageMode: cropMode === 'contain' ? 'aspectFit' : 'aspectFill'
    })
  },

  selectOptimize(event) {
    this.setData({ optimizePreset: event.currentTarget.dataset.preset })
  },

  updateRecommendedSize(path) {
    wx.getImageInfo({
      src: path,
      success: (info) => {
        const recommendedSize = recommendPatternSize(info.width, info.height)
        this.setData({
          recommendedSize,
          selectedSize: recommendedSize
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
      if (!this.data.imagePath) {
        wx.showToast({
          title: '请先选择图片',
          icon: 'none'
        })
      }
      return
    }

    this.setData({ generating: true })
    wx.showLoading({
      title: '生成图纸中',
      mask: true
    })

    try {
      const result = await imageToPattern(
        this.data.imagePath,
        this.data.selectedSize,
        demoPalette,
        {
          cropMode: this.data.cropMode,
          optimizePreset: this.data.optimizePreset
        }
      )

      const pattern = savePattern(createPattern({
        name: '图片图纸 ' + this.data.selectedSize + '×' + this.data.selectedSize,
        matrix: result.matrix,
        stats: result.stats,
        palette: result.palette,
        brand: 'DEMO'
      }))

      wx.navigateTo({
        url: '/pages/pattern/pattern?id=' + encodeURIComponent(pattern.id)
      })
    } catch (error) {
      console.error(error)
      wx.showModal({
        title: '生成失败',
        content: error && error.message
          ? error.message
          : '图片处理失败，请换一张图片后重试。',
        showCancel: false
      })
    } finally {
      wx.hideLoading()
      this.setData({ generating: false })
    }
  }
})
