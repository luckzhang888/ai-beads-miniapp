const ci = require('miniprogram-ci')

const appid = process.env.WX_APPID
const privateKeyPath = process.env.WX_PRIVATE_KEY_PATH || 'private.key'

if (!appid) throw new Error('Missing WX_APPID')

const project = new ci.Project({
  appid,
  type: 'miniProgram',
  projectPath: process.cwd(),
  privateKeyPath,
  ignores: ['node_modules/**/*']
})

ci.preview({
  project,
  desc: `GitHub Actions preview ${new Date().toISOString()}`,
  setting: {
    es6: true,
    minify: true,
    autoPrefixWXSS: true
  },
  qrcodeFormat: 'image',
  qrcodeOutputDest: 'preview-qrcode.png',
  onProgressUpdate: console.log
}).then(() => {
  console.log('Preview QR code generated: preview-qrcode.png')
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
