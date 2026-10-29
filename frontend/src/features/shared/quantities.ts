/** Validate physical/approved quantities before forwarding them to Django. */
export function validateQuantity(value: string | number, maximum: number): string | null {
  const raw = String(value).trim()
  if (!raw) return 'Enter a quantity.'
  const quantity = Number(raw)
  if (!Number.isFinite(quantity)) return 'Enter a valid number.'
  if (quantity < 0) return 'Quantity cannot be negative.'
  if (!Number.isFinite(maximum) || maximum < 0) return 'The allowed quantity is unavailable.'
  if (quantity > maximum) return 'Quantity exceeds the outstanding or approved amount.'
  return null
}

export function validateApproval(value: string | number, maximum: number, reason: string): string | null {
  const quantityError = validateQuantity(value, maximum)
  if (quantityError) return quantityError
  const amount = Number(value)
  if (amount < maximum && !reason.trim()) return 'Explain why the approved quantity is reduced.'
  return null
}

export function validateCount(value: string | number): string | null {
  const raw = String(value).trim()
  if (!raw) return 'Enter the counted quantity.'
  const quantity = Number(raw)
  if (!Number.isFinite(quantity)) return 'Enter a valid number.'
  if (quantity < 0) return 'Counted quantity cannot be negative.'
  return null
}
