const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const sourceRoot = path.join(root, 'miniprogram')
const ignoredDirectories = new Set(['node_modules', '.git'])
const requiredFiles = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/app.wxss',
  'miniprogram/pages/convert/convert.js',
  'miniprogram/pages/detail/detail.js',
  'miniprogram/pages/detail/detail.wxml',
  'miniprogram/pages/patterns/patterns.js',
  'miniprogram/pages/patterns/patterns.wxml',
  'miniprogram/pages/pattern/pattern.js',
  'miniprogram/pages/pattern/pattern.wxml',
  'miniprogram/pages/editor/editor.js',
  'miniprogram/pages/inventory/inventory.js',
  'miniprogram/components/bead-grid/bead-grid.js',
  'miniprogram/data/colors/mard.js',
  'miniprogram/utils/lab.js',
  'miniprogram/utils/color-match.js',
  'miniprogram/utils/image.js',
  'miniprogram/utils/export.js',
  'miniprogram/utils/inventory.js',
  'miniprogram/utils/pattern.js'
]

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return []
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(fullPath) : [fullPath]
  })
}

requiredFiles.forEach((file) => {
  if (!fs.existsSync(path.join(root, file))) throw new Error('Missing required file: ' + file)
})

const projectFiles = walk(root)
const jsonFiles = projectFiles.filter((file) => file.endsWith('.json'))
const jsFiles = projectFiles.filter((file) => file.endsWith('.js'))
const wxmlFiles = projectFiles.filter((file) => file.endsWith('.wxml'))
const wxssFiles = projectFiles.filter((file) => file.endsWith('.wxss'))

jsonFiles.forEach((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
jsFiles.forEach((file) => {
  try {
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(root, file) })
  } catch (error) {
    throw new Error('JavaScript syntax error in ' + path.relative(root, file) + ': ' + error.message)
  }
})

const appConfig = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'app.json'), 'utf8'))
appConfig.pages.forEach((page) => {
  ;['js', 'json', 'wxml', 'wxss'].forEach((extension) => {
    const pageFile = path.join(sourceRoot, page + '.' + extension)
    if (!fs.existsSync(pageFile)) throw new Error('Missing page asset: ' + path.relative(root, pageFile))
  })
})

wxmlFiles.forEach((file) => {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file)
  const unsupported = source.match(/<(div|span|p|strong|small)(\s|>)/i)
  if (unsupported) throw new Error('Unsupported HTML tag <' + unsupported[1] + '> in ' + relative)

  const normalized = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/{{[\s\S]*?}}/g, 'binding')
  const stack = []
  const tags = normalized.matchAll(/<(\/)?([a-z][\w-]*)(?:\s[^<>]*?)?(\/?)>/gi)
  for (const match of tags) {
    const closing = Boolean(match[1])
    const name = match[2]
    const selfClosing = Boolean(match[3])
    if (!closing && !selfClosing) stack.push(name)
    if (closing) {
      const expected = stack.pop()
      if (expected !== name) {
        throw new Error('Unbalanced WXML tag in ' + relative + ': expected </' + expected + '> but found </' + name + '>')
      }
    }
  }
  if (stack.length) throw new Error('Unclosed WXML tag <' + stack[stack.length - 1] + '> in ' + relative)

  const jsFile = file.replace(/\.wxml$/, '.js')
  if (!fs.existsSync(jsFile)) return
  const component = file.includes(path.sep + 'components' + path.sep)
  let definition
  const globalName = component ? 'Component' : 'Page'
  global[globalName] = (value) => { definition = value }
  delete require.cache[require.resolve(jsFile)]
  require(jsFile)
  delete global[globalName]
  const methods = component ? ((definition && definition.methods) || {}) : (definition || {})
  const bindings = source.matchAll(/(?:bind|catch)(?::[\w-]+|[\w-]+)="([A-Za-z_$][\w$]*)"/g)
  for (const binding of bindings) {
    if (typeof methods[binding[1]] !== 'function') {
      throw new Error('Missing event handler ' + binding[1] + ' in ' + path.relative(root, jsFile))
    }
  }
})

wxssFiles.forEach((file) => {
  const source = fs.readFileSync(file, 'utf8')
  const opens = (source.match(/{/g) || []).length
  const closes = (source.match(/}/g) || []).length
  if (opens !== closes) throw new Error('Unbalanced WXSS braces in ' + path.relative(root, file))
})

console.log('Project structure check passed: ' + appConfig.pages.length + ' pages, ' + jsFiles.length + ' scripts, ' + wxmlFiles.length + ' templates.')
