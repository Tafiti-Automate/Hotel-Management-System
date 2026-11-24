// Local display preferences only: no report results, passwords or access grants.
export type SavedCriteria = {
  store:string; category:string; item:string; department:string; supplier:string;
  dateFrom:string; dateTo:string; status:string; documentType:string; actionType:string; valueMin:string;
  mode:'detail'|'summary'; groupIndex:number
}
export type ReportPreferences = { favorites:string[]; recent:string[]; saved:Record<string,SavedCriteria> }
export const emptyReportPreferences = ():ReportPreferences => ({favorites:[],recent:[],saved:{}})
const fields = ['store','category','item','department','supplier','dateFrom','dateTo','status','documentType','actionType','valueMin'] as const
export function reportPreferenceKey(userId:string,role:string,property:string):string {
  return userId && role && property ? 'hotel-report-preferences:v1:'+JSON.stringify([userId,role,property]) : ''
}
const validId=(id:unknown):id is string=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)
const uniqueIds=(value:unknown,limit:number)=>Array.isArray(value)?Array.from(new Set(value.filter(validId))).slice(0,limit):[]
export function normalizeReportPreferences(value:unknown):ReportPreferences {
  if(!value||typeof value!=='object')return emptyReportPreferences()
  const raw=value as Record<string,unknown>
  const saved:Record<string,SavedCriteria>={}
  if(raw.saved&&typeof raw.saved==='object'){
    for(const [id,entry] of Object.entries(raw.saved).slice(0,100)){
      if(!validId(id)||!entry||typeof entry!=='object')continue
      const record=entry as Record<string,unknown>
      const criteria=Object.fromEntries(fields.map(key=>[key,typeof record[key]==='string'?record[key].slice(0,150):''])) as Omit<SavedCriteria,'mode'|'groupIndex'>
      saved[id]={...criteria,mode:record.mode==='summary'?'summary':'detail',groupIndex:typeof record.groupIndex==='number'&&Number.isInteger(record.groupIndex)&&record.groupIndex>=-1&&record.groupIndex<=100?record.groupIndex:-1}
    }
  }
  return {favorites:uniqueIds(raw.favorites,100),recent:uniqueIds(raw.recent,12),saved}
}
export function readReportPreferences(key:string):ReportPreferences {
  if(!key||typeof window==='undefined')return emptyReportPreferences()
  try{return normalizeReportPreferences(JSON.parse(window.localStorage.getItem(key)||'{}'))}catch{return emptyReportPreferences()}
}
export function updateReportPreferences(key:string,edit:(old:ReportPreferences)=>ReportPreferences):{preferences:ReportPreferences; persisted:boolean} {
  const preferences=normalizeReportPreferences(edit(readReportPreferences(key)))
  if(!key||typeof window==='undefined')return {preferences,persisted:false}
  try{window.localStorage.setItem(key,JSON.stringify(preferences));return {preferences,persisted:true}}catch{return {preferences,persisted:false}}
}
