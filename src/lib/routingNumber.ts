// JAY-65 — ABA routing number checksum validation. Real routing numbers
// carry a checksum digit specifically so a single mistyped/transposed digit
// is mechanically detectable before the number is ever trusted. Previously
// the direct deposit form only checked "9 digits", which passes plenty of
// invalid numbers.
//
// Algorithm (standard ABA routing-number checksum): for digits d1..d9,
// 3*(d1+d4+d7) + 7*(d2+d5+d8) + 1*(d3+d6+d9) must be divisible by 10.
// Shared between client (DirectDepositForm.tsx, immediate feedback) and
// server (submit-form/route.ts, since the client check can't be trusted
// alone) — plain function, no server-only imports, safe to use from either.
export function isValidRoutingNumber(routingNumber: string): boolean {
  if (!/^\d{9}$/.test(routingNumber)) return false
  const digits = routingNumber.split('').map(Number)
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1]
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0)
  return sum % 10 === 0
}
