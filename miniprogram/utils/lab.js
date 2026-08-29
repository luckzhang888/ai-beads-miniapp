function srgbChannelToLinear(value) {
  const c = value / 255
  return c <= 0.04045
    ? c / 12.92
    : Math.pow((c + 0.055) / 1.055, 2.4)
}

function rgbToXyz(rgb) {
  const r = srgbChannelToLinear(rgb[0])
  const g = srgbChannelToLinear(rgb[1])
  const b = srgbChannelToLinear(rgb[2])

  return [
    (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100,
    (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) * 100,
    (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) * 100
  ]
}

function xyzPivot(value) {
  const delta = 6 / 29
  const delta3 = delta * delta * delta
  return value > delta3
    ? Math.cbrt(value)
    : value / (3 * delta * delta) + 4 / 29
}

function xyzToLab(xyz) {
  const fx = xyzPivot(xyz[0] / 95.047)
  const fy = xyzPivot(xyz[1] / 100.000)
  const fz = xyzPivot(xyz[2] / 108.883)

  return [
    116 * fy - 16,
    500 * (fx - fy),
    200 * (fy - fz)
  ]
}

function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb))
}

function deltaE76(lab1, lab2) {
  const dl = lab1[0] - lab2[0]
  const da = lab1[1] - lab2[1]
  const db = lab1[2] - lab2[2]
  return Math.sqrt(dl * dl + da * da + db * db)
}

module.exports = {
  rgbToXyz,
  xyzToLab,
  rgbToLab,
  deltaE76
}
