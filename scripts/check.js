const fs = require('fs')
const path = require('path')

const required = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/pages/home/home.js',
  'miniprogram/pages/convert/convert.js'
]

const missing = required.filter((file) => !fs.existsSync(path.join(process.cwd(), file)))
if (missing.length) {
  console.error('Missing required files:', missing.join(', '))
  process.exit(1)
}

JSON.parse(fs.readFileSync('project.config.json', 'utf8'))
JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'))
console.log('Project structure check passed.')
