const mardPalette = require('../../data/colors/mard')
const { createPaletteMap } = require('../../utils/color-match')
const {
  imageToPattern,
  gridImageToPattern,
  aiGuidedImageToPattern,
  cropImageToFile,
  recommendPatternSize,
  calculatePatternDimensions
} = require('../../utils/image')
const {
  createPattern,
  savePattern,
  showStorageError,
  setCurrentPattern,
  getPatternByShareCode
} = require('../../utils/pattern')
const { recordPatternActivity: recordActivity } = require('../../utils/activity')
const {
  extractUrls,
  extractHtmlImageUrls,
  isKnownSharePage,
  selectBestUrl,
  validateDownload
} = require('../../utils/link')
const { analyzeImage } = require('../../services/ai-recognition')

const METHODS = [
  { id: 'diagram', icon: '▧', title: '图纸导入', description: '从相册或相机导入图纸，自动识别并匹配色号', badge: '推荐' },
  { id: 'pdf', icon: '▤', title: 'PDF 导入', description: '选择聊天文件中的 PDF 图纸，当前为 Beta 入口', badge: 'Beta' },
  { id: 'share', icon: '⌘', title: '分享口令导入', description: '通过豆仓助手分享口令打开同设备上的图纸' },
  { id: 'link', icon: '↗', title: '图片链接提取', description: '粘贴可公开访问的 JPG/PNG 图片直链后识别' },
  { id: 'pixel', icon: '▦', title: '像素画转图纸', description: '将像素画重新匹配为 MARD 221 标准色图纸' },
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
    linkHint: '',
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
    recognitionError: '',
    recognitionSource: '',
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
    cropZoom: 0,
    cropRotation: 0,
    cropMirrored: false,
    recognitionCropEnabled: false,
    longImageManualCrop: false,
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
    if (id === 'recognize') Object.assign(changes, { optimizePreset: 'photo', qualityMode: 'easy' })
    this.setData(changes, () => this.chooseImage())
  },

  resetMethods() {
    this.aiAnalysisCache = null
    this.setData({
      stage: 'methods',
      imagePath: '',
      imageInfo: null,
      pdfFile: null,
      previewResult: null,
      recognitionResult: null,
      recognitionError: '',
      recognitionSource: '',
      recognitionProgress: 0,
      recognitionStep: '等待图片',
      sourceVariant: 'main',
      cropX: 0,
      cropY: 0,
      cropScale: 1,
      cropZoom: 0,
      cropRotation: 0,
      cropMirrored: false,
      recognitionCropEnabled: false,
      longImageManualCrop: false,
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
    this.setData({ showLinkDialog: true, linkInput: '', linkHint: '' })
    if (typeof wx.getClipboardData === 'function') {
      wx.getClipboardData({
        success: (result) => {
          const value = String(result.data || '').trim()
          const urls = extractUrls(value)
          if (urls.length) this.setData({
            linkInput: value,
            linkHint: urls.length > 1 ? ('已从分享文字中找到 ' + urls.length + ' 个链接，将优先使用图片链接') : '已从剪贴板识别到链接'
          })
        }
      })
    }
  },

  closeLinkDialog() { this.setData({ showLinkDialog: false, linkExtracting: false }) },
  onLinkInput(event) {
    const linkInput = event.detail.value
    const urls = extractUrls(linkInput)
    this.setData({
      linkInput,
      linkHint: urls.length ? ('已识别 ' + urls.length + ' 个链接') : ''
    })
  },

  downloadImageFile(url) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url,
        success: (result) => {
          const validation = validateDownload(result)
          if (!validation.ok) {
            reject({ type: 'not-image', validation, url })
            return
          }
          wx.getImageInfo({
            src: result.tempFilePath,
            success: () => resolve(result.tempFilePath),
            fail: (error) => reject({ type: 'decode', error, url })
          })
        },
        fail: (error) => reject({ type: 'download', error, url })
      })
    })
  },

  resolvePublicPageImage(url) {
    return new Promise((resolve, reject) => {
      if (typeof wx.request !== 'function') {
        reject({ type: 'request-unavailable', url })
        return
      }
      wx.request({
        url,
        method: 'GET',
        success: (result) => {
          const statusCode = Number(result.statusCode)
          if (statusCode < 200 || statusCode >= 300) {
            reject({ type: 'page-http', statusCode, url })
            return
          }
          const candidates = extractHtmlImageUrls(typeof result.data === 'string' ? result.data : '', url)
          if (!candidates.length) {
            reject({ type: 'page-no-image', url })
            return
          }
          resolve(selectBestUrl(candidates.join('\n')))
        },
        fail: (error) => reject({ type: 'page-request', error, url })
      })
    })
  },

  async extractImageLink() {
    const raw = String(this.data.linkInput || '').trim()
    const url = selectBestUrl(raw)
    if (!url) {
      wx.showToast({ title: '没有找到 http/https 链接', icon: 'none' })
      return
    }
    if (this.data.linkExtracting) return
    this.setData({ linkExtracting: true })
    wx.showLoading({ title: '下载图片中', mask: true })
    let firstError = null
    try {
      let imagePath
      try {
        imagePath = await this.downloadImageFile(url)
      } catch (error) {
        firstError = error
        const resolvedUrl = await this.resolvePublicPageImage(url)
        if (!resolvedUrl || resolvedUrl === url) throw error
        imagePath = await this.downloadImageFile(resolvedUrl)
      }
      this.setData({
        showLinkDialog: false,
        selectedMethod: 'recognize',
        selectedMethodTitle: '图片链接提取'
      })
      this.acceptImagePath(imagePath)
    } catch (error) {
      const issue = error || firstError || {}
      let content
      if (isKnownSharePage(url)) {
        content = '这是第三方平台分享页，当前页面没有公开可下载的原图。请复制原图直链，或配置符合平台规则的服务端解析接口。'
      } else if (issue.type === 'decode') {
        content = '文件已下载，但微信无法解码为 JPG、PNG、WebP 等图片。'
      } else if (issue.type === 'page-no-image') {
        content = '网页中没有找到可公开访问的 og:image、twitter:image 或原图标签。'
      } else {
        content = '请确认链接公开可访问，并已在微信公众平台同时配置 request 和 downloadFile 合法域名。'
      }
      wx.showModal({ title: '链接提取失败', content, showCancel: false })
    } finally {
      wx.hideLoading()
      this.setData({ linkExtracting: false })
    }
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
    if (this.data.stage === 'classify' && !this.data.recognitionCropEnabled) return
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
      const minimumScale = this.data.cropMode === 'cover' ? 1 : 0.5
      const cropScale = Math.max(minimumScale, Math.min(4, this.cropGesture.scale * distance / this.cropGesture.distance))
      this.updateCropTransform({ cropScale })
      return
    }
    if (this.cropGesture.type === 'move' && touches.length === 1) {
      const cropX = this.cropGesture.cropX + touches[0].clientX - this.cropGesture.x
      const cropY = this.cropGesture.cropY + touches[0].clientY - this.cropGesture.y
      this.updateCropTransform({ cropX, cropY })
    }
  },

  cropTouchEnd() {
    this.cropGesture = null
  },

  toggleRecognitionCrop() {
    const recognitionCropEnabled = !this.data.recognitionCropEnabled
    const cropMode = recognitionCropEnabled ? 'cover' : 'ratio'
    this.cachedSignature = ''
    this.cachedResult = null
    this.aiAnalysisCache = null
    this.setData({
      recognitionCropEnabled,
      longImageManualCrop: recognitionCropEnabled,
      cropMode,
      imageMode: recognitionCropEnabled ? 'aspectFill' : 'aspectFit',
      cropX: 0,
      cropY: 0,
      cropScale: 1,
      cropZoom: 0,
      cropRotation: 0,
      cropMirrored: false,
      cropStyle: 'transform: translate(0px, 0px) scale(1) rotate(0deg) scaleX(1);',
      previewResult: null
    })
    this.refreshOutputSize({ recognitionCropEnabled, cropMode })
  },

  selectSourceVariant(event) {
    this.setData({ sourceVariant: event.currentTarget.dataset.value || 'main' })
  },

  confirmSourceVariant() {
    if (!this.data.imagePath) return
    if (['recognize', 'diagram', 'link'].indexOf(this.data.selectedMethod) >= 0) {
      this.runAiRecognition()
      return
    }
    this.setData({ stage: 'config' })
  },

  neutralProcessingOptions() {
    return Object.assign({}, this.processingOptions(), {
      cropMode: 'ratio',
      transform: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, mirrored: false }
    })
  },

  async prepareRecognitionInput(imagePath) {
    if (!this.data.recognitionCropEnabled) {
      return { path: imagePath, options: this.processingOptions(), temporary: false }
    }
    const path = await cropImageToFile(imagePath, { transform: this.processingOptions().transform })
    return { path, options: this.neutralProcessingOptions(), temporary: path !== imagePath }
  },

  removeTemporaryRecognitionInput(input) {
    if (!input || !input.temporary || !input.path || typeof wx === 'undefined' || !wx.getFileSystemManager) return
    try { wx.getFileSystemManager().unlink({ filePath: input.path, fail() {} }) } catch (error) {}
  },

  async runAiRecognition() {
    if (!this.data.imagePath || (this.data.recognitionProgress > 0 && this.data.recognitionProgress < 100)) return
    const imagePath = this.data.imagePath
    this.cachedSignature = ''
    this.cachedResult = null
    this.setData({
      stage: 'recognizing',
      recognitionProgress: 10,
      recognitionStep: '上传图片',
      recognitionResult: null,
      recognitionError: '',
      recognitionSource: ''
    })
    let preparedInput
    try {
      if (this.data.recognitionCropEnabled) {
        await this.setDataAsync({ recognitionProgress: 16, recognitionStep: '按你确认的方框生成截取图片' })
      }
      preparedInput = await this.prepareRecognitionInput(imagePath)
      const recognitionPath = preparedInput.path
      const cacheKey = this.processingSignature()
      await this.setDataAsync({ recognitionProgress: 25, recognitionStep: 'DeepSeek AI 分析已确认的图片区域' })
      let analysis = this.aiAnalysisCache && this.aiAnalysisCache.signature === cacheKey ? this.aiAnalysisCache.value : null
      if (!analysis) {
        const response = await this.requestAiAnalysis(recognitionPath)
        analysis = response.result
        if (analysis && response.uploadIntegrity) analysis.uploadIntegrity = response.uploadIntegrity
        this.aiAnalysisCache = { signature: cacheKey, value: analysis }
      }
      if (this.data.imagePath !== imagePath) return
      if (!analysis || typeof analysis.hasGrid !== 'boolean') throw new Error('AI 返回的图纸结构无效，请重试或使用本地识别。')
      let result
      let recognitionSource = 'AI'
      if (analysis.hasGrid) {
        try {
          result = await this.processAiGuidedImage(recognitionPath, analysis, (progress, step) => this.setDataAsync({
            recognitionProgress: Math.min(98, Number(progress) || 0),
            recognitionStep: step || '正在识别图纸'
          }), preparedInput.options)
        } catch (error) {
          if (!error || error.code !== 'AI_GRID_MISMATCH') throw error
          await this.setDataAsync({ recognitionProgress: 60, recognitionStep: 'AI 行列不可靠，改用本地网格识别' })
          result = await this.processPreparedLocalImage(recognitionPath, preparedInput.options,
            (progress, step) => this.setDataAsync({
              recognitionProgress: Math.min(98, 60 + (Number(progress) || 0) * 0.38),
              recognitionStep: step || '正在本地识别图纸'
            }))
          recognitionSource = '本地'
          const warning = 'AI 行列估算与本地网格检测不一致，已改用本地识别。请核对网格尺寸、色号和豆数。'
          result.warning = result.warning ? warning + result.warning : warning
          result.validation = Object.assign({}, result.validation, {
            ok: false,
            warnings: [warning].concat(result.validation && result.validation.warnings || [])
          })
        }
      } else {
        await this.setDataAsync({ recognitionProgress: 60, recognitionStep: '无网格图片按指定尺寸重新像素化' })
        result = await this.processAiPhotoImage(recognitionPath, preparedInput.options)
        result.recognitionMode = 'ai-no-grid'
        result.confidence = analysis.confidence
        result.aiAnalysis = analysis
        result.validation = { ok: false, warnings: ['原图没有可逐格复原的网格，当前结果是重新像素化生成'] }
        result.cropApplied = Boolean(this.data.recognitionCropEnabled)
        result.warning = this.data.recognitionCropEnabled
          ? 'AI 未检测到原始网格，已按你拖动和缩放后的选区重新像素化。可继续选择输出尺寸；这不是原图逐格复原。'
          : 'AI 未检测到原始网格，已切换为“主体图片像素化”。长图可返回重新选择并开启“移动裁剪主体”，再选择输出尺寸。'
        recognitionSource = 'AI 分类 + 本地像素化'
      }
      result.cropApplied = Boolean(this.data.recognitionCropEnabled)
      if (this.data.imagePath !== imagePath) return
      this.presentRecognitionResult(result, recognitionSource)
    } catch (error) {
      console.warn('AI recognition failed:', error && error.code || 'AI_RECOGNITION_FAILED', error && error.wxMessage || '')
      if (this.data.imagePath !== imagePath) return
      this.setData({
        stage: 'recognizing', recognitionProgress: 0, recognitionStep: 'AI 识别暂时不可用',
        recognitionError: error && error.message ? error.message : 'AI 识别暂时不可用，请重试或使用本地识别。'
      })
    } finally {
      this.removeTemporaryRecognitionInput(preparedInput)
    }
  },

  requestAiAnalysis(imagePath) {
    const mode = this.data.selectedMethod === 'pixel' ? 'pixel' : 'auto'
    // selectedSize is derived from image pixels, not a counted grid size.
    // Do not bias the vision model with that automatic recommendation.
    return analyzeImage(imagePath, { mode })
  },

  processAiGuidedImage(imagePath, analysis, onProgress, processingOptions) {
    return aiGuidedImageToPattern(imagePath, mardPalette, analysis,
      Object.assign({}, processingOptions || this.processingOptions(), { onProgress }))
  },

  processAiPhotoImage(imagePath, processingOptions) {
    return imageToPattern(imagePath, this.data.selectedSize, mardPalette, processingOptions || this.processingOptions())
  },

  processPreparedLocalImage(imagePath, processingOptions, onProgress) {
    return gridImageToPattern(imagePath, this.data.selectedSize, mardPalette,
      Object.assign({}, processingOptions || this.processingOptions(), { onProgress }))
  },

  retryAiRecognition() {
    this.aiAnalysisCache = null
    this.runAiRecognition()
  },

  async runLocalRecognition() {
    if (!this.data.imagePath || (this.data.recognitionProgress > 0 && this.data.recognitionProgress < 100)) return
    const imagePath = this.data.imagePath
    this.setData({
      stage: 'recognizing', recognitionProgress: 10, recognitionStep: '使用本地识别',
      recognitionError: '', recognitionResult: null, recognitionSource: '本地'
    })
    try {
      const result = await this.processCurrentImage((progress, step) => this.setDataAsync({
        recognitionProgress: Math.min(98, Number(progress) || 0),
        recognitionStep: step || '正在本地识别图纸'
      }))
      if (this.data.imagePath !== imagePath) return
      this.presentRecognitionResult(result, '本地')
    } catch (error) {
      if (this.data.imagePath !== imagePath) return
      this.setData({ recognitionProgress: 0, recognitionStep: '本地识别失败',
        recognitionError: error && error.message ? error.message : '图片读取失败，请重新选择图片。' })
    }
  },

  presentRecognitionResult(result, source) {
    const modeLabels = {
      'ai-guided-grid': 'AI 定位网格 + MARD 本地匹配',
      'ai-photo': 'AI 分类 + 普通照片转换',
      'ai-no-grid': 'AI 分流 + 无网格图片像素化',
      'guide-grid': '红色导线网格识别',
      'regular-grid': '规则网格识别',
      'pixel-grid': '像素块网格识别',
      'native-pixel': '原生像素图识别',
      'pixel-fallback': '普通图片转换'
    }
    result.recognitionModeText = modeLabels[result.recognitionMode] || '图片颜色识别'
    if (result.recognitionMode === 'ai-guided-grid' && result.labelTileRefinementApplied) {
      result.recognitionModeText = 'AI 定位 + 分块放大文字复核 + MARD 匹配'
    }
    result.confidencePercent = Math.round(Number(result.confidence || 0) * 100)
    result.geometryConfidencePercent = Math.round(Number(result.geometryConfidence || result.confidence || 0) * 100)
    if (result.recognitionMode === 'pixel-fallback' || result.recognitionMode === 'ai-photo' ||
      result.recognitionMode === 'ai-no-grid') {
      result.recognitionStatusText = '重新像素化（不是原图复原）'
    } else if (result.colorVerification === 'legend-counts' && Number(result.uncertainCellCount || 0) === 0) {
      result.recognitionStatusText = '图例色号与数量已校验'
    } else if (result.colorVerification === 'legend-codes') {
      result.recognitionStatusText = '完整色号集已确认，逐格待核对'
    } else {
      result.recognitionStatusText = '网格定位 ' + result.geometryConfidencePercent + '%，色号未验证'
    }
    result.exactRecognition = result.recognitionMode !== 'pixel-fallback' && result.recognitionMode !== 'ai-photo' &&
      result.recognitionMode !== 'ai-no-grid' &&
      Number(result.confidence || 0) >= 0.72 && (!result.validation || result.validation.ok) &&
      Number(result.uncertainCellCount || 0) === 0
    result.needsCalibration = result.recognitionMode === 'pixel-fallback' || result.recognitionMode === 'ai-photo' ||
      result.recognitionMode === 'ai-no-grid'
    result.needsReview = Boolean((result.validation && !result.validation.ok) || Number(result.uncertainCellCount || 0) > 0)
    result.reviewPreview = (result.reviewCells || []).slice(0, 12).map((cell) => ({
      label: `第 ${Number(cell.row) + 1} 行 · 第 ${Number(cell.column) + 1} 列`,
      code: cell.code,
      alternativeCode: cell.alternativeCode,
      confidence: cell.confidence
    }))
    this.setData({
      recognitionProgress: 100, recognitionStep: '识别完成', recognitionResult: result,
      recognitionSource: source, recognitionError: '', previewResult: result
    })
  },

  reprocessRecognitionSize(event) {
    const selectedSize = Number(event.currentTarget.dataset.size)
    if (!selectedSize || selectedSize === this.data.selectedSize) return
    this.cachedSignature = ''
    this.cachedResult = null
    this.setData({
      selectedSize,
      recognitionProgress: 0,
      recognitionStep: '重新校准网格',
      recognitionResult: null,
      previewResult: null
    }, () => this.data.recognitionSource === '本地' ? this.runLocalRecognition() : this.runAiRecognition())
  },

  editRecognitionCrop() {
    this.cachedSignature = ''
    this.cachedResult = null
    this.aiAnalysisCache = null
    const wasEnabled = Boolean(this.data.recognitionCropEnabled)
    this.setData({
      stage: 'classify',
      recognitionCropEnabled: true,
      cropMode: 'cover',
      imageMode: 'aspectFill',
      cropX: wasEnabled ? this.data.cropX : 0,
      cropY: wasEnabled ? this.data.cropY : 0,
      cropScale: wasEnabled ? Math.max(1, this.data.cropScale) : 1,
      cropZoom: wasEnabled ? Math.round((Math.max(1, this.data.cropScale) - 1) * 100) : 0,
      cropRotation: wasEnabled ? this.data.cropRotation : 0,
      cropMirrored: wasEnabled ? this.data.cropMirrored : false,
      recognitionProgress: 0,
      recognitionStep: '等待确认选区',
      recognitionResult: null,
      recognitionError: '',
      previewResult: null
    }, () => {
      this.updateCropTransform({
        cropX: this.data.cropX,
        cropY: this.data.cropY,
        cropScale: this.data.cropScale,
        cropRotation: this.data.cropRotation,
        cropMirrored: this.data.cropMirrored
      })
      this.refreshOutputSize({ cropMode: 'cover' })
    })
  },

  restartCropFromOriginal() {
    this.cachedSignature = ''
    this.cachedResult = null
    this.aiAnalysisCache = null
    this.setData({
      stage: 'classify',
      recognitionCropEnabled: true,
      longImageManualCrop: true,
      cropMode: 'cover',
      imageMode: 'aspectFill',
      cropX: 0,
      cropY: 0,
      cropScale: 1,
      cropZoom: 0,
      cropRotation: 0,
      cropMirrored: false,
      cropStyle: 'transform: translate(0px, 0px) scale(1) rotate(0deg) scaleX(1);',
      recognitionProgress: 0,
      recognitionStep: '请移动原图并确认截取区域',
      recognitionResult: null,
      recognitionError: '',
      previewResult: null
    }, () => this.refreshOutputSize({ cropMode: 'cover' }))
  },

  saveProcessedPattern(result, settings) {
    const options = settings || {}
    const variant = this.data.sourceVariants.find((item) => item.value === this.data.sourceVariant)
    const pattern = savePattern(createPattern({
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
      sourceOptions: Object.assign({}, this.processingOptions(), {
        sourceVariant: this.data.sourceVariant,
        recognitionReview: {
          uncertainCellCount: Number(result.uncertainCellCount) || 0,
          cells: (result.reviewCells || []).slice(0, 240),
          chartColorCalibrationApplied: Boolean(result.chartColorCalibrationApplied),
          labelTileRefinementApplied: Boolean(result.labelTileRefinementApplied),
          labelTemplateCount: Number(result.labelTemplateCount) || 0,
          watermarkSuppressionApplied: Boolean(result.watermarkSuppressionApplied),
          overlaySuppressedCellCount: Number(result.overlaySuppressedCellCount) || 0,
          uploadIntegrityVerified: Boolean(result.uploadIntegrityVerified)
        }
      })
    }), mardPalette)
    recordActivity('pattern-import', {
      patternId: pattern.id,
      patternName: pattern.name,
      title: '导入图纸',
      description: result.exactRecognition
        ? ('精确识别 ' + result.width + '×' + result.height + '，' + result.usedColorCount + ' 色，' + result.beadCount + ' 颗')
        : ('生成 ' + result.width + '×' + result.height + ' 图纸'),
      metadata: {
        method: this.data.selectedMethod,
        recognitionMode: result.recognitionMode || 'pixel',
        confidence: Number(result.confidence) || 0,
        beadCount: Number(result.beadCount) || 0,
        usedColorCount: Number(result.usedColorCount) || 0,
        uncertainCellCount: Number(result.uncertainCellCount) || 0,
        chartColorCalibrationApplied: Boolean(result.chartColorCalibrationApplied),
        labelTileRefinementApplied: Boolean(result.labelTileRefinementApplied),
        labelTemplateCount: Number(result.labelTemplateCount) || 0,
        watermarkSuppressionApplied: Boolean(result.watermarkSuppressionApplied),
        overlaySuppressedCellCount: Number(result.overlaySuppressedCellCount) || 0,
        uploadIntegrityVerified: Boolean(result.uploadIntegrityVerified)
      }
    })
    return pattern
  },

  saveRecognitionResult(event) {
    const result = this.data.recognitionResult
    if (!result || this.data.recognitionSaving) return
    this.setData({ recognitionSaving: true })
    try {
      const pattern = this.saveProcessedPattern(result, {
        name: (result.exactRecognition ? 'AI识别图纸 ' : '图片转换图纸 ') + result.width + '×' + result.height,
        tag: result.exactRecognition ? 'AI智能统计' : '普通图片转换'
      })
      const target = event.currentTarget.dataset.target
      wx.redirectTo({
        url: target === 'editor'
          ? ('/pages/editor/editor?id=' + encodeURIComponent(pattern.id))
          : ('/pages/detail/detail?id=' + encodeURIComponent(pattern.id))
      })
    } catch (error) {
      showStorageError(error)
    } finally {
      this.setData({ recognitionSaving: false })
    }
  },

  updateCropTransform(changes) {
    const next = Object.assign({}, this.data, changes || {})
    const limits = this.cropTranslationLimits(next)
    next.cropX = Math.max(-limits.x, Math.min(limits.x, Number(next.cropX) || 0))
    next.cropY = Math.max(-limits.y, Math.min(limits.y, Number(next.cropY) || 0))
    next.cropZoom = Math.round((Math.max(1, Number(next.cropScale) || 1) - 1) * 100)
    const cropStyle = 'transform: translate(' + next.cropX + 'px, ' + next.cropY + 'px) scale(' +
      Number(next.cropScale).toFixed(2) + ') rotate(' + next.cropRotation + 'deg) scaleX(' +
      (next.cropMirrored ? -1 : 1) + ');'
    this.setData(Object.assign({}, changes, {
      cropX: next.cropX,
      cropY: next.cropY,
      cropScale: next.cropScale,
      cropZoom: next.cropZoom,
      cropStyle,
      previewResult: null
    }))
  },

  cropTranslationLimits(state) {
    if (state.cropMode !== 'cover' || !state.imageInfo) return { x: 150, y: 150 }
    let width = Math.max(1, Number(state.imageInfo.width) || 1)
    let height = Math.max(1, Number(state.imageInfo.height) || 1)
    if (Number(state.cropRotation) === 90 || Number(state.cropRotation) === 270) {
      const swapped = width
      width = height
      height = swapped
    }
    const ratio = width / height
    const scale = Math.max(1, Number(state.cropScale) || 1)
    const half = 158
    return {
      x: Math.max(0, half * (Math.max(1, ratio) * scale - 1)),
      y: Math.max(0, half * (Math.max(1, 1 / ratio) * scale - 1))
    }
  },

  changeCropZoom(event) {
    const cropScale = 1 + Math.max(0, Math.min(300, Number(event.detail.value) || 0)) / 100
    this.updateCropTransform({ cropScale })
  },

  nudgeCrop(event) {
    const step = 18
    const x = Number(event.currentTarget.dataset.x) || 0
    const y = Number(event.currentTarget.dataset.y) || 0
    this.updateCropTransform({ cropX: this.data.cropX + x * step, cropY: this.data.cropY + y * step })
  },

  rotateCrop() {
    this.updateCropTransform({ cropRotation: (this.data.cropRotation + 90) % 360 })
  },

  toggleCropMirror() {
    this.updateCropTransform({ cropMirrored: !this.data.cropMirrored })
  },

  resetCrop() {
    this.updateCropTransform({ cropX: 0, cropY: 0, cropScale: 1, cropZoom: 0, cropRotation: 0, cropMirrored: false })
  },

  processingOptions() {
    return {
      inputMode: this.data.selectedMethod,
      cropMode: this.data.cropMode,
      optimizePreset: this.data.optimizePreset,
      qualityMode: this.data.qualityMode,
      removeTransparent: true,
      removeBackground: this.data.removeBackground,
      whiteThreshold: this.data.whiteThreshold,
      whiteTolerance: 22,
      fallbackQualityMode: this.data.selectedMethod === 'pixel' ? this.data.qualityMode : 'easy',
      transform: {
        offsetX: this.data.cropX / 158,
        offsetY: this.data.cropY / 158,
        scale: this.data.cropScale,
        rotation: this.data.cropRotation,
        mirrored: this.data.cropMirrored
      }
    }
  },

  processingSignature() {
    return JSON.stringify({
      path: this.data.imagePath,
      method: this.data.selectedMethod,
      size: this.data.selectedSize,
      options: this.processingOptions()
    })
  },

  async processCurrentImage(onProgress) {
    const signature = this.processingSignature()
    if (this.cachedResult && this.cachedSignature === signature) {
      if (typeof onProgress === 'function') await Promise.resolve(onProgress(96, '使用已完成的识别结果'))
      return this.cachedResult
    }
    const recognizeGrid = ['recognize', 'diagram', 'link', 'pixel'].indexOf(this.data.selectedMethod) >= 0
    const processor = recognizeGrid ? gridImageToPattern : imageToPattern
    let preparedInput
    try {
      preparedInput = await this.prepareRecognitionInput(this.data.imagePath)
      const options = preparedInput.options
      if (typeof onProgress === 'function') options.onProgress = onProgress
      const result = await processor(
        preparedInput.path,
        this.data.selectedSize,
        mardPalette,
        options
      )
      result.cropApplied = Boolean(this.data.recognitionCropEnabled)
      this.cachedSignature = signature
      this.cachedResult = result
      return result
    } finally {
      this.removeTemporaryRecognitionInput(preparedInput)
    }
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
        const longImage = Math.max(info.width, info.height) / Math.max(1, Math.min(info.width, info.height)) >= 1.45
        const recognitionImport = ['recognize', 'diagram', 'link'].indexOf(this.data.selectedMethod) >= 0
        const autoCrop = this.data.stage === 'classify' && recognitionImport && longImage
        const cropMode = autoCrop ? 'cover' : this.data.cropMode
        const dims = calculatePatternDimensions(info.width, info.height, recommendedSize, cropMode)
        this.setData({
          imageInfo: info,
          recommendedSize,
          selectedSize: recommendedSize,
          outputWidth: dims.width,
          outputHeight: dims.height,
          recognitionCropEnabled: autoCrop,
          longImageManualCrop: autoCrop,
          cropMode,
          imageMode: autoCrop ? 'aspectFill' : this.data.imageMode,
          cropX: 0,
          cropY: 0,
          cropScale: 1,
          cropZoom: 0,
          cropStyle: 'transform: translate(0px, 0px) scale(1) rotate(0deg) scaleX(1);',
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
    this.aiAnalysisCache = null
    this.setData({
      imagePath: path,
      stage: 'classify',
      sourceVariant: 'main',
      recognitionProgress: 0,
      recognitionResult: null,
      recognitionError: '',
      recognitionSource: '',
      previewResult: null,
      cropMode: 'ratio',
      imageMode: 'aspectFit',
      recognitionCropEnabled: false,
      longImageManualCrop: false,
      cropX: 0,
      cropY: 0,
      cropScale: 1,
      cropZoom: 0,
      cropRotation: 0,
      cropMirrored: false,
      cropStyle: 'transform: translate(0px, 0px) scale(1) rotate(0deg) scaleX(1);'
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
        sizeType: ['original'],
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
      sizeType: ['original'],
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
        sizeType: ['original'],
        success: (result) => done((result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean)),
        fail: (error) => this.handleImagePickerFailure(error)
      })
      return
    }
    wx.chooseImage({
      count: 9,
      sizeType: ['original'],
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
    let storageFailure = null
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
            cropZoom: 0,
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
          if (error && error.code === 'PATTERN_STORAGE_ERROR') {
            storageFailure = error
            break
          }
        }
      }
    } finally {
      wx.hideLoading()
      await this.setDataAsync(Object.assign({}, original, { batchImporting: false, batchProgress: '' }))
    }
    if (storageFailure) {
      showStorageError(storageFailure, '本批已保存 ' + savedPatterns.length + '/' + paths.length + ' 张，剩余图片未导入。可在图纸册查看已保存的图纸。')
      return
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
