const express = require('express')
const { createRecognitionRouter } = require('./routes/recognize')
const { createDeepSeekProvider } = require('./services/vision')

function createApp(provider = createDeepSeekProvider(), options = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next() })
  app.get('/healthz', (req, res) => res.json({ ok: true }))
  app.use('/api/v1/beads', createRecognitionRouter(provider, options))
  app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在。' } }))
  return app
}

module.exports = { createApp }
