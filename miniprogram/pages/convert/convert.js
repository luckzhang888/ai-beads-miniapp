Page({
  data: {
    imagePath: '',
    sizes: [32, 48, 64, 128],
    sizeIndex: 2,
    brand: 'DEMO'
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ imagePath: res.tempFiles[0].tempFilePath })
      }
    })
  },

  onSizeChange(e) {
    this.setData({ sizeIndex: Number(e.detail.value) })
  },

  generate() {
    if (!this.data.imagePath) {
      wx.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }
    const size = this.data.sizes[this.data.sizeIndex]
    wx.navigateTo({
      url: `/pages/pattern/pattern?size=${size}`
    })
  }
})
