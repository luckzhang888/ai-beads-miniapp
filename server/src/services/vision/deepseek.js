const { SYSTEM_PROMPT, buildPrompt } = require('../../prompts/bead-recognition')
const { parseAiJson, validateAiAnalysis, InvalidAnalysisError } = require('./normalize')

class ProviderError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

function createDeepSeekProvider(config = {}, fetchImpl = fetch) {
  const apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY
  const baseUrl = (config.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
  const model = config.model || process.env.DEEPSEEK_VISION_MODEL || 'deepseek-v4-flash-vision-exp'
  const timeoutMs = Math.max(1000, Math.min(120000, Number(config.timeoutMs || process.env.DEEPSEEK_TIMEOUT_MS) || 90000))
  return {
    model,
    async analyze(image, options = {}) {
      if (!apiKey) throw new ProviderError('AI_NOT_CONFIGURED', 503)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(baseUrl + '/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            response_format: { type: 'json_object' },
            max_tokens: 1200,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: [
                { type: 'text', text: buildPrompt(options) },
                { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`, detail: 'original' } }
              ] }
            ]
          }),
          signal: controller.signal
        })
        if (!response.ok) throw new ProviderError(response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED', response.status === 429 ? 429 : 502)
        const payload = await response.json()
        return validateAiAnalysis(parseAiJson(payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content))
      } catch (error) {
        if (error instanceof ProviderError || error instanceof InvalidAnalysisError) throw error
        if (controller.signal.aborted || error.name === 'AbortError') throw new ProviderError('AI_TIMEOUT', 504)
        throw new ProviderError('AI_PROVIDER_FAILED', 502)
      } finally { clearTimeout(timer) }
    }
  }
}

module.exports = { createDeepSeekProvider, ProviderError }
