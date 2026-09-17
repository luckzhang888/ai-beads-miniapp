const defaultFetch = require('node-fetch')
const { SYSTEM_PROMPT, buildPrompt } = require('./prompt')
const { parseAiJson, validateAiAnalysis, InvalidAnalysisError } = require('./normalize')

class ProviderError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

function createDeepSeekProvider(config = {}, fetchImpl = defaultFetch) {
  const apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY
  const baseUrl = (config.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
  const model = config.model || process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash'
  const timeoutMs = Math.max(1000, Math.min(120000, Number(config.timeoutMs || process.env.DEEPSEEK_TIMEOUT_MS) || 90000))
  return {
    model,
    async analyze(image, options = {}) {
      if (!apiKey) throw new ProviderError('AI_NOT_CONFIGURED', 503)
      try {
        const content = [
          { type: 'text', text: buildPrompt(options) },
          { type: 'text', text: '图1：完整原图，用于判断图像类型、网格边界、行列和透视。' },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`, detail: 'original' } }
        ]
        ;(image.regions || []).forEach((region) => {
          const label = region.name === 'title'
            ? '图2：原图顶部标题区域的放大裁片，只用于读取标题声明的行列、色数和总颗数。'
            : '图3：原图底部图例区域的放大裁片，请逐项读取 MARD 色号及紧邻的数量。'
          content.push({ type: 'text', text: label })
          content.push({
            type: 'image_url',
            image_url: { url: `data:${region.mimeType};base64,${region.buffer.toString('base64')}`, detail: 'original' }
          })
        })
        const response = await fetchImpl(baseUrl + '/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' },
            max_tokens: 1800,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content }
            ]
          }),
          timeout: timeoutMs
        })
        if (!response.ok) throw new ProviderError(response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED', response.status === 429 ? 429 : 502)
        const payload = await response.json()
        return validateAiAnalysis(parseAiJson(payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content))
      } catch (error) {
        if (error instanceof ProviderError || error instanceof InvalidAnalysisError) throw error
        if (error && (error.type === 'request-timeout' || error.code === 'ETIMEDOUT')) throw new ProviderError('AI_TIMEOUT', 504)
        throw new ProviderError('AI_PROVIDER_FAILED', 502)
      }
    }
  }
}

module.exports = { createDeepSeekProvider, ProviderError }
