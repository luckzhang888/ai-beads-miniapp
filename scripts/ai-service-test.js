const assert = require('node:assert/strict')
const apiConfig = require('../miniprogram/config/api')
const { analyzeImage, requestFailure, MAX_BYTES } = require('../miniprogram/services/ai-recognition')

async function run() {
  const previousWx = global.wx
  const previousOrigin = apiConfig.apiBaseUrl
  apiConfig.apiBaseUrl = 'https://beads.example.test'
  try {
    let uploaded = 0
    global.wx = {
      getFileInfo({ success }) { success({ size: 1024 }) },
      getAccountInfoSync() { return { miniProgram: { appId: 'wx-test-app-id' } } },
      uploadFile(options) {
        uploaded += 1
        assert.equal(options.url, 'https://beads.example.test/api/v1/beads/analyze')
        assert.equal(options.formData.palette, 'MARD')
        options.success({ statusCode: 200, data: JSON.stringify({ ok: true, result: { hasGrid: true, rows: 2, columns: 2 } }) })
        return { abort() {} }
      }
    }
    assert.equal((await analyzeImage('fixture.png', { expectedSize: 48 })).result.rows, 2)
    assert.equal(uploaded, 1)

    global.wx.uploadFile = (options) => {
      options.success({ statusCode: 500, data: JSON.stringify({ ok: false, error: { code: 'AI_PROVIDER_FAILED', message: '服务器失败' } }) })
      return { abort() {} }
    }
    await assert.rejects(analyzeImage('fixture.png'), { code: 'AI_PROVIDER_FAILED' })

    let genericAttempts = 0
    global.wx.uploadFile = (options) => {
      genericAttempts += 1
      options.fail({ errMsg: 'uploadFile:fail' })
      return { abort() {} }
    }
    await assert.rejects(analyzeImage('fixture.png'), { code: 'AI_UPLOAD_FAILED' })
    assert.equal(genericAttempts, 2, 'an intermittent generic upload failure must retry once')

    let fallbackRequests = 0
    global.wx.getFileSystemManager = () => ({
      readFile(options) {
        assert.equal(options.filePath, 'fixture.png')
        assert.equal(options.encoding, 'base64')
        options.success({ data: 'fixture-base64' })
      }
    })
    global.wx.request = (options) => {
      fallbackRequests += 1
      assert.equal(options.url, 'https://beads.example.test/api/v1/beads/analyze-base64')
      assert.equal(options.method, 'POST')
      assert.equal(options.data.imageBase64, 'fixture-base64')
      assert.equal(options.data.palette, 'MARD')
      options.success({ statusCode: 200, data: { ok: true, result: { hasGrid: true, rows: 30, columns: 30 } } })
      return { abort() {} }
    }
    assert.equal((await analyzeImage('fixture.png')).result.rows, 30,
      'Base64 request fallback must recover when uploadFile cannot leave the phone')
    assert.equal(fallbackRequests, 1)

    let recoveredAttempts = 0
    global.wx.uploadFile = (options) => {
      recoveredAttempts += 1
      if (recoveredAttempts === 1) options.fail({ errMsg: 'uploadFile:fail' })
      else options.success({ statusCode: 200, data: JSON.stringify({ ok: true, result: { hasGrid: true } }) })
      return { abort() {} }
    }
    assert.equal((await analyzeImage('fixture.png')).result.hasGrid, true)
    assert.equal(recoveredAttempts, 2, 'a second upload attempt can recover without user action')

    const uploadFailures = [
      ['uploadFile:fail url not in domain list', 'AI_DOMAIN_NOT_ALLOWED'],
      ['uploadFile:fail timeout', 'AI_TIMEOUT'],
      ['uploadFile:fail no such file', 'AI_IMAGE_UNAVAILABLE'],
      ['uploadFile:fail ssl handshake failed', 'AI_TLS_FAILED']
    ]
    for (const [errMsg, code] of uploadFailures) {
      global.wx.uploadFile = (options) => { options.fail({ errMsg }); return { abort() {} } }
      await assert.rejects(analyzeImage('fixture.png'), (error) => {
        assert.equal(error.code, code)
        assert.equal(error.wxMessage, errMsg)
        assert.equal(error.appId, 'wx-test-app-id')
        assert.match(error.message, /AppID：wx-test-app-id/)
        if (code === 'AI_DOMAIN_NOT_ALLOWED') assert.match(error.message, /https:\/\/beads\.example\.test/)
        return true
      })
    }

    const requestTlsError = requestFailure({ errMsg: 'request:fail ssl handshake failed' }, 'https://beads.example.test')
    assert.equal(requestTlsError.code, 'AI_TLS_FAILED')
    assert.match(requestTlsError.message, /微信错误：request:fail ssl handshake failed/)
    assert.match(requestTlsError.message, /AppID：wx-test-app-id/)

    global.wx.uploadFile = (options) => {
      options.success({ statusCode: 413, data: '<html>Request Entity Too Large</html>' })
      return { abort() {} }
    }
    await assert.rejects(analyzeImage('fixture.png'), { code: 'IMAGE_TOO_LARGE' })

    global.wx.uploadFile = (options) => {
      options.success({ statusCode: 502, data: '<html>Bad Gateway</html>' })
      return { abort() {} }
    }
    await assert.rejects(analyzeImage('fixture.png'), { code: 'AI_SERVER_ERROR' })

    global.wx.uploadFile = () => { throw new Error('should not upload') }
    global.wx.getFileInfo = ({ success }) => success({ size: MAX_BYTES + 1 })
    await assert.rejects(analyzeImage('fixture.png'), { code: 'IMAGE_TOO_LARGE' })

    apiConfig.apiBaseUrl = ''
    await assert.rejects(analyzeImage('fixture.png'), { code: 'AI_NOT_CONFIGURED' })
    console.log('AI upload service passed: multipart, Base64 fallback, HTTP errors, specific failures, 10 MB guard and HTTPS origin.')
  } finally {
    apiConfig.apiBaseUrl = previousOrigin
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
