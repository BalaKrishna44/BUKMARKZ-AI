const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(__dirname + '/../popup.js', 'utf8');

function makeEl(id){ const h={}; return {id, hidden:false, disabled:false, value:'', textContent:'', className:'', children:[],
  addEventListener(t,f){h[t]=f}, fire(t,e){return h[t]&&h[t](e||{preventDefault(){}})}, appendChild(c){this.children.push(c)}, focus(){} }; }
async function run(name, {session, fetchImpl, tab}) {
  const ids=['login-view','save-view','logout','status','username','password','login-btn','page-title','page-url','note','category','save-btn'];
  const els={}; ids.forEach(i=>els[i]=makeEl(i));
  const store = Object.assign({}, session||{});
  const calls=[]; let closed=false;
  const ctx = {
    console, setTimeout:(f)=>0, clearTimeout(){}, Date, JSON, Promise, URL, Object, String, Number, Array, Error, AbortController,
    document:{getElementById:i=>els[i], createElement:()=>({})},
    window:{close(){closed=true}},
    fetch: async (url,opts)=>{calls.push({url,opts}); return fetchImpl(url,opts)},
    chrome:{
      storage:{local:{get:async k=>{const o={};k.forEach(x=>{if(x in store)o[x]=store[x]});return o}, set:async o=>Object.assign(store,o), remove:async k=>k.forEach(x=>delete store[x])}},
      tabs:{query:async()=>[tab]},
      scripting:{executeScript:async()=>[{result:'meta text'}]}
    }
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r));
  return {els, calls, store, closed:()=>closed, ctx};
}
const resp=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
const tab={id:5,title:'Pasta recipes',url:'https://example.com/pasta'};
const future=new Date(Date.now()+864e5).toISOString();
let fails=0; const check=(c,m)=>{if(!c){fails++;console.log('FAIL:',m)}else console.log('ok  :',m)};

(async()=>{
  // 1. signed-in save success
  let t=await run('save',{session:{token:'abc',expiry:future},tab,fetchImpl:async(u)=>u.endsWith('/category/')?resp(200,[{id:3,title:'Reading',private:false},{id:4,title:'Secret',private:true}]):resp(201,{id:1,created:true})});
  check(!t.els['save-view'].hidden && t.els['login-view'].hidden,'shows save view when token stored');
  check(t.els['page-title'].textContent==='Pasta recipes','shows tab title');
  check(t.els['category'].children.length===1,'private categories hidden from dropdown');
  await t.els['save-view'].fire('submit');
  const save=t.calls.find(c=>c.url.endsWith('/extension/bookmarks/'));
  check(save && save.opts.headers.Authorization==='Token abc','sends Token auth header');
  check(save.opts.credentials==='omit','omits cookies');
  const body=JSON.parse(save.opts.body);
  check(body.url===tab.url && body.title==='Pasta recipes' && body.context==='meta text','payload has url, title, page context');
  check(t.els['status'].textContent.startsWith('Saved'),'shows saved message');

  // 2. duplicate
  t=await run('dup',{session:{token:'abc',expiry:future},tab,fetchImpl:async(u)=>u.endsWith('/category/')?resp(200,[]):resp(200,{created:false})});
  await t.els['save-view'].fire('submit');
  check(t.els['status'].textContent.startsWith('Already'),'duplicate shows already-saved message');

  // 3. 401 -> back to login
  t=await run('401',{session:{token:'old',expiry:future},tab,fetchImpl:async(u)=>u.endsWith('/category/')?resp(200,[]):resp(401,{detail:'Invalid token.'})});
  await t.els['save-view'].fire('submit');
  check(!t.els['login-view'].hidden && !('token' in t.store),'401 clears token and shows login');

  // 4. validation error text
  t=await run('400',{session:{token:'abc',expiry:future},tab,fetchImpl:async(u)=>u.endsWith('/category/')?resp(200,[]):resp(400,{url:['Only http(s) URLs are allowed.']})});
  await t.els['save-view'].fire('submit');
  check(t.els['status'].textContent==='Only http(s) URLs are allowed.' && t.els['save-btn'].disabled===false,'400 shows server message and re-enables button');

  // 5. network failure
  t=await run('net',{session:{token:'abc',expiry:future},tab,fetchImpl:async(u)=>{ if(u.endsWith('/category/')) return resp(200,[]); throw new Error('offline')}});
  await t.els['save-view'].fire('submit');
  check(/Can’t reach/.test(t.els['status'].textContent),'network error message');

  // 6. unsavable page
  t=await run('chrome',{session:{token:'abc',expiry:future},tab:{id:1,title:'Settings',url:'chrome://settings'},fetchImpl:async()=>resp(200,[])});
  check(t.els['save-btn'].disabled===true && /can’t be saved/.test(t.els['page-title'].textContent),'blocks chrome:// pages');

  // 7. expired token -> login
  t=await run('exp',{session:{token:'abc',expiry:new Date(Date.now()-1000).toISOString()},tab,fetchImpl:async()=>resp(200,[])});
  check(!t.els['login-view'].hidden,'expired token shows login');

  // 8. login flow
  t=await run('login',{session:{},tab,fetchImpl:async(u)=>u.endsWith('/auth/login/')?resp(200,{token:'newtok',expiry:future}):resp(200,[])});
  t.els['username'].value='krishna'; t.els['password'].value='pw';
  await t.els['login-view'].fire('submit');
  check(t.store.token==='newtok' && !t.els['save-view'].hidden && t.els['password'].value==='','login stores token, clears password, shows save view');
  console.log(fails?`\n${fails} FAILED`:'\nall smoke checks passed'); process.exit(fails?1:0);
})();
