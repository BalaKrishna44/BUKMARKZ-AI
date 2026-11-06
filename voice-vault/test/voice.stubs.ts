export const S:any={user:{id:'u1'},rows:[] as any[],count:0,limit:false,budget:false,refunds:0,gate:0,usage:[] as any[],failInsert:null as any};
export const json=(b:unknown,s=200,h:Record<string,string>={})=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json',...h}});
export const requireUser=async()=>S.user; export const ANTHROPIC_MODEL='claude-sonnet-5-5';
export const admin={from:()=>({select(){return {eq(){return this},gte:async()=>({count:S.count})}},insert(r:any){return Promise.resolve(S.failInsert?{error:S.failInsert}:(S.rows.push(r),{error:null}))}})};
export class BudgetExceededError extends Error{toJSON(){return{error:'budget_exceeded'}}}
export const FALLBACK_MODEL=()=>'claude-haiku-5-5';
export const assertBudget=async()=>{if(S.budget)throw new BudgetExceededError('x');return{degraded:false}};
export const recordUsage=async(o:any)=>{S.usage.push(o.feature)};
export class LimitErr extends Error{}
export const checkFeatureLimit=async()=>{S.gate++;if(S.limit)throw new LimitErr('l')};
export const refundFeature=async()=>{S.refunds++};
export const gateErrorResponse=(e:unknown)=>e instanceof LimitErr?new Response('{"error":"limit_exceeded"}',{status:402}):null;
export const claudeTool=async(o:any)=>{ if((globalThis as any).__llmFail) throw new Error('llm down'); o.onUsage?.({model:o.model,inputTokens:100,outputTokens:50}); return (globalThis as any).__llm ?? {title:'Call dentist',summary:'I need to call the dentist on Monday. Ask about the new appointment slot.',categories:['Health','To-Do','Dentist!']}};
