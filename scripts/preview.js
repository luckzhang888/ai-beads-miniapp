const fs = require('fs')
const path = require('path')
const ci = require('miniprogram-ci')

const root = path.resolve(__dirname, '..')
const appid = process.env.WX_APPID
const privateKeyPath = process.env.WX_PRIVATE_KEY_PATH
  ? path.resolve(root, process.env.WX_PRIVATE_KEY_PATH)
  : path.resolve(root, 'private.key')

if (!appid) {
  throw new Error('Missing WX_APPID')
}

if (!fs.existsSync(privateKeyPath)) {
  throw new Error('WeChat private key not found: ' + privateKeyPath)
}

const configPath = path.join(root, 'project.config.json')
const originalConfig = fs.readFileSync(configPath, 'utf8')
const config = JSON.parse(originalConfig)
config.appid = appid
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

const project = new ci.Project({
  appid,
  type: 'miniProgram',
  projectPath: root,
  privateKeyPath,
  ignores: ['node_modules/**/*', 'preview-qrcode.png']
})

async function main() {
  try {
    await ci.preview({
      project,
      desc: 'AI 豆仓 develop 预览',
      setting: {
        useProjectConfig: true
      },
      robot: Number(process.env.WX_CI_ROBOT || 1),
      qrcodeFormat: 'image',
      qrcodeOutputDest: path.join(root, 'preview-qrcode.png'),
      onProgressUpdate(info) {
        console.log('[miniprogram-ci]', info)
      }
    })
    console.log('Preview QR code written to preview-qrcode.png')
  } finally {
    fs.writeFileSync(configPath, originalConfig)
  }
}

main().catch((error) => {
  fs.writeFileSync(configPath, originalConfig)
  console.error(error)
  process.exit(1)
})
