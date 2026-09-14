const { createApp } = require('./app')

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT) || 3001
if (!process.env.DEEPSEEK_API_KEY) {
  console.warn('DEEPSEEK_API_KEY is not configured; /healthz works but analysis will return AI_NOT_CONFIGURED.')
}
const server = createApp().listen(port, host, () => console.info(`AI Beads Server listening on ${host}:${port}`))
server.requestTimeout = 130000
server.headersTimeout = 30000
