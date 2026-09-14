const assert = require('node:assert/strict')
const apiConfig = require('../miniprogram/config/api')
const { analyzeImage, MAX_BYTES } = require('../miniprogram/services/ai-recognition')

async function run() {
  const previousWx = global.wx
  const previousOrigin = apiConfig.apiBaseUrl
  apiConfig.apiBaseUrl = 'https://beads.example.test'
  try {
    let uploaded = 0
    global.wx = {
      getFileInfo({ success }) { success({ size: 1024 }) },
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

    global.wx.uploadFile = (options) => { options.fail({ errMsg: 'uploadFile:fail' }); return { abort() {} } }
    await assert.rejects(analyzeImage('fixture.png'), { code: 'AI_UPLOAD_FAILED' })

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
        if (code === 'AI_DOMAIN_NOT_ALLOWED') assert.match(error.message, /https:\/\/beads\.example\.test/)
        return true
      })
    }

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
    console.log('AI upload service passed: success, HTTP errors, specific upload failures, 10 MB guard and unconfigured HTTPS origin.')
  } finally {
    apiConfig.apiBaseUrl = previousOrigin
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
