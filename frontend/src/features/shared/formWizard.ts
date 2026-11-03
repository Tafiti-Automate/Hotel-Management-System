const SUPPLIER_QUOTATION_STEPS = [
  ['supplier', 'article', 'unit', 'supplierSku'],
  ['quotationReference', 'quotationValidUntil', 'price', 'currency'],
  ['effectiveFrom', 'minimumOrder', 'leadTime', 'lastQuoted', 'status'],
] as const

type FormField = { key: string }

/** Keep long forms readable without leaving a nearly empty final wizard page. */
export function formWizardPages<T extends FormField>(entity: string, fields: T[]): T[][] {
  if (fields.length <= 6 || entity === 'items') return [fields]

  if (entity === 'supplierItems') {
    const fieldsByKey = new Map(fields.map((field) => [field.key, field]))
    const groupedKeys = new Set<string>(SUPPLIER_QUOTATION_STEPS.flat())
    const pages = SUPPLIER_QUOTATION_STEPS
      .map((keys) => keys.map((key) => fieldsByKey.get(key)).filter((field): field is T => Boolean(field)))
      .filter((page) => page.length > 0)
    const ungroupedFields = fields.filter((field) => !groupedKeys.has(field.key))

    if (ungroupedFields.length) pages[pages.length - 1].push(...ungroupedFields)
    return pages
  }

  const pages: T[][] = []
  for (let index = 0; index < fields.length; index += 4) pages.push(fields.slice(index, index + 4))
  return pages
}
