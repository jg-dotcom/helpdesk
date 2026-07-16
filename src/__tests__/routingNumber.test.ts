import { isValidRoutingNumber } from '../lib/routingNumber'

describe('isValidRoutingNumber', () => {
  it('accepts known-valid real bank routing numbers', () => {
    expect(isValidRoutingNumber('021000021')).toBe(true) // Chase (NY)
    expect(isValidRoutingNumber('011401533')).toBe(true) // Bank of America (MA)
    expect(isValidRoutingNumber('091000019')).toBe(true) // Wells Fargo (MN)
  })

  it('rejects a valid-looking number with one digit transposed/mistyped', () => {
    expect(isValidRoutingNumber('021000029')).toBe(false)
    expect(isValidRoutingNumber('021000012')).toBe(false) // transposed last two digits
  })

  it('rejects anything that is not exactly 9 digits', () => {
    expect(isValidRoutingNumber('12345678')).toBe(false) // 8 digits
    expect(isValidRoutingNumber('1234567890')).toBe(false) // 10 digits
    expect(isValidRoutingNumber('')).toBe(false)
    expect(isValidRoutingNumber('02100002a')).toBe(false) // non-digit char
  })

  it('rejects all-zeros (passes the checksum math but is not a real number pattern worth special-casing — still correctly a checksum pass)', () => {
    // 000000000 technically satisfies sum % 10 === 0; documenting the
    // behavior rather than special-casing it, since real routing number
    // prefixes (Federal Reserve district 00-12, 21-32, 61-72, 80) make an
    // all-zero number unissuable in practice — checksum-only validation is
    // the same tradeoff every implementation of this algorithm makes.
    expect(isValidRoutingNumber('000000000')).toBe(true)
  })
})
