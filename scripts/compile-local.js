const fs = require('fs')
const path = require('path')
const ci = require('miniprogram-ci')

function walk(directory, root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return []
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory()
      ? walk(fullPath, root)
      : [path.relative(root, fullPath).replace(/\\/g, '/')]
  })
}

class LocalProject extends ci.DevtoolsProject {
  constructor(projectPath) {
    super()
    this._projectPath = projectPath.replace(/\\/g, '/')
    this._type = 'miniProgram'
    this._appid = 'touristappid'
    this._projectArchitecture = 'miniProgram'
    this._miniprogramRoot = 'miniprogram/'
    this.setting = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.config.json'), 'utf8')).setting || {}
    walk(projectPath, projectPath).forEach((file) => {
      this._fileSet.add(file)
      this.cacheDirName(this._dirSet, path.posix.dirname(file))
    })
  }

  async attr() {
    return Object.assign({}, ci.DefaultProjectAttr, { gameApp: false, platform: false })
  }
}

async function run() {
  const project = new LocalProject(process.cwd())
  const result = await ci.compile(project, {
    setting: Object.assign({}, project.setting, {
      es6: false,
      enhance: false,
      postcss: false,
      minify: false,
      minified: false,
      minifyJS: false,
      minifyWXML: false,
      minifyWXSS: false
    }),
    onProgressUpdate() {}
  })
  const entries = Object.entries(result)
  const bytes = entries.reduce((sum, item) => {
    const value = item[1]
    return sum + (Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value)))
  }, 0)
  console.log('Local Mini Program compile passed: ' + entries.length + ' outputs, ' + bytes + ' bytes.')
  process.exit(0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
