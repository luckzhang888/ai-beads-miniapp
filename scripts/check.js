const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')

const requiredFiles = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/app.wxss',
  'miniprogram/pages/home/home.js',
  'miniprogram/pages/home/home.wxml',
  'miniprogram/pages/convert/convert.js',
  'miniprogram/pages/convert/convert.wxml',
  'miniprogram/pages/pattern/pattern.js',
  'miniprogram/pages/pattern/pattern.wxml',
  'miniprogram/pages/inventory/inventory.js',
  'miniprogram/pages/inventory/inventory.wxml',
  'miniprogram/components/bead-grid/bead-grid.js',
  'miniprogram/data/colors/demo.js',
  'miniprogram/utils/lab.js',
  'miniprogram/utils/color-match.js',
  'miniprogram/utils/image.js',
  'miniprogram/utils/inventory.js',
  'miniprogram/utils/pattern.js'
]

function fail(message) {
  console.error('[check] ' + message)
  process.exitCode = 1
}

requiredFiles.forEach((relativePath) => {
  if (!fs.existsSync(path.join(root, relativePath))) {
    fail('missing: ' + relativePath)
  }
})

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return walk(fullPath)
    }
    return [fullPath]
  })
}

walk(root)
  .filter((file) => file.endsWith('.json'))
  .forEach((file) => {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      fail('invalid JSON: ' + path.relative(root, file) + ' - ' + error.message)
    }
  })

walk(root)
  .filter((file) => file.endsWith('.js') && file.indexOf('node_modules') < 0)
  .forEach((file) => {
    try {
      new vm.Script(fs.readFileSync(file, 'utf8'), {
        filename: path.relative(root, file)
      })
    } catch (error) {
      fail('invalid JS: ' + path.relative(root, file) + ' - ' + error.message)
    }
  })

const appConfig = JSON.parse(
  fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8')
)

appConfig.pages.forEach((page) => {
  ;['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    const file = path.join(root, 'miniprogram', page + '.' + ext)
    if (!fs.existsSync(file)) {
      fail('page file missing: ' + path.relative(root, file))
    }
  })
})

if (!process.exitCode) {
  console.log('Project structure and JavaScript syntax check passed.')
}
