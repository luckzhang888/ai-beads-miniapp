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

function degToRad(value) {
  return value * Math.PI / 180
}

function radToDeg(value) {
  return value * 180 / Math.PI
}

function hueAngle(b, aPrime) {
  if (aPrime === 0 && b === 0) return 0
  const angle = radToDeg(Math.atan2(b, aPrime))
  return angle >= 0 ? angle : angle + 360
}

// CIEDE2000, kL = kC = kH = 1.
function deltaE2000(lab1, lab2) {
  const L1 = lab1[0]
  const a1 = lab1[1]
  const b1 = lab1[2]
  const L2 = lab2[0]
  const a2 = lab2[1]
  const b2 = lab2[2]

  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const cBar = (C1 + C2) / 2
  const cBar7 = Math.pow(cBar, 7)
  const G = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))))

  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.sqrt(a1p * a1p + b1 * b1)
  const C2p = Math.sqrt(a2p * a2p + b2 * b2)
  const h1p = hueAngle(b1, a1p)
  const h2p = hueAngle(b2, a2p)

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p
    if (Math.abs(diff) <= 180) dhp = diff
    else if (diff > 180) dhp = diff - 360
    else dhp = diff + 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(degToRad(dhp / 2))

  const lBar = (L1 + L2) / 2
  const cpBar = (C1p + C2p) / 2
  let hpBar = h1p + h2p
  if (C1p * C2p === 0) {
    hpBar = h1p + h2p
  } else if (Math.abs(h1p - h2p) <= 180) {
    hpBar = (h1p + h2p) / 2
  } else if (h1p + h2p < 360) {
    hpBar = (h1p + h2p + 360) / 2
  } else {
    hpBar = (h1p + h2p - 360) / 2
  }

  const T = 1
    - 0.17 * Math.cos(degToRad(hpBar - 30))
    + 0.24 * Math.cos(degToRad(2 * hpBar))
    + 0.32 * Math.cos(degToRad(3 * hpBar + 6))
    - 0.20 * Math.cos(degToRad(4 * hpBar - 63))

  const dTheta = 30 * Math.exp(-Math.pow((hpBar - 275) / 25, 2))
  const cpBar7 = Math.pow(cpBar, 7)
  const Rc = 2 * Math.sqrt(cpBar7 / (cpBar7 + Math.pow(25, 7)))
  const Sl = 1 + (0.015 * Math.pow(lBar - 50, 2)) /
    Math.sqrt(20 + Math.pow(lBar - 50, 2))
  const Sc = 1 + 0.045 * cpBar
  const Sh = 1 + 0.015 * cpBar * T
  const Rt = -Math.sin(degToRad(2 * dTheta)) * Rc

  const lTerm = dLp / Sl
  const cTerm = dCp / Sc
  const hTerm = dHp / Sh

  return Math.sqrt(
    lTerm * lTerm +
    cTerm * cTerm +
    hTerm * hTerm +
    Rt * cTerm * hTerm
  )
}

module.exports = {
  rgbToXyz,
  xyzToLab,
  rgbToLab,
  deltaE76,
  deltaE2000
}
