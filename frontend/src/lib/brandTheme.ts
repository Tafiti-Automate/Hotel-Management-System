export interface BrandPalette {
  primary: string
  secondary: string
  accent: string
}

const FALLBACK: BrandPalette = { primary: '#1D4ED8', secondary: '#0F766E', accent: '#D97706' }

function clamp(value: number) { return Math.max(0, Math.min(255, Math.round(value))) }
function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return { r: 29, g: 78, b: 216 }
  const n = parseInt(clean, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
function rgbToHex(r: number, g: number, b: number) {
  return `#${[r,g,b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}
function mix(a: string, b: string, amount: number) {
  const x = hexToRgb(a), y = hexToRgb(b)
  return rgbToHex(x.r + (y.r-x.r)*amount, x.g + (y.g-x.g)*amount, x.b + (y.b-x.b)*amount)
}
function rgba(hex: string, alpha: number) {
  const { r,g,b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}
function luminance(hex: string) {
  const {r,g,b}=hexToRgb(hex)
  const c=[r,g,b].map(v=>{const n=v/255;return n<=.03928?n/12.92:Math.pow((n+.055)/1.055,2.4)})
  return .2126*c[0]+.7152*c[1]+.0722*c[2]
}
export function readableText(background: string) { return luminance(background) > .42 ? '#10233F' : '#FFFFFF' }

export function brandThemeVars(palette: BrandPalette | null | undefined, mode: 'light'|'dark'): Record<string,string> {
  if (!palette) return {}
  const p = palette
  const primary = p.primary || FALLBACK.primary
  const secondary = p.secondary || FALLBACK.secondary
  const accent = p.accent || FALLBACK.accent
  if (mode === 'dark') return {
    '--accent': mix(primary, '#FFFFFF', .12),
    '--accent-strong': mix(primary, '#000000', .18),
    '--accent-soft': rgba(primary, .25),
    '--brand-primary': primary,
    '--brand-secondary': secondary,
    '--brand-highlight': accent,
    '--brand-on-primary': readableText(primary),
    '--bg': mix(primary, '#080B12', .88),
    '--surface': mix(primary, '#141821', .91),
    '--surface-2': mix(primary, '#202633', .91),
    '--surface-3': mix(primary, '#2A3241', .91),
    '--border': mix(primary, '#394254', .88),
    '--border-2': mix(primary, '#4A556B', .86),
  }
  return {
    '--accent': primary,
    '--accent-strong': mix(primary, '#000000', .16),
    '--accent-soft': rgba(primary, .11),
    '--brand-primary': primary,
    '--brand-secondary': secondary,
    '--brand-highlight': accent,
    '--brand-on-primary': readableText(primary),
    '--bg': mix(primary, '#F4F7FB', .94),
    '--surface': mix(primary, '#FFFFFF', .975),
    '--surface-2': mix(primary, '#EEF3F8', .94),
    '--surface-3': mix(primary, '#E1E8F0', .93),
    '--border': mix(primary, '#D2DCE8', .92),
    '--border-2': mix(primary, '#BAC8D8', .90),
  }
}

function colorDistance(a: number[], b: number[]) { return Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2) }
function saturation([r,g,b]: number[]) { const max=Math.max(r,g,b), min=Math.min(r,g,b); return max===0?0:(max-min)/max }

export async function extractPaletteFromImage(source: File | string): Promise<BrandPalette> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('Unable to read the logo image.'));img.src=url})
    const canvas=document.createElement('canvas'); canvas.width=96; canvas.height=96
    const ctx=canvas.getContext('2d',{willReadFrequently:true}); if(!ctx) return FALLBACK
    ctx.clearRect(0,0,96,96); ctx.drawImage(img,0,0,96,96)
    const data=ctx.getImageData(0,0,96,96).data
    const buckets=new Map<string,{rgb:number[],count:number}>()
    for(let i=0;i<data.length;i+=16){
      if(data[i+3]<180) continue
      const rgb=[data[i],data[i+1],data[i+2]]
      const max=Math.max(...rgb), min=Math.min(...rgb)
      if(max>245&&min>235) continue
      if(max<25) continue
      const q=rgb.map(v=>Math.round(v/32)*32)
      const key=q.join(','); const item=buckets.get(key)||{rgb:q,count:0}; item.count++; buckets.set(key,item)
    }
    const colors=[...buckets.values()].sort((a,b)=>(b.count*(.55+saturation(b.rgb)))-(a.count*(.55+saturation(a.rgb))))
    if(!colors.length) return FALLBACK
    const first=colors[0].rgb
    const second=(colors.find(c=>colorDistance(c.rgb,first)>95)||colors[1]||colors[0]).rgb
    const third=(colors.find(c=>colorDistance(c.rgb,first)>70&&colorDistance(c.rgb,second)>70)||colors[2]||colors[1]||colors[0]).rgb
    return { primary:rgbToHex(...first as [number,number,number]), secondary:rgbToHex(...second as [number,number,number]), accent:rgbToHex(...third as [number,number,number]) }
  } finally { if(typeof source !== 'string') URL.revokeObjectURL(url) }
}
