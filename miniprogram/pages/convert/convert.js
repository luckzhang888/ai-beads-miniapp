const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
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
  { id: 'share', icon: '⌘', title: '分享口令导入', description: '通过 AI豆仓分享口令打开同设备上的图纸' },
  { id: 'link', icon: '↗', title: '图片链接提取', description: '粘贴可公开访问的 JPG/PNG 图片直链后识别' },
  { id: 'pixel', icon: '▦', title: '像素画转图纸', description: '将像素画重新匹配为 MARD 221 色图纸' },
  { id: 'recognize', icon: '◎', title: 'AI 智能统计', description: '上传图片后自动识别网格、匹配色号并统计数量' }
]

Page({
  data: {
    stage: 'methods',
    methods: METHODS,
    selectedMethod: '',
    selectedMethodTitle: '',
    pdfFile: null,
    showShareDialog: false,
    showLinkDialog: false,
    shareCode: '',
    linkInput: '',
    linkExtracting: false,
    sizes: [32, 48, 64, 80, 96, 128],
    selectedSize: 80,
    recommendedSize: 80,
    imagePath: '',
    imageInfo: null,
    outputWidth: 80,
    outputHeight: 80,
    generating: false,
    batchImporting: false,
    batchProgress: '',
    previewing: false,
    previewResult: null,
    sourceVariant: 'main',
    sourceVariants: [
      { value: 'main', label: '主图' },
      { value: 'mirror', label: '镜像图' },
      { value: 'effect', label: '效果图' }
    ],
    recognitionProgress: 0,
    recognitionStep: '等待图片',
    recognitionResult: null,
    recognitionSaving: false,
    paletteMap: createPaletteMap(mardPalette),
    paletteName: 'MARD 221 标准色',
    cropMode: 'ratio',
    imageMode: 'aspectFit',
    optimizePreset: 'photo',
    qualityMode: 'balanced',
    removeBackground: true,
    whiteThreshold: 245,
    cropX: 0,
    cropY: 0,
    cropScale: 1,
    cropRotation: 0,
    cropMirrored: false,
    cropStyle: 'transform: translate(0px, 0px) scale(1) rotate(0deg) scaleX(1);',
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

  onLoad(options) {
    if (!options || options.mode !== 'recognize') return
    const method = METHODS.find((item) => item.id === 'recognize')
    this.setData({ selectedMethod: method.id, selectedMethodTitle: method.title }, () => {
      if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: 'AI 智能录入' })
      this.chooseImage()
    })
  },

  selectMethod(event) {
    const id = event.currentTarget.dataset.id
    const method = METHODS.find((item) => item.id === id)
    if (!method) return
    if (id === 'share') {
      this.setData({ showShareDialog: true, shareCode: '' })
      return
    }
    if (id === 'link') {
      this.openLinkDialog()
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
    this.setData({
      stage: 'methods',
      imagePath: '',
      imageInfo: null,
      pdfFile: null,
      previewResult: null,
      recognitionResult: null,
      recognitionProgress: 0,
      recognitionStep: '等待图片',
      sourceVariant: 'main',
      cropX: 0,
      cropY: 0,
      cropScale: 1,
      cropRotation: 0,
      cropMirrored: false,
      cropStyle: 'transform: translate(0px, 0px) scale(1) rotate(0deg) scaleX(1);'
    })
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

  openLinkDialog() {
    this.setData({ showLinkDialog: true, linkInput: '' })
    if (typeof wx.getClipboardData === 'function') {
      wx.getClipboardData({
        success: (result) => {
          const value = String(result.data || '').trim()
          if (/^https?:\/\//i.test(value)) this.setData({ linkInput: value })
        }
      })
    }
  },

  closeLinkDialog() { this.setData({ showLinkDialog: false, linkExtracting: false }) },
  onLinkInput(event) { this.setData({ linkInput: event.detail.value }) },

  extractImageLink() {
    const url = String(this.data.linkInput || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      wx.showToast({ title: '请输入完整的图片链接', icon: 'none' })
      return
    }
    if (this.data.linkExtracting) return
    this.setData({ linkExtracting: true })
    wx.showLoading({ title: '下载图片中', mask: true })
    wx.downloadFile({
      url,
      success: (result) => {
        if (Number(result.statusCode) < 200 || Number(result.statusCode) >= 300 || !result.tempFilePath) {
          wx.showToast({ title: '图片链接无法下载', icon: 'none' })
          return
        }
        this.setData({
          showLinkDialog: false,
          selectedMethod: 'recognize',
          selectedMethodTitle: '图片链接提取'
        })
        this.acceptImagePath(result.tempFilePath)
      },
      fail: () => wx.showModal({
        title: '链接提取失败',
        content: '目前支持 JPG/PNG 图片直链。小红书等分享页面需要经过已备案的服务端解析，不能在小程序客户端绕过平台限制。',
        showCancel: false
      }),
      complete: () => {
        wx.hideLoading()
        this.setData({ linkExtracting: false })
      }
    })
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
    this.setData({ selectedSize, previewResult: null })
    this.refreshOutputSize({ selectedSize })
  },

  selectCrop(event) {
    const cropMode = event.currentTarget.dataset.mode
    this.setData({
      cropMode,
      imageMode: cropMode === 'cover' ? 'aspectFill' : 'aspectFit',
      previewResult: null
    })
    this.refreshOutputSize({ cropMode })
  },

  selectOptimize(event) {
    this.setData({ optimizePreset: event.currentTarget.dataset.preset, previewResult: null })
  },

  selectQuality(event) {
    this.setData({ qualityMode: event.currentTarget.dataset.mode, previewResult: null })
  },

  toggleBackgroundRemoval(event) {
    this.setData({ removeBackground: Boolean(event.detail.value), previewResult: null })
  },

  changeWhiteThreshold(event) {
    this.setData({ whiteThreshold: Number(event.detail.value), previewResult: null })
  },

  cropTouchStart(event) {
    const touches = event.touches || []
    if (touches.length >= 2) {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      this.cropGesture = {
        type: 'pinch',
        distance: Math.sqrt(dx * dx + dy * dy),
        scale: this.data.cropScale
      }
      return
    }
    if (touches.length === 1) {
      this.cropGesture = {
        type: 'move',
        x: touches[0].clientX,
        y: touches[0].clientY,
        cropX: this.data.cropX,
        cropY: this.data.cropY
      }
    }
  },

  cropTouchMove(event) {
    if (!this.cropGesture) return
    const touches = event.touches || []
    if (this.cropGesture.type === 'pinch' && touches.length >= 2) {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      const distance = Math.sqrt(dx * dx + dy * dy)
      const cropScale = Math.max(0.5, Math.min(4, this.cropGesture.scale * distance / this.cropGesture.distance))
      this.updateCropTransform({ cropScale })
      return
    }
    if (this.cropGesture.type === 'move' && touches.length === 1) {
      const cropX = Math.max(-150, Math.min(150, this.cropGesture.cropX + touches[0].clientX - this.cropGesture.x))
      const cropY = Math.max(-150, Math.min(150, this.cropGesture.cropY + touches[0].clientY - this.cropGesture.y))
      this.updateCropTransform({ cropX, cropY })
    }
  },

  cropTouchEnd() {
    this.cropGesture = null
  },

  selectSourceVariant(event) {
    this.setData({ sourceVariant: event.currentTarget.dataset.value || 'main' })
  },

  confirmSourceVariant() {
    if (!this.data.imagePath) return
    if (this.data.selectedMethod === 'recognize' || this.data.selectedMethod === 'link') {
      this.runAiRecognition()
      return
    }
    this.setData({ stage: 'config' })
  },

  async runAiRecognition() {
    if (!this.data.imagePath || (this.data.recognitionProgress > 0 && this.data.recognitionProgress < 100)) return
    this.cachedSignature = ''
    this.cachedResult = null
    this.setData({
      stage: 'recognizing',
      recognitionProgress: 18,
      recognitionStep: '第 1 步 · 对齐图片网格',
      recognitionResult: null
    })
    try {
      await this.setDataAsync({ recognitionProgress: 48, recognitionStep: '第 2 步 · 统计图例与颜色' })
      const result = await this.processCurrentImage()
      await this.setDataAsync({ recognitionProgress: 82, recognitionStep: '第 3 步 · 匹配 MARD 色号' })
      this.setData({
        recognitionProgress: 100,
        recognitionStep: '识别完成',
        recognitionResult: result,
        previewResult: result
      })
    } catch (error) {
      console.error('AI recognition failed', error)
      this.setData({ stage: 'config', recognitionProgress: 0, recognitionStep: '识别失败' })
      wx.showModal({
        title: '智能识别失败',
        content: error && error.message ? error.message : '无法读取这张图片，请更换清晰图纸后重试。',
        showCancel: false
      })
    }
  },

  saveProcessedPattern(result, settings) {
    const options = settings || {}
    const variant = this.data.sourceVariants.find((item) => item.value === this.data.sourceVariant)
    return savePattern(createPattern({
      name: options.name || ('图片图纸 ' + result.width + '×' + result.height),
      matrix: result.matrix,
      stats: result.stats,
      palette: result.palette,
      brand: 'MARD',
      width: result.width,
      height: result.height,
      qualityMode: this.data.qualityMode,
      status: '待拼',
      tags: [options.tag || this.data.selectedMethodTitle || '图片导入', variant ? variant.label : '主图'],
      sourceOptions: Object.assign({}, this.processingOptions(), { sourceVariant: this.data.sourceVariant })
    }), mardPalette)
  },

  saveRecognitionResult(event) {
    const result = this.data.recognitionResult
    if (!result || this.data.recognitionSaving) return
    this.setData({ recognitionSaving: true })
    try {
      const pattern = this.saveProcessedPattern(result, {
        name: 'AI识别图纸 ' + result.width + '×' + result.height,
        tag: 'AI智能统计'
      })
      const target = event.currentTarget.dataset.target
      wx.redirectTo({
        url: target === 'editor'
          ? ('/pages/editor/editor?id=' + encodeURIComponent(pattern.id))
          : ('/pages/detail/detail?id=' + encodeURIComponent(pattern.id))
      })
    } finally {
      this.setData({ recognitionSaving: false })
    }
  },

  updateCropTransform(changes) {
    const next = Object.assign({}, this.data, changes || {})
    const cropStyle = 'transform: translate(' + next.cropX + 'px, ' + next.cropY + 'px) scale(' +
      Number(next.cropScale).toFixed(2) + ') rotate(' + next.cropRotation + 'deg) scaleX(' +
      (next.cropMirrored ? -1 : 1) + ');'
    this.setData(Object.assign({}, changes, { cropStyle, previewResult: null }))
  },

  rotateCrop() {
    this.updateCropTransform({ cropRotation: (this.data.cropRotation + 90) % 360 })
  },

  toggleCropMirror() {
    this.updateCropTransform({ cropMirrored: !this.data.cropMirrored })
  },

  resetCrop() {
    this.updateCropTransform({ cropX: 0, cropY: 0, cropScale: 1, cropRotation: 0, cropMirrored: false })
  },

  processingOptions() {
    return {
      cropMode: this.data.cropMode,
      optimizePreset: this.data.optimizePreset,
      qualityMode: this.data.qualityMode,
      removeTransparent: true,
      removeBackground: this.data.removeBackground,
      whiteThreshold: this.data.whiteThreshold,
      whiteTolerance: 22,
      transform: {
        offsetX: this.data.cropX / 150,
        offsetY: this.data.cropY / 150,
        scale: this.data.cropScale,
        rotation: this.data.cropRotation,
        mirrored: this.data.cropMirrored
      }
    }
  },

  processingSignature() {
    return JSON.stringify({
      path: this.data.imagePath,
      size: this.data.selectedSize,
      options: this.processingOptions()
    })
  },

  async processCurrentImage() {
    const signature = this.processingSignature()
    if (this.cachedResult && this.cachedSignature === signature) return this.cachedResult
    const result = await imageToPattern(
      this.data.imagePath,
      this.data.selectedSize,
      mardPalette,
      this.processingOptions()
    )
    this.cachedSignature = signature
    this.cachedResult = result
    return result
  },

  async previewPattern() {
    if (!this.data.imagePath || this.data.previewing) return
    this.setData({ previewing: true })
    wx.showLoading({ title: '生成预览', mask: true })
    try {
      const result = await this.processCurrentImage()
      this.setData({ previewResult: result })
    } catch (error) {
      wx.showToast({ title: '预览生成失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ previewing: false })
    }
  },

  updateRecommendedSize(path, ready) {
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
          outputHeight: dims.height,
          previewResult: null
        }, () => { if (typeof ready === 'function') ready(info) })
      },
      fail: () => wx.showModal({ title: '图片读取失败', content: '请确认图片仍在本机并允许小程序访问相册，然后重新选择。', showCancel: false })
    })
  },

  handleImagePickerFailure(error) {
    const message = String(error && error.errMsg ? error.errMsg : '')
    if (message.toLowerCase().indexOf('cancel') >= 0) return
    wx.showModal({
      title: '无法选择图片',
      content: '请检查相册/相机权限；如果当前使用游客 AppID，请改用正式小程序 AppID 后在真机重试。',
      showCancel: false
    })
  },

  acceptImagePath(path) {
    if (!path) return
    this.setData({
      imagePath: path,
      stage: 'classify',
      sourceVariant: 'main',
      recognitionProgress: 0,
      recognitionResult: null,
      previewResult: null
    })
    this.updateRecommendedSize(path)
  },

  chooseImage() {
    const done = (path) => this.acceptImagePath(path)

    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success(res) {
          const file = res.tempFiles && res.tempFiles[0]
          done(file ? file.tempFilePath : '')
        },
        fail: (error) => this.handleImagePickerFailure(error)
      })
      return
    }

    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(res) {
        done(res.tempFilePaths && res.tempFilePaths[0])
      },
      fail: (error) => this.handleImagePickerFailure(error)
    })
  },

  chooseBatchImages() {
    const done = (paths) => {
      if (paths && paths.length) this.processBatchImages(paths.slice(0, 9))
    }
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sourceType: ['album'],
        sizeType: ['compressed'],
        success: (result) => done((result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean)),
        fail: (error) => this.handleImagePickerFailure(error)
      })
      return
    }
    wx.chooseImage({
      count: 9,
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: (result) => done(result.tempFilePaths || []),
      fail: (error) => this.handleImagePickerFailure(error)
    })
  },

  getImageInfo(path) {
    return new Promise((resolve, reject) => wx.getImageInfo({ src: path, success: resolve, fail: reject }))
  },

  setDataAsync(changes) {
    return new Promise((resolve) => this.setData(changes, resolve))
  },

  async processBatchImages(paths) {
    if (this.data.batchImporting) return
    this.setData({ batchImporting: true, batchProgress: '准备处理 0/' + paths.length })
    wx.showLoading({ title: '批量处理中 0/' + paths.length, mask: true })
    const savedPatterns = []
    const original = {
      imagePath: this.data.imagePath,
      imageInfo: this.data.imageInfo,
      outputWidth: this.data.outputWidth,
      outputHeight: this.data.outputHeight,
      cropX: this.data.cropX,
      cropY: this.data.cropY,
      cropScale: this.data.cropScale,
      cropRotation: this.data.cropRotation,
      cropMirrored: this.data.cropMirrored,
      cropStyle: this.data.cropStyle
    }
    try {
      for (let index = 0; index < paths.length; index += 1) {
        try {
          const path = paths[index]
          const info = await this.getImageInfo(path)
          const dims = calculatePatternDimensions(info.width, info.height, this.data.selectedSize, this.data.cropMode)
          await this.setDataAsync({
            imagePath: path,
            imageInfo: info,
            outputWidth: dims.width,
            outputHeight: dims.height,
            cropX: 0,
            cropY: 0,
            cropScale: 1,
            cropRotation: 0,
            cropMirrored: false,
            cropStyle: 'transform: translate(0px, 0px) scale(1) rotate(0deg) scaleX(1);',
            previewResult: null,
            batchProgress: '正在处理 ' + (index + 1) + '/' + paths.length
          })
          this.cachedSignature = ''
          this.cachedResult = null
          const result = await this.processCurrentImage()
          const saved = savePattern(createPattern({
            name: '批量图纸 ' + (index + 1) + ' · ' + result.width + '×' + result.height,
            matrix: result.matrix,
            stats: result.stats,
            palette: result.palette,
            brand: 'MARD',
            width: result.width,
            height: result.height,
            qualityMode: this.data.qualityMode,
            status: '待拼',
            tags: ['批量导入'],
            sourceOptions: this.processingOptions()
          }), mardPalette)
          savedPatterns.push(saved)
          wx.showLoading({ title: '批量处理中 ' + (index + 1) + '/' + paths.length, mask: true })
        } catch (error) {
          console.error('batch image failed', index, error)
        }
      }
    } finally {
      wx.hideLoading()
      await this.setDataAsync(Object.assign({}, original, { batchImporting: false, batchProgress: '' }))
    }
    if (!savedPatterns.length) {
      wx.showModal({ title: '批量导入失败', content: '所选图片均未能识别，请检查图片格式后重试。', showCancel: false })
      return
    }
    const last = savedPatterns[savedPatterns.length - 1]
    setCurrentPattern(last)
    wx.showModal({
      title: '批量导入完成',
      content: '成功生成 ' + savedPatterns.length + '/' + paths.length + ' 张图纸。',
      showCancel: false,
      success: () => wx.redirectTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(last.id) })
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
      const result = await this.processCurrentImage()

      const pattern = this.saveProcessedPattern(result)

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
