Page({
  data: {
    size: 64,
    status: '框架已就绪，下一步接入图片像素化与色号匹配。'
  },
  onLoad(options) {
    if (options.size) this.setData({ size: Number(options.size) })
  }
})
