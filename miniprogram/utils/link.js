const TRAILING_PUNCTUATION = /[\s\]\[(){}<>，。！？；：、'"“”‘’）】》]+$/
const IMAGE_PARAMS = ['url', 'src', 'image', 'img', 'image_url', 'imageurl', 'origin', 'original', 'download']

function safeDecode(value) {
  let current = String(value || '')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current.replace(/\+/g, '%20'))
      if (decoded === current) break
      current = decoded
    } catch (error) {
      break
    }
  }
  return current
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
}

function cleanUrl(value) {
  return decodeEntities(value).trim().replace(TRAILING_PUNCTUATION, '')
}

function extractUrls(input) {
  const source = decodeEntities(input)
  const variants = [source]
  if (/%(?:3a|2f)/i.test(source)) variants.push(safeDecode(source))
  const found = []
  variants.forEach((text) => {
    const matches = String(text || '').match(/https?:\/\/[^\s<>"'，。！？；：、（）【】《》“”‘’]+/gi) || []
    matches.forEach((match) => {
      const cleaned = cleanUrl(match)
      if (cleaned && found.indexOf(cleaned) < 0) found.push(cleaned)
    })
  })
  return found
}

function queryPairs(url) {
  const question = url.indexOf('?')
  if (question < 0) return []
  return url.slice(question + 1).split('&').map((pair) => {
    const separator = pair.indexOf('=')
    const key = separator < 0 ? pair : pair.slice(0, separator)
    const value = separator < 0 ? '' : pair.slice(separator + 1)
    return [safeDecode(key).toLowerCase(), safeDecode(value)]
  })
}

function unwrapImageUrl(url) {
  let current = cleanUrl(url)
  for (let depth = 0; depth < 3; depth += 1) {
    const pairs = queryPairs(current)
    const nested = pairs.find((pair) => IMAGE_PARAMS.indexOf(pair[0]) >= 0 && /^https?:\/\//i.test(pair[1]))
    if (!nested) break
    current = cleanUrl(nested[1])
  }
  return current
}

function isImageExtension(url) {
  return /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i.test(String(url || ''))
}

function isKnownSharePage(url) {
  return /(?:xiaohongshu\.com|xhslink\.com|douyin\.com|v\.douyin\.com|weibo\.com|weibo\.cn|bilibili\.com)/i.test(String(url || ''))
}

function resolveRelativeUrl(value, baseUrl) {
  const candidate = cleanUrl(value)
  if (/^https?:\/\//i.test(candidate)) return candidate
  if (/^\/\//.test(candidate)) {
    const protocol = String(baseUrl || '').match(/^(https?):/i)
    return (protocol ? protocol[1].toLowerCase() : 'https') + ':' + candidate
  }
  const base = String(baseUrl || '').match(/^(https?:\/\/[^/]+)(\/[^?#]*)?/i)
  if (!base || !candidate) return ''
  if (candidate[0] === '/') return base[1] + candidate
  const directory = (base[2] || '/').replace(/\/[^/]*$/, '/')
  return base[1] + directory + candidate.replace(/^\.\//, '')
}

function tagAttributes(tag) {
  const result = Object.create(null)
  const pattern = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g
  let match
  while ((match = pattern.exec(tag))) result[match[1].toLowerCase()] = decodeEntities(match[3])
  return result
}

function extractHtmlImageUrls(html, baseUrl) {
  const source = String(html || '')
  const found = []
  const append = (value) => {
    const resolved = resolveRelativeUrl(value, baseUrl)
    if (resolved && found.indexOf(resolved) < 0) found.push(resolved)
  }
  const metaTags = source.match(/<meta\b[^>]*>/gi) || []
  metaTags.forEach((tag) => {
    const attributes = tagAttributes(tag)
    const key = String(attributes.property || attributes.name || '').toLowerCase()
    if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].indexOf(key) >= 0) append(attributes.content)
  })
  const imageTags = source.match(/<img\b[^>]*>/gi) || []
  imageTags.slice(0, 30).forEach((tag) => {
    const attributes = tagAttributes(tag)
    append(attributes['data-original'] || attributes['data-src'] || attributes.src)
  })
  return found
}

function selectBestUrl(input) {
  const urls = extractUrls(input).map(unwrapImageUrl)
  return urls.find(isImageExtension) || urls[0] || ''
}

function responseContentType(result) {
  const headers = result && (result.header || result.headers) || {}
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'content-type')
  return key ? String(headers[key]).toLowerCase() : ''
}

function validateDownload(result) {
  const statusCode = Number(result && result.statusCode)
  if (statusCode < 200 || statusCode >= 300) return { ok: false, reason: 'http-status', statusCode }
  if (!result || !result.tempFilePath) return { ok: false, reason: 'missing-file' }
  const contentType = responseContentType(result)
  if (/text\/html|application\/json|text\/plain/.test(contentType)) {
    return { ok: false, reason: 'not-image-response', contentType }
  }
  return { ok: true, contentType }
}

module.exports = {
  safeDecode,
  extractUrls,
  unwrapImageUrl,
  isImageExtension,
  isKnownSharePage,
  resolveRelativeUrl,
  extractHtmlImageUrls,
  selectBestUrl,
  responseContentType,
  validateDownload
}
