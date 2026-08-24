export const UGANDA_PHONE_HINT = 'Use a Uganda number such as 0701234567 or +256701234567.'

export function normalizeUgandaPhone(value: unknown, required = false): string {
  const raw = String(value ?? '').trim()
  if (!raw) {
    if (required) throw new Error(UGANDA_PHONE_HINT)
    return ''
  }
  let compact = raw.replace(/[\s\-().]/g, '')
  if (compact.startsWith('00256')) compact = `+256${compact.slice(5)}`
  let national = compact
  if (compact.startsWith('+256')) national = compact.slice(4)
  else if (compact.startsWith('256')) national = compact.slice(3)
  else if (compact.startsWith('0')) national = compact.slice(1)
  if (!/^[2347]\d{8}$/.test(national)) throw new Error(UGANDA_PHONE_HINT)
  return `+256${national}`
}
