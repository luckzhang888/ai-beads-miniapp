function calculateGap(required, stock) {
  return Math.max(0, Number(required || 0) - Number(stock || 0))
}

module.exports = { calculateGap }
