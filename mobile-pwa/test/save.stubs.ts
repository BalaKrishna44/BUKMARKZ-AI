export const state:any={user:{id:'u1'},rows:[] as any[],limit:false,gate:0,refunds:0,failInsert:null as any};
export const json=(b:unknown,s=200,h:Record<string,string>={})=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json',...h}});
export const requireUser=async()=>state.user;
const q=(t:string)=>{const f:any={};return {select(){return this},eq(c:string,v:any){f[c]=v;return this},maybeSingle:async()=>({data:state.rows.find((r:any)=>r.url_key===f.url_key&&r.user_id===f.user_id)??null}),
 insert(r:any){return {select(){return {single:async()=>{ if(state.failInsert) return {data:null,error:state.failInsert}; const row={...r,id:'i'+(state.rows.length+1)}; state.rows.push(row); return {data:row,error:null}}}}}}}};
export const admin={from:q};
export class LimitExceededError extends Error{}
export const checkFeatureLimit=async()=>{state.gate++; if(state.limit) throw new LimitExceededError('over')};
export const refundFeature=async()=>{state.refunds++};
export const gateErrorResponse=(e:unknown)=>e instanceof LimitExceededError?new Response(JSON.stringify({error:'limit_exceeded',message:'over'}),{status:402}):null;
