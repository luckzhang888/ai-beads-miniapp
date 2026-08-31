const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const miniRoot = path.join(root, 'miniprogram')
const app = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'))
const tabletMedia = /@media\s*\(min-width:\s*768px\)/

assert.strictEqual(app.resizable, true, 'app.json must keep resizable enabled for iPad split/full screen')
assert.strictEqual(app.window.pageOrientation, 'auto', 'app.json must follow iPad orientation')

const contracts = {
  'pages/patterns/patterns': [/\.pattern-grid\s*\{\s*grid-template-columns:\s*repeat\(3/, /\.sheet-mask\s*\{\s*padding-left:\s*184px/, /\.filter-sheet\s*\{[^}]*border-radius:\s*24px/],
  'pages/convert/convert': [/\.classify-preview\s*\{[^}]*height:\s*420px/, /\.recognition-preview\s*\{[^}]*height:\s*420px/, /\.method-card\s*\{[^}]*min-height:\s*92px/],
  'pages/detail/detail': [/\.main-preview\s*\{[^}]*height:\s*420px/, /\.detail-actions button\s*\{[^}]*height:\s*56px/],
  'pages/pattern/pattern': [/\.tool-scroll,\s*\.tool-inner\s*\{\s*height:\s*72px/, /\.palette-dock\s*\{[^}]*104px/],
  'pages/editor/editor': [/\.palette-grid\s*\{\s*grid-template-columns:\s*repeat\(8/, /\.compact-card\s*\{\s*padding:\s*16px/],
  'pages/inventory/inventory': [/\.bottom-sheet\s*\{\s*width:\s*min\(100%,920px\)/, /\.entry-header\s*\{[^}]*height:\s*76px/, /\.stock-grid\s*\{\s*grid-template-columns:\s*repeat\(6/],
  'pages/records/records': [/\.record-list\s*\{[^}]*repeat\(2/, /\.record-card\s*\{[^}]*padding:\s*16px/],
  'pages/inspiration/inspiration': [/\.inspiration-grid\s*\{\s*grid-template-columns:\s*repeat\(3/, /\.preview\s*\{\s*height:\s*220px/],
  'pages/profile/profile': [/\.profile-logo\s*\{\s*width:\s*58px;\s*height:\s*58px/, /\.menu-card\s*>\s*view\s*\{[^}]*min-height:\s*64px/],
  'pages/home/home': [/\.quick-card\s*\{\s*padding:\s*17px/, /\.quick-title\s*\{\s*font-size:\s*20px/]
}

app.pages.forEach((page) => {
  const stylePath = path.join(miniRoot, page + '.wxss')
  assert.ok(fs.existsSync(stylePath), page + ' is missing its WXSS file')
  const styles = fs.readFileSync(stylePath, 'utf8')
  assert.match(styles, tabletMedia, page + ' is missing its iPad/tablet media block')
  ;(contracts[page] || []).forEach((contract) => {
    assert.match(styles, contract, page + ' does not satisfy tablet layout contract ' + contract)
  })
})

const appStyles = fs.readFileSync(path.join(miniRoot, 'app.wxss'), 'utf8')
const navStyles = fs.readFileSync(path.join(miniRoot, 'components/primary-nav/primary-nav.wxss'), 'utf8')
assert.match(appStyles, /width:\s*calc\(100%\s*-\s*184px\)/, 'primary pages must reserve the tablet side rail')
assert.match(navStyles, /width:\s*184px/, 'tablet side rail width must remain deterministic')

console.log('Tablet audit passed: all ' + app.pages.length + ' pages have fixed-size iPad layout contracts.')
