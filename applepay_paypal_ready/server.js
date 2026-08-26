require("dotenv").config();
const express=require("express");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const session=require("express-session");
const multer=require("multer");
const helmet=require("helmet");
const rateLimit=require("express-rate-limit");

const app=express();
const PORT=Number(process.env.PORT||3000);
const ROOT=__dirname;
const PUBLIC=path.join(ROOT,"public");
const DATA=path.join(ROOT,"data");
const UPLOADS=path.join(ROOT,"uploads");
const PRODUCTS=path.join(DATA,"products.json");
const ORDERS=path.join(DATA,"orders.json");
const RECEIPT_LOGS=path.join(DATA,"receipt-logs.json");
const NOTIFICATIONS=path.join(DATA,"notifications.json");
const PRODUCT_COMMENTS=path.join(DATA,"product-comments.json");
const SUPPORT_CHATS=path.join(DATA,"support-chats.json");
const PREMIUM_ACCESS=path.join(DATA,"premium-access.json");
const COUPONS=path.join(DATA,"coupons.json");
const ADMIN_ACCESS=path.join(DATA,"admin-access.json");
const STORE_CONTENT=path.join(DATA,"store-content.json");
const RECEIPT_DIR=path.join(UPLOADS,"receipts");

/* Persistent storage (Supabase)
   Keeps JSON data + uploaded images alive across Render restarts/redeploys.
   Required env vars:
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   Optional:
   SUPABASE_BUCKET=eleven-store
   SUPABASE_STATE_TABLE=store_state
*/
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SERVICE_ROLE_KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"");
const SUPABASE_BUCKET=String(process.env.SUPABASE_BUCKET||"eleven-store").trim()||"eleven-store";
const SUPABASE_STATE_TABLE=String(process.env.SUPABASE_STATE_TABLE||"store_state").trim()||"store_state";
const SUPABASE_ENABLED=Boolean(SUPABASE_URL&&SUPABASE_SERVICE_ROLE_KEY);
let PERSISTENCE_READY=false;
const persistQueues=new Map();

const PERSISTED_JSON_FILES=new Map([
  [PRODUCTS,"products"],
  [ORDERS,"orders"],
  [RECEIPT_LOGS,"receipt-logs"],
  [NOTIFICATIONS,"notifications"],
  [PRODUCT_COMMENTS,"product-comments"],
  [SUPPORT_CHATS,"support-chats"],
  [PREMIUM_ACCESS,"premium-access"],
  [COUPONS,"coupons"],
  [ADMIN_ACCESS,"admin-access"],
  [STORE_CONTENT,"store-content"]
]);

function sbHeaders(extra={}){
  return {
    apikey:SUPABASE_SERVICE_ROLE_KEY,
    Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}
function localWrite(file,data){
  const tmp=file+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(data,null,2));
  fs.renameSync(tmp,file);
}
async function supabaseGetState(key){
  if(!SUPABASE_ENABLED)return null;
  const url=`${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}?select=value&key=eq.${encodeURIComponent(key)}&limit=1`;
  const r=await fetch(url,{headers:sbHeaders({Accept:"application/json"})});
  if(!r.ok)throw new Error(`Supabase state read failed (${r.status}): ${await r.text().catch(()=>r.statusText)}`);
  const rows=await r.json();
  return Array.isArray(rows)&&rows.length?rows[0].value:null;
}
async function supabaseUpsertState(key,value){
  if(!SUPABASE_ENABLED)return;
  const url=`${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}?on_conflict=key`;
  const r=await fetch(url,{
    method:"POST",
    headers:sbHeaders({
      "Content-Type":"application/json",
      Prefer:"resolution=merge-duplicates,return=minimal"
    }),
    body:JSON.stringify([{key,value,updated_at:new Date().toISOString()}])
  });
  if(!r.ok)throw new Error(`Supabase state write failed (${r.status}): ${await r.text().catch(()=>r.statusText)}`);
}
function queueStatePersist(file,data){
  if(!PERSISTENCE_READY||!SUPABASE_ENABLED)return;
  const key=PERSISTED_JSON_FILES.get(file);
  if(!key)return;
  const snapshot=JSON.parse(JSON.stringify(data));
  const prev=persistQueues.get(key)||Promise.resolve();
  const next=prev.catch(()=>{}).then(()=>supabaseUpsertState(key,snapshot));
  persistQueues.set(key,next);
  next.catch(e=>console.error(`[PERSISTENCE] ${key} save failed:`,e.message||e))
      .finally(()=>{if(persistQueues.get(key)===next)persistQueues.delete(key)});
}
async function bootstrapPersistentState(){
  if(!SUPABASE_ENABLED){
    PERSISTENCE_READY=true;
    console.warn("[PERSISTENCE] Supabase is not configured. Render local data can disappear after restart/redeploy.");
    return;
  }
  console.log("[PERSISTENCE] Loading store data from Supabase...");
  for(const [file,key] of PERSISTED_JSON_FILES){
    try{
      const remote=await supabaseGetState(key);
      if(remote!==null&&remote!==undefined){
        localWrite(file,remote);
        console.log(`[PERSISTENCE] restored ${key}`);
      }else{
        const local=read(file,null);
        if(local!==null){
          await supabaseUpsertState(key,local);
          console.log(`[PERSISTENCE] seeded ${key}`);
        }
      }
    }catch(e){
      console.error(`[PERSISTENCE] ${key} bootstrap failed:`,e.message||e);
      throw e;
    }
  }
  PERSISTENCE_READY=true;
  console.log("[PERSISTENCE] JSON data is protected by Supabase.");
}
function storageObjectUrl(objectPath){
  const clean=String(objectPath||"").replace(/^\/+/,"").split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${clean}`;
}
async function persistDiskUpload(file){
  if(!file||!SUPABASE_ENABLED)return;
  const body=fs.readFileSync(file.path);
  const objectPath=String(file.filename||path.basename(file.path));
  const r=await fetch(storageObjectUrl(objectPath),{
    method:"POST",
    headers:sbHeaders({
      "Content-Type":file.mimetype||"application/octet-stream",
      "x-upsert":"true"
    }),
    body
  });
  if(!r.ok)throw new Error(`Supabase image upload failed (${r.status}): ${await r.text().catch(()=>r.statusText)}`);
}
async function persistBufferUpload(objectPath,buffer,mimetype){
  if(!SUPABASE_ENABLED)return false;
  const r=await fetch(storageObjectUrl(objectPath),{
    method:"POST",
    headers:sbHeaders({
      "Content-Type":mimetype||"application/octet-stream",
      "x-upsert":"true"
    }),
    body:buffer
  });
  if(!r.ok)throw new Error(`Supabase file upload failed (${r.status}): ${await r.text().catch(()=>r.statusText)}`);
  return true;
}
async function serveSupabaseUpload(req,res,next){
  if(!SUPABASE_ENABLED)return next();
  try{
    const objectPath=decodeURIComponent(String(req.path||"").replace(/^\/+/,""));
    if(!objectPath)return next();
    const r=await fetch(storageObjectUrl(objectPath),{headers:sbHeaders()});
    if(r.status===404)return next();
    if(!r.ok)throw new Error(`Supabase file read failed (${r.status})`);
    const buf=Buffer.from(await r.arrayBuffer());
    const type=r.headers.get("content-type");
    if(type)res.set("Content-Type",type);
    res.set("Cache-Control","public, max-age=86400");
    return res.send(buf);
  }catch(e){
    console.error("[PERSISTENCE] upload proxy failed:",e.message||e);
    return next();
  }
}
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UPLOADS,{recursive:true});fs.mkdirSync(RECEIPT_DIR,{recursive:true});

function read(file,fallback){try{return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):fallback}catch(e){console.error(e);return fallback}}
function storeContent(){return read(STORE_CONTENT,{main:{},fast:{},smart:{}})}
function saveStoreContent(v){write(STORE_CONTENT,v)}
function write(file,data){localWrite(file,data);queueStatePersist(file,data)}
function products(){return read(PRODUCTS,[])}function saveProducts(v){write(PRODUCTS,v)}function orders(){return read(ORDERS,[])}function saveOrders(v){write(ORDERS,v)}
function nextId(rows){return rows.reduce((m,x)=>Math.max(m,Number(x.id||0)),0)+1}
if(!fs.existsSync(PRODUCTS))saveProducts([]);if(!fs.existsSync(ORDERS))saveOrders([]);if(!fs.existsSync(RECEIPT_LOGS))write(RECEIPT_LOGS,[]);if(!fs.existsSync(NOTIFICATIONS))write(NOTIFICATIONS,[]);if(!fs.existsSync(PRODUCT_COMMENTS))write(PRODUCT_COMMENTS,{});if(!fs.existsSync(SUPPORT_CHATS))write(SUPPORT_CHATS,[]);if(!fs.existsSync(PREMIUM_ACCESS))write(PREMIUM_ACCESS,[]);if(!fs.existsSync(COUPONS))write(COUPONS,[]);if(!fs.existsSync(ADMIN_ACCESS))write(ADMIN_ACCESS,[]);if(!fs.existsSync(STORE_CONTENT))write(STORE_CONTENT,{main:{badge:"TOP PICKS",title:"Premium Scripts & Files",description:"Interactive browsing, Discord reviews, and live support.",image:""},fast:{badge:"FAST",title:"Modern storefront",description:"",image:""},smart:{badge:"SMART",title:"Technical support chat",description:"",image:""}});

app.set("trust proxy",1);
app.use(helmet({
  contentSecurityPolicy:{
    directives:{
      defaultSrc:["'self'"],
      scriptSrc:["'self'","https://www.ksamerchant.geidea.net","https://www.paypal.com","https://www.sandbox.paypal.com","https://applepay.cdn-apple.com"],
      styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
      fontSrc:["'self'","https://fonts.gstatic.com","data:"],
      imgSrc:["'self'","data:","blob:","https://www.paypalobjects.com","https://*.paypalobjects.com","https://www.paypal.com","https://*.paypal.com"],
      connectSrc:["'self'","https://api.ksamerchant.geidea.net","https://www.paypal.com","https://www.sandbox.paypal.com","https://api-m.paypal.com","https://api-m.sandbox.paypal.com"],
      frameSrc:["'self'","https://www.ksamerchant.geidea.net","https://www.paypal.com","https://www.sandbox.paypal.com"],
      objectSrc:["'none'"],
      baseUri:["'self'"]
    }
  }
}));
app.use(express.json({limit:"500kb"}));
app.use(express.urlencoded({extended:true}));

app.use(session({
  name:"eleven.sid",
  secret:process.env.SESSION_SECRET||"CHANGE_ME",
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*8}
}));

const authLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false});
const apiLimiter=rateLimit({windowMs:60*1000,limit:180,standardHeaders:true,legacyHeaders:false});
app.use("/api/",apiLimiter);

const storage=multer.diskStorage({
  destination:(_req,_file,cb)=>cb(null,UPLOADS),
  filename:(_req,file,cb)=>{
    const ext=path.extname(file.originalname||"").toLowerCase();
    const ok=[".png",".jpg",".jpeg",".webp",".gif"].includes(ext)?ext:".jpg";
    cb(null,`${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ok}`);
  }
});
const upload=multer({
  storage,limits:{fileSize:5*1024*1024},
  fileFilter:(_req,file,cb)=>/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)?cb(null,true):cb(new Error("Invalid image type"))
});

const receiptUpload=multer({
  storage: multer.memoryStorage(),
  limits:{fileSize:8*1024*1024},
  fileFilter:(_req,file,cb)=>{
    const ok=/^image\/(png|jpeg|webp)$/.test(file.mimetype)||file.mimetype==="application/pdf";
    ok?cb(null,true):cb(new Error("Receipt must be PNG, JPG, WEBP or PDF."));
  }
});


function adminAccessRows(){return read(ADMIN_ACCESS,[])}
function saveAdminAccessRows(rows){write(ADMIN_ACCESS,rows)}
function adminAccessFor(discordId){return adminAccessRows().find(x=>String(x.discordId||"")===String(discordId||""))||null}
function registerAdminRequest(user){
  if(!user?.id)return null;
  const rows=adminAccessRows(),id=String(user.id),i=rows.findIndex(x=>String(x.discordId||"")===id),now=new Date().toISOString();
  const base={discordId:id,username:String(user.username||""),globalName:String(user.globalName||""),avatar:String(user.avatar||""),lastLoginAt:now};
  if(i>=0){rows[i]={...rows[i],...base};if(!rows[i].status)rows[i].status="pending";if(typeof rows[i].canEdit!=="boolean")rows[i].canEdit=false}
  else rows.push({...base,status:"pending",canEdit:false,requestedAt:now,updatedAt:now});
  saveAdminAccessRows(rows);
  return rows[i>=0?i:rows.length-1];
}
function isOwner(req){return req.session?.isAdmin===true&&req.session?.adminRole==="owner"}
function currentStaffAccess(req){const id=req.session?.adminDiscordId||req.session?.discordUser?.id;if(!id)return null;return adminAccessFor(id)}
function isAdmin(req){if(isOwner(req))return true;const row=currentStaffAccess(req);return req.session?.isAdmin===true&&req.session?.adminRole==="staff"&&row?.status==="approved"}
function canEditAdmin(req){if(isOwner(req))return true;const row=currentStaffAccess(req);return isAdmin(req)&&row?.canEdit===true}
function adminActor(req){
  if(isOwner(req))return {id:"owner",name:"Owner"};
  const row=currentStaffAccess(req);
  return {id:String(row?.discordId||req.session?.discordUser?.id||"staff"),name:String(row?.globalName||row?.username||req.session?.discordUser?.globalName||req.session?.discordUser?.username||"Staff")};
}
function ensureCsrf(req){if(!req.session.csrfToken)req.session.csrfToken=crypto.randomBytes(32).toString("hex");return req.session.csrfToken}
function requireAdmin(req,res,next){if(!isAdmin(req))return res.status(401).json({message:"Admin access is not approved."});next()}
function requireOwner(req,res,next){if(!isOwner(req))return res.status(403).json({message:"Owner access required."});next()}
function requireAdminEdit(req,res,next){if(!canEditAdmin(req))return res.status(403).json({message:"Editing permission is not enabled for this admin."});next()}
function requireCsrf(req,res,next){const token=String(req.get("X-CSRF-Token")||"");if(!isAdmin(req)||!req.session.csrfToken||token!==req.session.csrfToken)return res.status(403).json({message:"Invalid security token"});next()}
function cleanSlug(v){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)}
function sorted(rows){return [...rows].sort((a,b)=>(Number(a.sortOrder||0)-Number(b.sortOrder||0))||(Number(b.id)-Number(a.id)))}
function isPremiumSubscriptionProduct(p){return String(p?.productType||'')==='premium_subscription'||String(p?.slug||'')==='fivevault-premium'}
function categoryForProduct(p){const tag=String(p?.tag||'').toLowerCase();if(String(p?.productType||'')==='programming_service')return 'services';if(tag.includes('mlo'))return 'mlo';if(isPremiumSubscriptionProduct(p))return 'subscription';return 'scripts'}
function isPremiumEligibleScript(p){return categoryForProduct(p)==='scripts'&&String(p?.productType||'')!=='programming_service'&&!isPremiumSubscriptionProduct(p)}
function premiumControls(){return read(PREMIUM_ACCESS,[])}
function premiumControl(discordId){return premiumControls().find(x=>String(x.discordId||'')===String(discordId))||null}
function setPremiumControl(discordId,active){const rows=premiumControls();const id=String(discordId||'').trim();const i=rows.findIndex(x=>String(x.discordId||'')===id);const row={discordId:id,active:Boolean(active),updatedAt:new Date().toISOString()};if(i>=0)rows[i]={...rows[i],...row};else rows.push(row);write(PREMIUM_ACCESS,rows);return row}
function premiumPurchaseOrders(discordId){const ps=products();return read(RECEIPT_LOGS,[]).filter(o=>String(o?.discord?.id||'')===String(discordId)&&String(o?.status||'')==='delivered'&&(o.items||[]).some(it=>{const p=ps.find(pp=>Number(pp.id)===Number(it.productId));return (p&&isPremiumSubscriptionProduct(p))||/premium/i.test(String(it?.name||''))}))}
function hasPremiumAccess(discordId){if(!discordId)return false;const control=premiumControl(discordId);if(control&&control.active===false)return false;return premiumPurchaseOrders(discordId).length>0}
function premiumMembers(){const ps=products(),logs=read(RECEIPT_LOGS,[]),map=new Map();for(const o of logs){const discordId=String(o?.discord?.id||'');if(!discordId||String(o?.status||'')!=='delivered')continue;const premium=(o.items||[]).some(it=>{const p=ps.find(pp=>Number(pp.id)===Number(it.productId));return (p&&isPremiumSubscriptionProduct(p))||/premium/i.test(String(it?.name||''))});if(!premium)continue;const prev=map.get(discordId);if(!prev||String(o.createdAt||'')>String(prev.purchasedAt||''))map.set(discordId,{discordId,username:String(o?.discord?.username||''),globalName:String(o?.discord?.globalName||''),orderNumber:String(o?.orderNumber||''),purchasedAt:o?.deliveredAt||o?.createdAt||''})}return [...map.values()].map(m=>{const control=premiumControl(m.discordId);return {...m,active:hasPremiumAccess(m.discordId),updatedAt:control?.updatedAt||m.purchasedAt}}).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))}
function effectiveBasePrice(req,p){const premiumActive=hasPremiumAccess(req.session?.discordUser?.id);if(premiumActive&&isPremiumEligibleScript(p))return 0;return Number(p?.price||0)}
function publicProduct(req,p){const premiumActive=hasPremiumAccess(req.session?.discordUser?.id);const effectivePrice=premiumActive&&isPremiumEligibleScript(p)?0:Number(p.price||0);return {...p,effectivePrice,premiumIncluded:premiumActive&&isPremiumEligibleScript(p),category:categoryForProduct(p),rating:getRatingSummary(p.id)} }
function safeNextPath(v){const next=String(v||'').trim();if(!next.startsWith('/')||next.startsWith('//')||next.startsWith('/admin'))return '/';return next.slice(0,240)}
function requireCustomerApi(req,res,next){if(!req.session?.discordUser)return res.status(401).json({message:'Login required. Please sign in before checkout.'});next()}
function couponRows(){return read(COUPONS,[])}
function saveCouponRows(rows){write(COUPONS,rows)}
function cleanCouponCode(v){return String(v||"").trim().toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,32)}
function normalizeCartItems(req,requestItems){
  if(!Array.isArray(requestItems)||!requestItems.length)throw new Error("Cart is empty.");
  const ps=products(),normalized=[];let subtotal=0;
  for(const item of requestItems){
    const p=ps.find(x=>Number(x.id)===Number(item.productId)&&x.active!==false);
    const qty=Math.max(1,Math.min(Number(item.qty||1),20));
    if(!p)throw new Error("A product is unavailable.");
    let unitPrice=effectiveBasePrice(req,p),label=p.name;
    const option=String(item.option||"");
    if(p.productType==="programming_service"){
      const sp=p.servicePricing||{};
      if(option.startsWith("hours:")){
        const hours=Math.max(1,Math.min(Number(option.split(":")[1]||1),4));
        unitPrice=Number(sp.hourlyRate||0)*hours;label=`${p.name} - ${hours} Hour${hours>1?"s":""}`;
      }else if(option==="weekly"){unitPrice=Number(sp.weekly||0);label=`${p.name} - Weekly`}
      else if(option==="half_monthly"){unitPrice=Number(sp.halfMonthly||0);label=`${p.name} - Half Monthly`}
      else if(option==="monthly"){unitPrice=Number(sp.monthly||0);label=`${p.name} - Monthly`}
      else if(option==="yearly"){unitPrice=Number(sp.yearly||0);label=`${p.name} - Yearly`}
      else throw new Error("Choose a programming service option.");
    }
    if(!Number.isFinite(unitPrice)||unitPrice<0)throw new Error("Invalid product price.");
    subtotal+=unitPrice*qty;
    normalized.push({productId:p.id,name:label,qty,unitPrice:Number(unitPrice),lineTotal:Number((unitPrice*qty).toFixed(2))});
  }
  return {items:normalized,subtotal:Number(subtotal.toFixed(2))};
}
function applyCouponToCart(normalized,couponCode){
  const code=cleanCouponCode(couponCode);
  const subtotal=Number(normalized.subtotal||0);
  if(!code)return {subtotal,discount:0,total:subtotal,coupon:null};
  const coupon=couponRows().find(x=>cleanCouponCode(x.code)===code);
  if(!coupon||coupon.active===false)throw new Error("Coupon code is invalid or inactive.");
  const productIds=Array.isArray(coupon.productIds)?coupon.productIds.map(Number).filter(Number.isFinite):[];
  const eligible=(normalized.items||[]).filter(i=>!productIds.length||productIds.includes(Number(i.productId)));
  const eligibleSubtotal=eligible.reduce((a,i)=>a+Number(i.unitPrice||0)*Number(i.qty||1),0);
  if(eligibleSubtotal<=0)throw new Error("This coupon does not apply to the products in your cart.");
  const type=String(coupon.type||"percent");const value=Number(coupon.value||0);let discount=0;
  if(type==="percent")discount=eligibleSubtotal*Math.min(Math.max(value,0),100)/100;
  else if(type==="fixed")discount=Math.min(Math.max(value,0),eligibleSubtotal);
  else throw new Error("Coupon configuration is invalid.");
  discount=Number(discount.toFixed(2));const total=Number(Math.max(0,subtotal-discount).toFixed(2));
  return {subtotal,discount,total,coupon:{code:coupon.code,type,value,productIds}};
}
function hydrateOrderItems(order){
  const ps=products();
  return {...order,items:(Array.isArray(order?.items)?order.items:[]).map(it=>{const p=ps.find(x=>Number(x.id)===Number(it.productId));return {...it,name:String(it.name||p?.name||`Product #${it.productId||""}`),qty:Number(it.qty||1),unitPrice:Number(it.unitPrice||0)}})};
}

function commentStore(){return read(PRODUCT_COMMENTS,{});}
function commentKey(id){return String(Number(id)||0);}
function getReviewsForProduct(id){
  const all=commentStore(),key=commentKey(id),raw=all[key]||{};
  const legacy=Array.isArray(raw.comments)?raw.comments:[];
  const reviews=Array.isArray(raw.reviews)?raw.reviews:legacy.map(c=>({
    id:c.id,discordId:String(c.discordId||''),username:String(c.discordUsername||c.author||'Legacy user'),displayName:String(c.author||c.discordUsername||'Legacy user'),avatar:String(c.avatar||''),rating:Number(c.rating||0),message:String(c.message||''),createdAt:c.createdAt,updatedAt:c.updatedAt||c.createdAt,legacy:true
  }));
  return {reviews};
}
function saveReviewsForProduct(id,entry){
  const all=commentStore(),key=commentKey(id),prev=all[key]&&typeof all[key]==='object'?all[key]:{};
  all[key]={...prev,reviews:Array.isArray(entry.reviews)?entry.reviews:[]};
  write(PRODUCT_COMMENTS,all);return all[key];
}
function getRatingSummary(id){
  const reviews=getReviewsForProduct(id).reviews.filter(r=>Number(r.rating)>=1&&Number(r.rating)<=5);
  const count=reviews.length,average=count?reviews.reduce((a,r)=>a+Number(r.rating),0)/count:0;
  const distribution={1:0,2:0,3:0,4:0,5:0};for(const r of reviews)distribution[Math.round(Number(r.rating))]=(distribution[Math.round(Number(r.rating))]||0)+1;
  return {average:Number(average.toFixed(1)),count,distribution};
}
function publicReview(r){return {id:r.id,displayName:r.displayName||r.username||'Discord User',username:r.username||'',discordId:r.discordId||'',avatar:r.avatar||'',rating:Number(r.rating||0),message:String(r.message||''),createdAt:r.createdAt,updatedAt:r.updatedAt||r.createdAt,legacy:Boolean(r.legacy)}}

function supportChats(){return read(SUPPORT_CHATS,[])}
function saveSupportChats(rows){write(SUPPORT_CHATS,rows)}
function validSupportToken(value){return /^[a-f0-9-]{16,64}$/i.test(String(value||""))}
function publicSupportThread(thread){
  if(!thread)return null;
  return {
    id:thread.id,
    status:thread.status||"open",
    createdAt:thread.createdAt,
    updatedAt:thread.updatedAt,
    aiEnabled:thread.aiEnabled!==false,
    claimedBy:thread.claimedBy||null,
    messages:Array.isArray(thread.messages)?thread.messages.map(m=>({id:m.id,from:m.from,message:m.message,createdAt:m.createdAt})):[]
  };
}
function customerForSupport(req,token){
  const u=req.session?.discordUser;
  return {
    name:u?(u.globalName||u.username||"Discord User"):`Visitor ${String(token).slice(-4).toUpperCase()}`,
    discordId:u?.id||"",
    discordUsername:u?.username||""
  };
}

function generateAiSupportReply(message){
  const raw=String(message||'').trim();
  const msg=raw.toLowerCase().replace(/\s+/g,' ');
  const ar=/[\u0600-\u06FF]/.test(raw);
  const answer=(a,e)=>ar?a:e;
  if(!raw)return answer('هلا فيك، كيف أقدر أخدمك؟','Hi! How can I help you?');

  // Greetings must be checked before every commercial intent. "السلام عليكم" contains the letters "كم".
  if(/^(السلام|سلام|السلام عليكم|هلا|هلا والله|مرحبا|مرحباً|اهلين|أهلين|هاي|hello|hi|hey)(?:\s|$|[.!؟،])/i.test(msg) || /السلام عليكم/.test(msg)){
    return answer('وعليكم السلام، هلا فيك في Eleven Store. كيف أقدر أخدمك اليوم؟','Hi! Welcome to Eleven Store. How can I help you today?');
  }
  if(/(شكرا|شكراً|يعطيك العافية|مشكور|تسلم|thanks|thank you)/i.test(msg)){
    return answer('العفو، بالخدمة دائمًا. إذا احتجت أي شيء ثاني اكتب لي هنا.','You’re welcome. If you need anything else, just message me here.');
  }
  if(/(ابي موظف|ابغى موظف|أبي موظف|دعم بشري|شخص حقيقي|موظف الدعم|human|agent|staff)/i.test(msg)){
    return answer('أكيد. أرسل تفاصيل طلبك هنا، ويقدر أحد أفراد الدعم يستلم المحادثة ويكمل معك.','Sure. Send the details here and a support member can take over the conversation.');
  }
  if(/(وين طلبي|حالة طلبي|رقم الطلب|طلباتي|order status|my order|where.*order)/i.test(msg)){
    return answer('تقدر تراجع طلباتك من صفحة My Orders. إذا عندك رقم طلب معين ارسله هنا عشان يكون واضح لفريق الدعم.','You can check My Orders. If you have a specific order number, send it here so the support team can review it quickly.');
  }
  if(/(الدفع|تحويل|الايصال|الإيصال|فاتورة|checkout|payment|receipt|paid)/i.test(msg)){
    return answer('إذا المشكلة في الدفع، تأكد أنك مسجل دخول بحساب Discord الصحيح ثم أكمل من السلة. إذا رفعت إيصال وتحس الطلب تأخر، ارسل رقم الطلب هنا.','For payment issues, make sure you are signed in with the correct Discord account and continue from the cart. If you already uploaded a receipt, send the order number here.');
  }
  if(/(^|[\s،,.؟?])(كم السعر|كم سعر|سعره|السعر|الأسعار|الاسعار|خصم|كوبون|coupon|discount|price|cost)(?=$|[\s،,.؟?!])/i.test(msg)){
    return answer('الأسعار موحدة وواضحة داخل كل منتج. إذا تقصد منتج معين اكتب اسمه، وبالنسبة للكوبون تقدر تضيفه في السلة قبل الدفع.','Prices are shown on each product. Send the product name if you mean a specific item, and coupons can be applied in the cart before checkout.');
  }
  if(/(premium|premier|بريميوم|بريمير|اشتراك)/i.test(msg)){
    return answer('إذا تقصد Premium، فهو اشتراك للمحتوى المشمول خلال مدة الاشتراك. اكتب اسم المنتج إذا حاب تعرف هل هو ضمن Premium أو لا.','Premium gives access to included content during the subscription period. Send the product name if you want to know whether it is included.');
  }
  if(/(تركيب|تثبيت|ما يشتغل|مايشتغل|خطأ|ايرور|error|bug|install|setup|script|سكربت|ملف)/i.test(msg)){
    return answer('تمام. ارسل اسم المنتج ونص الخطأ أو صورة منه، واذكر نوع الكور عندك إذا كانت المشكلة بسكربت FiveM. كذا نقدر نحدد المشكلة أسرع.','Send the product name and the error text or screenshot. If it is a FiveM script, also mention your framework so the issue can be identified faster.');
  }
  if(/(كيف اشتري|طريقة الشراء|ابي اشتري|أبي اشتري|buy|purchase|how.*buy)/i.test(msg)){
    return answer('اختار المنتج، أضفه للسلة، وبعدها كمل للدفع. تسجيل Discord مطلوب وقت الدفع فقط عشان نربط الطلب بحسابك.','Choose the product, add it to the cart, then continue to checkout. Discord login is required at checkout so the order is linked to your account.');
  }
  return answer('وصلتني رسالتك. عطِني تفاصيل أكثر عن اللي تحتاجه أو اسم المنتج، وإذا احتاج الموضوع تدخل بشري يقدر فريق الدعم يستلم المحادثة.','Got it. Send a little more detail or the product name. If needed, the human support team can take over the conversation.');
}

function computeStoreStats(){
  const rows=read(RECEIPT_LOGS,[]);
  const uniqueCustomers=new Set();
  const recentCustomers=new Set();
  let deliveredQty=0;
  const activeWindow=Date.now()-1000*60*60*48;
  for(const o of rows){
    const key=String(o?.discord?.id||o?.email||o?.phone||"").trim();
    if(key)uniqueCustomers.add(key);
    if(String(o?.status||"")==="delivered") deliveredQty+=(Array.isArray(o?.items)?o.items.reduce((a,x)=>a+Number(x.qty||0),0):0);
    const t=Date.parse(String(o?.createdAt||""));
    if(key&&Number.isFinite(t)&&t>=activeWindow) recentCustomers.add(key);
  }
  const totalUsers=uniqueCustomers.size;
  const onlineNow=recentCustomers.size;
  const offlineNow=Math.max(totalUsers-onlineNow,0);
  const totalDownloads=deliveredQty;
  return {totalUsers,onlineNow,offlineNow,totalDownloads};
}

// Apple Pay domain verification file supplied by PayPal.
// Put the exact PayPal file at public/.well-known/apple-developer-merchantid-domain-association
const PAYPAL_APPLE_PAY_DOMAIN_FILE=path.join(PUBLIC,".well-known","apple-developer-merchantid-domain-association");
app.get("/.well-known/apple-developer-merchantid-domain-association",(_req,res)=>{
  if(!fs.existsSync(PAYPAL_APPLE_PAY_DOMAIN_FILE))return res.status(404).type("text/plain").send("Apple Pay domain association file is not installed yet.");
  res.set("Content-Type","application/octet-stream");
  res.set("Cache-Control","public, max-age=300");
  return res.sendFile(PAYPAL_APPLE_PAY_DOMAIN_FILE);
});

app.use("/assets",express.static(path.join(PUBLIC,"assets"),{maxAge:"1d"}));
app.use("/uploads",express.static(UPLOADS,{maxAge:"1d",fallthrough:true}));
app.use("/uploads",serveSupabaseUpload);
["store.css","commerce.css","checkout.css","login.css","admin.css","orders.css","product.css","support-chat.css","store-config.js","shop.js","cart.js","checkout.js","login.js","admin.js","orders.js","product.js","support-chat.js"].forEach(file=>{
  app.get("/"+file,(_req,res)=>res.sendFile(path.join(PUBLIC,file)));
});
app.get("/",(_req,res)=>res.sendFile(path.join(PUBLIC,"index.html")));
app.get("/cart",(_req,res)=>res.sendFile(path.join(PUBLIC,"cart.html")));
app.get("/product/:slug",(_req,res)=>res.sendFile(path.join(PUBLIC,"product.html")));
app.get("/orders",(_req,res)=>res.sendFile(path.join(PUBLIC,"orders.html")));
app.get("/login",(req,res)=>{const next=safeNextPath(req.query.next||"/");if(req.session?.discordUser)return res.redirect(next);res.sendFile(path.join(PUBLIC,"login.html"))});
app.get("/checkout",(req,res)=>{if(!req.session?.discordUser)return res.redirect(`/login?next=${encodeURIComponent('/checkout')}`);res.sendFile(path.join(PUBLIC,"checkout.html"))});
app.get("/payment-success",(_req,res)=>res.sendFile(path.join(PUBLIC,"payment-success.html")));
app.get("/admin",(_req,res)=>res.sendFile(path.join(PUBLIC,"admin.html")));
app.get("/admin.html",(_req,res)=>res.redirect("/admin"));


const DISCORD_CLIENT_ID=process.env.DISCORD_CLIENT_ID||"";
const DISCORD_CLIENT_SECRET=process.env.DISCORD_CLIENT_SECRET||"";
const DISCORD_REDIRECT_URI=process.env.DISCORD_REDIRECT_URI||"";
const DISCORD_BOT_TOKEN=process.env.DISCORD_BOT_TOKEN||"";
const DISCORD_GUILD_ID=process.env.DISCORD_GUILD_ID||"";
const DISCORD_CUSTOMER_ROLE_ID=process.env.DISCORD_CUSTOMER_ROLE_ID||"";

async function discordApi(pathname,opts={}){
  const r=await fetch(`https://discord.com/api/v10${pathname}`,{...opts,headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`,'User-Agent':'ElevenStore/6.4.6',...(opts.headers||{})}});
  const text=await r.text().catch(()=>"");
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  return {r,data,text};
}

async function checkDiscordCustomerRoleConfig(){
  if(!DISCORD_BOT_TOKEN||!DISCORD_GUILD_ID||!DISCORD_CUSTOMER_ROLE_ID)return {ok:false,reason:'Missing Render environment variables'};
  try{
    const roleRes=await discordApi(`/guilds/${encodeURIComponent(DISCORD_GUILD_ID)}/roles`);
    if(!roleRes.r.ok)return {ok:false,status:roleRes.r.status,reason:roleRes.data?.message||roleRes.text||'Could not read guild roles'};
    const role=Array.isArray(roleRes.data)?roleRes.data.find(x=>String(x.id)===String(DISCORD_CUSTOMER_ROLE_ID)):null;
    if(!role)return {ok:false,reason:'Customer role ID was not found in this Discord server'};
    const botRes=await discordApi(`/users/@me`);
    if(!botRes.r.ok)return {ok:false,status:botRes.r.status,reason:botRes.data?.message||'Bot token is invalid'};
    return {ok:true,roleName:role.name||'Customer',botUsername:botRes.data?.username||'Bot'};
  }catch(e){return {ok:false,reason:e?.message||'Discord configuration check failed'}}
}

async function assignDiscordCustomerRole(discordId){
  const userId=String(discordId||"").trim();
  if(!/^\d{10,25}$/.test(userId))return {ok:false,skipped:true,reason:"Invalid Discord user ID"};
  if(!DISCORD_BOT_TOKEN||!DISCORD_GUILD_ID||!DISCORD_CUSTOMER_ROLE_ID){
    console.warn(`[DISCORD CUSTOMER ROLE] skipped for ${userId}: configure DISCORD_BOT_TOKEN, DISCORD_GUILD_ID and DISCORD_CUSTOMER_ROLE_ID in Render Environment`);
    return {ok:false,skipped:true,reason:"Discord role variables are missing in Render Environment"};
  }
  try{
    const memberCheck=await discordApi(`/guilds/${encodeURIComponent(DISCORD_GUILD_ID)}/members/${encodeURIComponent(userId)}`);
    if(!memberCheck.r.ok){
      const reason=memberCheck.r.status===404?'Customer is not a member of the configured Discord server':memberCheck.data?.message||`Discord member check HTTP ${memberCheck.r.status}`;
      console.error(`[DISCORD CUSTOMER ROLE] member check failed | user=${userId} | ${reason}`);
      return {ok:false,status:memberCheck.r.status,reason};
    }
    const add=await discordApi(`/guilds/${encodeURIComponent(DISCORD_GUILD_ID)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(DISCORD_CUSTOMER_ROLE_ID)}`,{method:'PUT'});
    if(add.r.status===204){
      console.log(`[DISCORD CUSTOMER ROLE] assigned | user=${userId} | role=${DISCORD_CUSTOMER_ROLE_ID}`);
      return {ok:true};
    }
    let reason=add.data?.message||add.text||`HTTP ${add.r.status}`;
    if(add.r.status===403)reason='Discord rejected the role: give the bot Manage Roles and move the bot role above the Customer role';
    if(add.r.status===404)reason='Discord guild/member/role was not found. Check Guild ID and Customer Role ID';
    if(add.r.status===401)reason='Discord bot token is invalid or has been reset';
    console.error(`[DISCORD CUSTOMER ROLE] failed | user=${userId} | HTTP ${add.r.status} | ${reason}`);
    return {ok:false,status:add.r.status,reason};
  }catch(e){
    console.error(`[DISCORD CUSTOMER ROLE] error | user=${userId}`,e);
    return {ok:false,reason:e?.message||"Discord request failed"};
  }
}


app.get("/auth/discord",(req,res)=>{
  if(!DISCORD_CLIENT_ID||!DISCORD_REDIRECT_URI)return res.status(503).send("Discord login is not configured.");
  const state=crypto.randomBytes(24).toString("hex");
  req.session.discordOAuthState=state;
  req.session.discordReturnTo=safeNextPath(req.query.next||"/");
  const q=new URLSearchParams({
    client_id:DISCORD_CLIENT_ID,
    redirect_uri:DISCORD_REDIRECT_URI,
    response_type:"code",
    scope:"identify",
    state
  });
  res.redirect(`https://discord.com/oauth2/authorize?${q.toString()}`);
});

app.get("/auth/admin-discord",(req,res)=>{
  if(!DISCORD_CLIENT_ID||!DISCORD_REDIRECT_URI)return res.status(503).send("Discord login is not configured.");
  const state=crypto.randomBytes(24).toString("hex");
  req.session.discordOAuthState=state;
  req.session.discordReturnTo="/admin";
  req.session.adminOAuthIntent=true;
  const q=new URLSearchParams({client_id:DISCORD_CLIENT_ID,redirect_uri:DISCORD_REDIRECT_URI,response_type:"code",scope:"identify",state});
  res.redirect(`https://discord.com/oauth2/authorize?${q.toString()}`);
});

app.get("/auth/discord/callback",async(req,res)=>{
  try{
    if(!req.query.code||!req.query.state||req.query.state!==req.session.discordOAuthState){
      console.error("[DISCORD OAUTH] state mismatch", {
        hasCode:Boolean(req.query.code),
        hasState:Boolean(req.query.state),
        hasSessionState:Boolean(req.session?.discordOAuthState)
      });
      return res.status(400).send("Invalid Discord login state. Please return to checkout and connect Discord again.");
    }
    const body=new URLSearchParams({
      client_id:DISCORD_CLIENT_ID,
      client_secret:DISCORD_CLIENT_SECRET,
      grant_type:"authorization_code",
      code:String(req.query.code),
      redirect_uri:DISCORD_REDIRECT_URI
    });
    const tokenRes=await fetch("https://discord.com/api/oauth2/token",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body
    });
    const token=await tokenRes.json();
    if(!tokenRes.ok||!token.access_token)throw new Error("Discord token exchange failed.");
    const userRes=await fetch("https://discord.com/api/users/@me",{
      headers:{Authorization:`Bearer ${token.access_token}`}
    });
    const user=await userRes.json();
    if(!userRes.ok||!user.id)throw new Error("Could not load Discord profile.");
    req.session.discordUser={
      id:String(user.id),
      username:String(user.username||""),
      globalName:String(user.global_name||""),
      avatar:String(user.avatar||"")
    };
    delete req.session.discordOAuthState;
    const adminIntent=req.session.adminOAuthIntent===true;
    if(adminIntent)registerAdminRequest(req.session.discordUser);
    delete req.session.adminOAuthIntent;
    const returnTo=adminIntent?"/admin":safeNextPath(req.session.discordReturnTo||"/");
    delete req.session.discordReturnTo;
    res.redirect(returnTo);
  }catch(e){
    console.error("[DISCORD OAUTH]",e);
    res.status(500).send("Discord login failed.");
  }
});

app.get("/api/auth/discord",(req,res)=>{
  const u=req.session?.discordUser;
  res.json({connected:Boolean(u),user:u||null,premiumActive:Boolean(u&&hasPremiumAccess(u.id))});
});
app.post("/api/auth/logout",(req,res)=>{delete req.session.discordUser;req.session.save(()=>res.json({ok:true}))});


app.get("/api/notifications",(req,res)=>{
  const rows=read(NOTIFICATIONS,[]);
  const discordId=req.session?.discordUser?.id||"";
  const visible=rows.filter(n=>!n.targetDiscordId||String(n.targetDiscordId)===String(discordId))
    .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  res.json(visible.slice(0,20));
});

app.get("/api/store-stats",(_req,res)=>res.json(computeStoreStats()));
app.get("/api/store-content",(_req,res)=>res.json(storeContent()));

app.get("/api/products/:id/comments",(req,res)=>{
  const entry=getReviewsForProduct(req.params.id),summary=getRatingSummary(req.params.id),u=req.session?.discordUser;
  const mine=u?entry.reviews.find(r=>String(r.discordId||'')===String(u.id)):null;
  res.json({reviews:entry.reviews.map(publicReview),rating:summary,myReview:mine?publicReview(mine):null,connected:Boolean(u),user:u||null});
});
app.post("/api/products/:id/review",requireCustomerApi,(req,res)=>{
  try{
    const productId=Number(req.params.id),rating=Math.round(Number(req.body?.rating||0)),message=String(req.body?.message||'').trim().slice(0,1000),u=req.session.discordUser;
    if(!productId||rating<1||rating>5)return res.status(400).json({message:'Choose a rating from 1 to 5 stars.'});
    const entry=getReviewsForProduct(productId),now=new Date().toISOString(),idx=entry.reviews.findIndex(r=>String(r.discordId||'')===String(u.id));
    const review={id:idx>=0?entry.reviews[idx].id:nextId(entry.reviews),discordId:String(u.id),username:String(u.username||''),displayName:String(u.globalName||u.username||'Discord User'),avatar:String(u.avatar||''),rating,message,createdAt:idx>=0?(entry.reviews[idx].createdAt||now):now,updatedAt:now};
    if(idx>=0)entry.reviews[idx]=review;else entry.reviews.unshift(review);
    saveReviewsForProduct(productId,entry);
    res.json({ok:true,reviews:entry.reviews.map(publicReview),rating:getRatingSummary(productId),myReview:publicReview(review)});
  }catch(e){console.error('Review post error:',e);res.status(500).json({message:'Could not save review.'})}
});
// Legacy endpoints kept for old cached clients; new UI uses Discord-backed reviews.
app.post("/api/products/:id/comments",requireCustomerApi,(req,res)=>res.status(410).json({message:'Use the new review form.'}));
app.post("/api/products/:id/react",requireCustomerApi,(req,res)=>res.status(410).json({message:'Reactions were replaced with star ratings.'}));

app.get("/api/my-orders",(req,res)=>{
  const discordId=req.session?.discordUser?.id;
  if(!discordId)return res.status(401).json({message:"Connect Discord to view your orders."});
  const status=String(req.query.status||"all");
  const rows=read(RECEIPT_LOGS,[]);
  const mine=rows.filter(o=>String(o.discord?.id||"")===String(discordId))
    .filter(o=>status==="all"||o.status===status)
    .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  res.json(mine.map(hydrateOrderItems));
});

app.get("/api/products",(req,res)=>res.json(sorted(products()).filter(p=>p.active!==false).map(p=>publicProduct(req,p))));
app.get("/api/products/slug/:slug",(req,res)=>{
  const p=products().find(x=>String(x.slug||"")===String(req.params.slug||"")&&x.active!==false);
  if(!p)return res.status(404).json({message:"Product not found."});
  res.json(publicProduct(req,p));
});


app.post("/api/coupons/validate",(req,res)=>{
  try{const requestItems=Array.isArray(req.body?.items)?req.body.items:[];const normalized=normalizeCartItems(req,requestItems);const result=applyCouponToCart(normalized,req.body?.code);res.json({ok:true,items:normalized.items,...result});}
  catch(e){res.status(400).json({message:e.message||"Could not apply coupon."})}
});

// Built-in technical support chat
app.get("/api/support/thread/:token",(req,res)=>{
  const token=String(req.params.token||"");
  if(!validSupportToken(token))return res.status(400).json({message:"Invalid support session."});
  const rows=supportChats(),i=rows.findIndex(x=>x.id===token);
  if(i<0)return res.json({thread:null});
  if(Number(rows[i].unreadCustomer||0)>0){rows[i].unreadCustomer=0;saveSupportChats(rows)}
  res.json({thread:publicSupportThread(rows[i])});
});

app.post("/api/support/message",(req,res)=>{
  const token=String(req.body?.token||"");
  const message=String(req.body?.message||"").trim();
  if(!validSupportToken(token))return res.status(400).json({message:"Invalid support session."});
  if(!message)return res.status(400).json({message:"Write a message first."});
  if(message.length>1200)return res.status(400).json({message:"Message is too long."});
  const rows=supportChats();
  let i=rows.findIndex(x=>x.id===token);
  const now=new Date().toISOString();
  if(i<0){
    rows.push({id:token,customer:customerForSupport(req,token),status:"open",aiEnabled:String(process.env.SUPPORT_AI_ENABLED||"true").toLowerCase()!=="false",claimedBy:null,unreadAdmin:0,unreadCustomer:0,createdAt:now,updatedAt:now,messages:[]});
    i=rows.length-1;
  }
  const thread=rows[i];
  thread.customer=customerForSupport(req,token);
  thread.status="open";
  const list=Array.isArray(thread.messages)?thread.messages:[];
  list.push({id:nextId(list),from:"customer",message,createdAt:now});
  const aiReply=(thread.aiEnabled!==false&&!thread.claimedBy)?generateAiSupportReply(message):"";
  if(aiReply){
    list.push({id:nextId(list),from:"ai",message:aiReply,createdAt:new Date(Date.parse(now)+450).toISOString()});
  }
  thread.messages=list.slice(-300);
  thread.unreadAdmin=Number(thread.unreadAdmin||0)+1;
  thread.updatedAt=new Date().toISOString();
  saveSupportChats(rows);
  res.json({ok:true,thread:publicSupportThread(thread)});
});

app.get("/api/admin/support",requireAdmin,(_req,res)=>{
  const rows=supportChats().sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  res.json(rows.map(t=>({id:t.id,customer:t.customer||{},status:t.status||"open",aiEnabled:t.aiEnabled!==false,claimedBy:t.claimedBy||null,unreadAdmin:Number(t.unreadAdmin||0),unreadCustomer:Number(t.unreadCustomer||0),createdAt:t.createdAt,updatedAt:t.updatedAt,lastMessage:(Array.isArray(t.messages)&&t.messages.length?t.messages[t.messages.length-1].message:"")})));
});

app.get("/api/admin/support/:id",requireAdmin,(req,res)=>{
  const rows=supportChats(),i=rows.findIndex(x=>x.id===String(req.params.id||""));
  if(i<0)return res.status(404).json({message:"Conversation not found."});
  if(Number(rows[i].unreadAdmin||0)>0){rows[i].unreadAdmin=0;saveSupportChats(rows)}
  res.json({...publicSupportThread(rows[i]),customer:rows[i].customer||{}});
});

app.post("/api/admin/support/:id/messages",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const message=String(req.body?.message||"").trim();
  if(!message)return res.status(400).json({message:"Write a reply first."});
  if(message.length>1200)return res.status(400).json({message:"Reply is too long."});
  const rows=supportChats(),i=rows.findIndex(x=>x.id===String(req.params.id||""));
  if(i<0)return res.status(404).json({message:"Conversation not found."});
  const now=new Date().toISOString(),thread=rows[i],list=Array.isArray(thread.messages)?thread.messages:[];
  thread.claimedBy=thread.claimedBy||adminActor(req);thread.aiEnabled=false;
  list.push({id:nextId(list),from:"support",message,createdAt:now});
  thread.messages=list.slice(-300);thread.status="open";thread.unreadAdmin=0;thread.unreadCustomer=Number(thread.unreadCustomer||0)+1;thread.updatedAt=now;
  saveSupportChats(rows);
  res.json({ok:true,thread:{...publicSupportThread(thread),customer:thread.customer||{}}});
});

app.patch("/api/admin/support/:id/status",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const status=String(req.body?.status||"");
  if(!["open","closed"].includes(status))return res.status(400).json({message:"Invalid conversation status."});
  const rows=supportChats(),i=rows.findIndex(x=>x.id===String(req.params.id||""));
  if(i<0)return res.status(404).json({message:"Conversation not found."});
  rows[i].status=status;rows[i].updatedAt=new Date().toISOString();saveSupportChats(rows);
  res.json({ok:true,status});
});

app.patch("/api/admin/support/:id/control",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const rows=supportChats(),i=rows.findIndex(x=>x.id===String(req.params.id||""));
  if(i<0)return res.status(404).json({message:"Conversation not found."});
  const thread=rows[i],action=String(req.body?.action||"");
  if(action==="claim"){thread.claimedBy=adminActor(req);thread.aiEnabled=false;thread.status="open";}
  else if(action==="release"){thread.claimedBy=null;}
  else if(action==="ai"){thread.aiEnabled=Boolean(req.body?.enabled);if(thread.aiEnabled)thread.claimedBy=null;}
  else return res.status(400).json({message:"Invalid support control action."});
  thread.updatedAt=new Date().toISOString();saveSupportChats(rows);
  res.json({ok:true,thread:{...publicSupportThread(thread),customer:thread.customer||{}}});
});


app.get("/api/admin/store-content",requireAdmin,(_req,res)=>res.json(storeContent()));
app.post("/api/admin/store-content",requireAdmin,requireAdminEdit,requireCsrf,upload.fields([{name:"mainImage",maxCount:1},{name:"fastImage",maxCount:1},{name:"smartImage",maxCount:1}]),async(req,res)=>{
  try{
    const current=storeContent();
    const result={...current};
    for(const key of ["main","fast","smart"]){
      const cap=key.charAt(0).toUpperCase()+key.slice(1);
      result[key]={
        badge:String(req.body?.[key+"Badge"]??current[key]?.badge??"").trim().slice(0,40),
        title:String(req.body?.[key+"Title"]??current[key]?.title??"").trim().slice(0,100),
        description:String(req.body?.[key+"Description"]??current[key]?.description??"").trim().slice(0,260),
        image:String(current[key]?.image||"")
      };
      const file=req.files?.[key+"Image"]?.[0];
      if(file){await persistDiskUpload(file);result[key].image=`/uploads/${file.filename}`;}
      if(String(req.body?.[key+"RemoveImage"]||"")==="1") result[key].image="";
    }
    saveStoreContent(result);res.json({ok:true,content:result});
  }catch(e){console.error("[STORE CONTENT]",e);res.status(500).json({message:"Could not save homepage cards."})}
});

app.get("/api/admin/session",(req,res)=>{
  if(!isAdmin(req)&&req.session?.discordUser){const row=adminAccessFor(req.session.discordUser.id);if(row?.status==="approved"){req.session.isAdmin=true;req.session.adminRole="staff";req.session.adminDiscordId=String(row.discordId)}}
  const authenticated=isAdmin(req),row=authenticated&&!isOwner(req)?currentStaffAccess(req):null;
  res.json({authenticated,role:isOwner(req)?"owner":authenticated?"staff":"none",canEdit:authenticated?canEditAdmin(req):false,csrfToken:authenticated?ensureCsrf(req):null,adminUser:row?{discordId:row.discordId,username:row.username,globalName:row.globalName}:null,discordConnected:Boolean(req.session?.discordUser),accessStatus:req.session?.discordUser?adminAccessFor(req.session.discordUser.id)?.status||"none":"none"});
});
app.get("/api/admin/access-status",(req,res)=>{
  const u=req.session?.discordUser;if(!u)return res.json({connected:false,status:"none",authenticated:false});
  const row=adminAccessFor(u.id);if(row?.status==="approved"){req.session.isAdmin=true;req.session.adminRole="staff";req.session.adminDiscordId=String(row.discordId);return res.json({connected:true,status:"approved",authenticated:true,canEdit:Boolean(row.canEdit),csrfToken:ensureCsrf(req),user:u})}
  res.json({connected:true,status:row?.status||"none",authenticated:false,canEdit:false,user:u});
});
app.post("/api/admin/login",authLimiter,(req,res)=>{
  const expected=String(process.env.ADMIN_PASSWORD||""),supplied=String(req.body?.password||"");
  if(!expected||expected==="CHANGE_THIS_TO_A_LONG_RANDOM_PASSWORD")return res.status(503).json({message:"Set ADMIN_PASSWORD in .env first."});
  const a=Buffer.from(expected),b=Buffer.from(supplied);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({message:"Incorrect password."});
  req.session.regenerate(err=>{if(err)return res.status(500).json({message:"Session error"});req.session.isAdmin=true;req.session.adminRole="owner";const csrfToken=ensureCsrf(req);res.json({ok:true,csrfToken,role:"owner",canEdit:true})});
});
app.post("/api/admin/logout",requireAdmin,requireCsrf,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/admin-access",requireAdmin,requireOwner,(_req,res)=>res.json(adminAccessRows().sort((a,b)=>String(b.lastLoginAt||b.requestedAt||"").localeCompare(String(a.lastLoginAt||a.requestedAt||"")))));
app.patch("/api/admin/admin-access/:discordId",requireAdmin,requireOwner,requireCsrf,(req,res)=>{
  const id=String(req.params.discordId||"");const rows=adminAccessRows(),i=rows.findIndex(x=>String(x.discordId||"")===id);if(i<0)return res.status(404).json({message:"Admin request not found."});
  if(req.body?.status!==undefined){const status=String(req.body.status);if(!["pending","approved","denied"].includes(status))return res.status(400).json({message:"Invalid access status."});rows[i].status=status}
  if(req.body?.canEdit!==undefined)rows[i].canEdit=req.body.canEdit===true;rows[i].updatedAt=new Date().toISOString();saveAdminAccessRows(rows);res.json(rows[i]);
});
app.get("/api/admin/products",requireAdmin,(_req,res)=>res.json(sorted(products())));


app.get("/api/admin/reviews",requireAdmin,(_req,res)=>{
  const ps=products(),all=commentStore(),out=[];
  for(const p of ps){
    const entry=getReviewsForProduct(p.id);
    for(const r of entry.reviews)out.push({...publicReview(r),productId:p.id,productName:p.name});
  }
  out.sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
  res.json(out);
});
app.delete("/api/admin/products/:productId/reviews/:reviewId",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const productId=Number(req.params.productId),reviewId=String(req.params.reviewId||"");
  const entry=getReviewsForProduct(productId),before=entry.reviews.length;
  entry.reviews=entry.reviews.filter(r=>String(r.id)!==reviewId);
  if(entry.reviews.length===before)return res.status(404).json({message:"Review not found."});
  saveReviewsForProduct(productId,entry);res.json({ok:true,rating:getRatingSummary(productId)});
});

app.post("/api/admin/products",requireAdmin,requireAdminEdit,requireCsrf,upload.fields([{name:"image",maxCount:1},{name:"previewImages",maxCount:12}]),async(req,res)=>{
  const rows=products(),name=String(req.body.name||"").trim(),slug=cleanSlug(req.body.slug||name),price=Number(req.body.price||0);
  if(!name||!slug)return res.status(400).json({message:"Name and slug are required."});
  if(!Number.isFinite(price)||price<0)return res.status(400).json({message:"Invalid price."});
  if(rows.some(p=>p.slug===slug))return res.status(409).json({message:"Slug already exists."});
  const productType=String(req.body.productType||"standard");
  let servicePricing={};
  if(productType==="programming_service"){
    try{servicePricing=JSON.parse(String(req.body.servicePricing||"{}"))}catch{}
  }
  try{
    const imageFile=req.files?.image?.[0]||null;
    const previewFiles=req.files?.previewImages||[];
    if(imageFile)await persistDiskUpload(imageFile);
    for(const f of previewFiles)await persistDiskUpload(f);
    const row={id:nextId(rows),slug,name,tag:String(req.body.tag||"ELEVEN").trim().slice(0,30),description:String(req.body.description||"").trim(),price,image:imageFile?`/uploads/${imageFile.filename}`:"",previewImages:previewFiles.map(f=>`/uploads/${f.filename}`),active:String(req.body.active||"1")==="1",sortOrder:Number(req.body.sortOrder||0),productType,servicePricing};
    rows.push(row);saveProducts(rows);res.json(row)
  }catch(e){console.error("[PRODUCT CREATE]",e);res.status(500).json({message:"Could not persist product image/data."})}
});
app.put("/api/admin/products/:id",requireAdmin,requireAdminEdit,requireCsrf,upload.fields([{name:"image",maxCount:1},{name:"previewImages",maxCount:12}]),async(req,res)=>{
  const rows=products(),id=Number(req.params.id),i=rows.findIndex(p=>Number(p.id)===id);if(i<0)return res.status(404).json({message:"Product not found."});
  const old=rows[i],name=String(req.body.name||old.name).trim(),slug=cleanSlug(req.body.slug||old.slug),price=Number(req.body.price??old.price);
  if(rows.some(p=>Number(p.id)!==id&&p.slug===slug))return res.status(409).json({message:"Slug already exists."});
  const productType=String(req.body.productType??old.productType??"standard");
  let servicePricing=old.servicePricing||{};
  if(productType==="programming_service" && req.body.servicePricing!==undefined){
    try{servicePricing=JSON.parse(String(req.body.servicePricing||"{}"))}catch{}
  }
  let previewImages=Array.isArray(old.previewImages)?old.previewImages:[];
  let removePreviews=[];
  try{removePreviews=JSON.parse(String(req.body.removePreviews||"[]"))}catch{}
  if(Array.isArray(removePreviews)&&removePreviews.length){
    previewImages=previewImages.filter(url=>!removePreviews.includes(url));
  }
  try{
    const imageFile=req.files?.image?.[0]||null;
    const previewFiles=req.files?.previewImages||[];
    if(imageFile)await persistDiskUpload(imageFile);
    for(const f of previewFiles)await persistDiskUpload(f);
    const newPreviewUrls=previewFiles.map(f=>`/uploads/${f.filename}`);
    previewImages=[...previewImages,...newPreviewUrls].slice(0,12);

    rows[i]={...old,name,slug,tag:String(req.body.tag??old.tag).trim().slice(0,30),description:String(req.body.description??old.description).trim(),price,image:imageFile?`/uploads/${imageFile.filename}`:old.image,previewImages,active:String(req.body.active??(old.active?"1":"0"))==="1",sortOrder:Number(req.body.sortOrder??old.sortOrder??0),productType,servicePricing};
    saveProducts(rows);res.json(rows[i])
  }catch(e){console.error("[PRODUCT UPDATE]",e);res.status(500).json({message:"Could not persist product image/data."})}
});

app.patch("/api/admin/products/:id/visibility",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const rows=products();
  const id=Number(req.params.id);
  const i=rows.findIndex(p=>Number(p.id)===id);
  if(i<0)return res.status(404).json({message:"Product not found."});
  rows[i]={...rows[i],active:req.body?.active===true};
  saveProducts(rows);
  res.json(rows[i]);
});

app.delete("/api/admin/products/:id",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const rows=products(),id=Number(req.params.id),i=rows.findIndex(p=>Number(p.id)===id);if(i<0)return res.status(404).json({message:"Product not found."});
  rows.splice(i,1);saveProducts(rows);res.json({ok:true})
});

app.get("/api/admin/receipt-logs",requireAdmin,(_req,res)=>{const rows=read(RECEIPT_LOGS,[]);res.json([...rows].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).map(hydrateOrderItems))});


app.get("/api/admin/orders",requireAdmin,(req,res)=>{
  const status=String(req.query.status||"processing");
  const rows=read(RECEIPT_LOGS,[]);
  res.json(rows.filter(x=>status==="all"||x.status===status).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).map(hydrateOrderItems));
});

app.patch("/api/admin/orders/:id/status",requireAdmin,requireAdminEdit,requireCsrf,async(req,res)=>{
  const allowed=["processing","delivered"];
  const status=String(req.body?.status||"");
  if(!allowed.includes(status))return res.status(400).json({message:"Invalid order status."});
  const rows=read(RECEIPT_LOGS,[]);
  const id=Number(req.params.id),i=rows.findIndex(x=>Number(x.id)===id);
  if(i<0)return res.status(404).json({message:"Order not found."});
  rows[i].status=status;
  rows[i].deliveredAt=status==="delivered"?new Date().toISOString():null;
  write(RECEIPT_LOGS,rows);
  if(status==="delivered"&&rows[i]?.discord?.id){
    const ps=products();
    const containsPremium=(rows[i].items||[]).some(it=>{const p=ps.find(pp=>Number(pp.id)===Number(it.productId));return (p&&isPremiumSubscriptionProduct(p))||/premium/i.test(String(it?.name||''))});
    if(containsPremium)setPremiumControl(rows[i].discord.id,true);
    const roleResult=await assignDiscordCustomerRole(rows[i].discord.id);
    rows[i].customerRoleAssigned=roleResult.ok===true;
    rows[i].customerRoleUpdatedAt=new Date().toISOString();
    if(!roleResult.ok)rows[i].customerRoleError=String(roleResult.reason||`HTTP ${roleResult.status||'error'}`).slice(0,300);
    else delete rows[i].customerRoleError;
    write(RECEIPT_LOGS,rows);
  }
  console.log(`[ORDER STATUS] ${rows[i].orderNumber} => ${status}`);
  res.json(rows[i]);
});


app.post("/api/admin/orders/:id/customer-role",requireAdmin,requireAdminEdit,requireCsrf,async(req,res)=>{
  const rows=read(RECEIPT_LOGS,[]),id=Number(req.params.id),i=rows.findIndex(x=>Number(x.id)===id);
  if(i<0)return res.status(404).json({message:'Order not found.'});
  const discordId=rows[i]?.discord?.id;
  if(!discordId)return res.status(400).json({message:'This order has no linked Discord account.'});
  const result=await assignDiscordCustomerRole(discordId);
  rows[i].customerRoleAssigned=result.ok===true;
  rows[i].customerRoleUpdatedAt=new Date().toISOString();
  if(result.ok)delete rows[i].customerRoleError;else rows[i].customerRoleError=String(result.reason||`HTTP ${result.status||'error'}`).slice(0,300);
  write(RECEIPT_LOGS,rows);
  res.json({...rows[i],discordRoleResult:result});
});

app.get("/api/admin/discord-role-status",requireAdmin,async(_req,res)=>res.json(await checkDiscordCustomerRoleConfig()));

app.get("/api/admin/premium-members",requireAdmin,(_req,res)=>res.json(premiumMembers()));
app.patch("/api/admin/premium-members/:discordId",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const discordId=String(req.params.discordId||"").trim();
  if(!/^\d{10,25}$/.test(discordId))return res.status(400).json({message:"Invalid Discord ID."});
  const members=premiumMembers();
  if(!members.some(x=>x.discordId===discordId))return res.status(404).json({message:"Premium member not found."});
  const active=req.body?.active===true;
  setPremiumControl(discordId,active);
  console.log(`[PREMIUM ACCESS] ${discordId} => ${active?'ACTIVE':'REVOKED'}`);
  res.json({ok:true,discordId,active});
});

app.get("/api/admin/coupons",requireAdmin,(_req,res)=>res.json(couponRows().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))));
app.post("/api/admin/coupons",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const rows=couponRows(),code=cleanCouponCode(req.body?.code),type=String(req.body?.type||"percent"),value=Number(req.body?.value||0),active=req.body?.active!==false;
  const productIds=Array.isArray(req.body?.productIds)?req.body.productIds.map(Number).filter(Number.isFinite):[];
  if(!code)return res.status(400).json({message:"Coupon code is required."});if(rows.some(x=>cleanCouponCode(x.code)===code))return res.status(409).json({message:"Coupon code already exists."});
  if(!["percent","fixed"].includes(type)||!Number.isFinite(value)||value<=0||(type==="percent"&&value>100))return res.status(400).json({message:"Invalid coupon discount."});
  const validIds=new Set(products().map(p=>Number(p.id)));if(productIds.some(id=>!validIds.has(id)))return res.status(400).json({message:"One or more selected products do not exist."});
  const row={id:nextId(rows),code,type,value,productIds:[...new Set(productIds)],active,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};rows.push(row);saveCouponRows(rows);res.json(row);
});
app.put("/api/admin/coupons/:id",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const rows=couponRows(),id=Number(req.params.id),i=rows.findIndex(x=>Number(x.id)===id);if(i<0)return res.status(404).json({message:"Coupon not found."});
  const code=cleanCouponCode(req.body?.code??rows[i].code),type=String(req.body?.type??rows[i].type),value=Number(req.body?.value??rows[i].value),active=req.body?.active!==false;
  const productIds=Array.isArray(req.body?.productIds)?req.body.productIds.map(Number).filter(Number.isFinite):(rows[i].productIds||[]);
  if(!code||rows.some(x=>Number(x.id)!==id&&cleanCouponCode(x.code)===code))return res.status(409).json({message:"Coupon code is invalid or already exists."});
  if(!["percent","fixed"].includes(type)||!Number.isFinite(value)||value<=0||(type==="percent"&&value>100))return res.status(400).json({message:"Invalid coupon discount."});
  rows[i]={...rows[i],code,type,value,productIds:[...new Set(productIds)],active,updatedAt:new Date().toISOString()};saveCouponRows(rows);res.json(rows[i]);
});
app.delete("/api/admin/coupons/:id",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{const rows=couponRows(),id=Number(req.params.id),i=rows.findIndex(x=>Number(x.id)===id);if(i<0)return res.status(404).json({message:"Coupon not found."});rows.splice(i,1);saveCouponRows(rows);res.json({ok:true})});

app.get("/api/admin/notifications",requireAdmin,(_req,res)=>{
  const rows=read(NOTIFICATIONS,[]);
  res.json([...rows].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))));
});

app.post("/api/admin/notifications",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
  const message=String(req.body?.message||"").trim();
  const targetDiscordId=String(req.body?.targetDiscordId||"").trim();
  if(!message)return res.status(400).json({message:"Notification message is required."});
  if(message.length>500)return res.status(400).json({message:"Notification is too long."});
  const rows=read(NOTIFICATIONS,[]);
  const entry={id:nextId(rows),message,targetDiscordId:targetDiscordId||"",createdAt:new Date().toISOString()};
  rows.push(entry);write(NOTIFICATIONS,rows);
  console.log(`[MEMBER NOTIFICATION] ${targetDiscordId||"ALL"} | ${message}`);
  res.json(entry);
});

const MPK=process.env.GEIDEA_MERCHANT_PUBLIC_KEY||"",APIP=process.env.GEIDEA_API_PASSWORD||"",BASE=(process.env.BASE_URL||"").replace(/\/$/,""),GEIDEA="https://api.ksamerchant.geidea.net/payment-intent/api/v2/direct/session";
function ts(){const d=new Date(),p=n=>String(n).padStart(2,"0");return `${d.getUTCFullYear()}/${p(d.getUTCMonth()+1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`}
function sig(amount,currency,ref,timestamp){return crypto.createHmac("sha256",APIP).update(`${MPK}${Number(amount).toFixed(2)}${currency}${ref}${timestamp}`).digest("base64")}
async function geidea(amount,ref,orderItems){const timestamp=ts(),body={amount:Number(amount),currency:"SAR",timestamp,merchantReferenceId:ref,signature:sig(amount,"SAR",ref,timestamp),paymentOperation:"Pay",language:"en",callbackUrl:`${BASE}/api/payment/callback`,returnUrl:`${BASE}/payment-success`,expressCheckouts:[{wallet:"apple-pay",label:"Apple Pay"}],order:{orderItems}},auth=Buffer.from(`${MPK}:${APIP}`).toString("base64");const r=await fetch(GEIDEA,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json","Authorization":`Basic ${auth}`},body:JSON.stringify(body)});return {r,d:await r.json().catch(()=>({}))}}


// -----------------------------------------------------------------------------
// PayPal Checkout (Orders v2)
// Store prices remain in SAR. PayPal REST does not support SAR as a transaction
// currency, so the amount is converted server-side to PAYPAL_CURRENCY (USD by
// default). PAYPAL_SAR_PER_UNIT means how many SAR equal 1 PayPal currency unit.
// For USD, the default is 3.75 SAR per USD.
// -----------------------------------------------------------------------------
const PAYPAL_CLIENT_ID=String(process.env.PAYPAL_CLIENT_ID||"").trim();
const PAYPAL_CLIENT_SECRET=String(process.env.PAYPAL_CLIENT_SECRET||"").trim();
const PAYPAL_MODE=String(process.env.PAYPAL_MODE||"sandbox").trim().toLowerCase()==="live"?"live":"sandbox";
const PAYPAL_CURRENCY=String(process.env.PAYPAL_CURRENCY||"USD").trim().toUpperCase();
const PAYPAL_SAR_PER_UNIT=Number(process.env.PAYPAL_SAR_PER_UNIT||3.75);
const PAYPAL_ALLOWED_CURRENCIES=new Set(["AUD","BRL","CAD","CNY","CZK","DKK","EUR","HKD","HUF","ILS","JPY","MYR","MXN","TWD","NZD","NOK","PHP","PLN","GBP","RUB","SGD","SEK","CHF","THB","USD"]);
const PAYPAL_API_BASE=PAYPAL_MODE==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
let paypalTokenCache={token:"",expiresAt:0};

function paypalConfigured(){return Boolean(PAYPAL_CLIENT_ID&&PAYPAL_CLIENT_SECRET&&PAYPAL_ALLOWED_CURRENCIES.has(PAYPAL_CURRENCY)&&Number.isFinite(PAYPAL_SAR_PER_UNIT)&&PAYPAL_SAR_PER_UNIT>0)}
function paypalAmountFromSar(amountSar){
  const amount=Number(amountSar||0)/PAYPAL_SAR_PER_UNIT;
  if(!Number.isFinite(amount)||amount<=0)throw new Error("Invalid PayPal amount.");
  return amount.toFixed(PAYPAL_CURRENCY==="JPY"?0:2);
}
function requestBaseUrl(req){return BASE||`${req.protocol}://${req.get("host")}`}
function sameMoney(a,b){return Math.abs(Number(a)-Number(b))<0.005}
function paypalRequestId(prefix,value){
  const hash=crypto.createHash("sha1").update(String(value||crypto.randomUUID())).digest("hex").slice(0,12);
  return `${prefix}-${hash}`.slice(0,25);
}
async function paypalAccessToken(){
  if(!paypalConfigured())throw new Error("PayPal is not configured.");
  if(paypalTokenCache.token&&Date.now()<paypalTokenCache.expiresAt-60000)return paypalTokenCache.token;
  const auth=Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r=await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`,{
    method:"POST",
    headers:{Authorization:`Basic ${auth}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
    body:"grant_type=client_credentials"
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token)throw new Error(d.error_description||d.error||`PayPal authentication failed (${r.status}).`);
  paypalTokenCache={token:d.access_token,expiresAt:Date.now()+Math.max(60,Number(d.expires_in||300))*1000};
  return paypalTokenCache.token;
}
async function paypalApi(method,endpoint,{body,requestId}={}){
  const token=await paypalAccessToken();
  const headers={Authorization:`Bearer ${token}`,Accept:"application/json","Content-Type":"application/json","Prefer":"return=representation"};
  if(requestId)headers["PayPal-Request-Id"]=requestId;
  const r=await fetch(`${PAYPAL_API_BASE}${endpoint}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  return {r,d};
}
function validateCheckoutContact(body){
  const email=String(body?.email||"").trim().toLowerCase();
  const phone=String(body?.phone||"").replace(/[\s()\-]/g,"");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))throw new Error("Enter a valid email address.");
  if(!/^\+[1-9]\d{6,14}$/.test(phone))throw new Error("Enter a valid international phone number.");
  return {email,phone};
}
function findPayPalPending(orderID,discordId){
  const rows=orders();
  const i=rows.findIndex(x=>String(x.provider||"")==="paypal"&&String(x.paypalOrderId||"")===String(orderID||"")&&String(x?.discord?.id||"")===String(discordId||""));
  return {rows,i,row:i>=0?rows[i]:null};
}
async function applyDeliveredBenefits(entry,logs,index){
  if(!entry?.discord?.id)return entry;
  const ps=products();
  const containsPremium=(entry.items||[]).some(it=>{const p=ps.find(pp=>Number(pp.id)===Number(it.productId));return (p&&isPremiumSubscriptionProduct(p))||/premium/i.test(String(it?.name||""))});
  if(containsPremium)setPremiumControl(entry.discord.id,true);
  const roleResult=await assignDiscordCustomerRole(entry.discord.id);
  entry.customerRoleAssigned=roleResult.ok===true;
  entry.customerRoleUpdatedAt=new Date().toISOString();
  if(!roleResult.ok)entry.customerRoleError=String(roleResult.reason||`HTTP ${roleResult.status||"error"}`).slice(0,300);else delete entry.customerRoleError;
  if(Array.isArray(logs)&&Number.isInteger(index)&&index>=0){logs[index]=entry;write(RECEIPT_LOGS,logs)}
  return entry;
}

app.get("/api/paypal/config",(_req,res)=>{
  res.json({
    enabled:paypalConfigured(),
    clientId:paypalConfigured()?PAYPAL_CLIENT_ID:"",
    mode:PAYPAL_MODE,
    currency:PAYPAL_CURRENCY,
    sarPerUnit:PAYPAL_SAR_PER_UNIT,
    applePayIntegration:true,
    applePayDomainFileInstalled:fs.existsSync(PAYPAL_APPLE_PAY_DOMAIN_FILE)
  });
});

app.post("/api/checkout/paypal/create-order",requireCustomerApi,async(req,res)=>{
  try{
    if(!paypalConfigured())return res.status(503).json({message:"PayPal is not configured yet."});
    const {email,phone}=validateCheckoutContact(req.body);
    const requestItems=Array.isArray(req.body?.items)?req.body.items:[];
    if(!requestItems.length)return res.status(400).json({message:"Cart is empty."});
    const normalizedResult=normalizeCartItems(req,requestItems);
    const priced=applyCouponToCart(normalizedResult,req.body?.couponCode);
    const totalSar=Number(priced.total||0);
    if(totalSar<=0)return res.status(400).json({message:"This order is free. Use the free order checkout."});
    const paypalAmount=paypalAmountFromSar(totalSar);
    const ref=crypto.randomUUID();
    const base=requestBaseUrl(req);
    const description=(normalizedResult.items||[]).map(x=>x.name).join(", ").slice(0,120)||"Eleven Store order";
    const body={
      intent:"CAPTURE",
      purchase_units:[{
        reference_id:ref,
        custom_id:ref,
        description,
        amount:{currency_code:PAYPAL_CURRENCY,value:paypalAmount}
      }],
      payment_source:{paypal:{experience_context:{
        brand_name:"Eleven Store",
        shipping_preference:"NO_SHIPPING",
        user_action:"PAY_NOW",
        return_url:`${base}/payment-success`,
        cancel_url:`${base}/checkout`
      }}}
    };
    const {r,d}=await paypalApi("POST","/v2/checkout/orders",{body,requestId:paypalRequestId("create",ref)});
    if(!r.ok||!d.id)return res.status(502).json({message:d?.details?.[0]?.description||d?.message||`PayPal could not create the order (${r.status}).`});

    const rows=orders();
    const entry={
      id:nextId(rows),reference:ref,provider:"paypal",paypalOrderId:String(d.id),status:"paypal_created",
      amount:Number(totalSar.toFixed(2)),currency:"SAR",paypalAmount:Number(paypalAmount),paypalCurrency:PAYPAL_CURRENCY,
      subtotal:priced.subtotal,discount:priced.discount,coupon:priced.coupon,items:normalizedResult.items,
      email,phone,discord:req.session.discordUser,createdAt:new Date().toISOString()
    };
    rows.push(entry);saveOrders(rows);
    console.log(`[PAYPAL CREATED] ${entry.paypalOrderId} | @${entry.discord.username} (${entry.discord.id}) | SAR ${entry.amount} => ${entry.paypalCurrency} ${paypalAmount}`);
    return res.json({id:d.id,amount:paypalAmount,currency:PAYPAL_CURRENCY,sarAmount:entry.amount});
  }catch(e){
    console.error("[PAYPAL CREATE]",e&&e.stack?e.stack:e);
    return res.status(400).json({message:e.message||"Unable to create PayPal order."});
  }
});

app.post("/api/checkout/paypal/applepay/create-order",requireCustomerApi,async(req,res)=>{
  try{
    if(!paypalConfigured())return res.status(503).json({message:"PayPal is not configured yet."});
    const {email,phone}=validateCheckoutContact(req.body);
    const requestItems=Array.isArray(req.body?.items)?req.body.items:[];
    if(!requestItems.length)return res.status(400).json({message:"Cart is empty."});
    const normalizedResult=normalizeCartItems(req,requestItems);
    const priced=applyCouponToCart(normalizedResult,req.body?.couponCode);
    const totalSar=Number(priced.total||0);
    if(totalSar<=0)return res.status(400).json({message:"This order is free. Use the free order checkout."});
    const paypalAmount=paypalAmountFromSar(totalSar);
    const ref=crypto.randomUUID();
    const description=(normalizedResult.items||[]).map(x=>x.name).join(", ").slice(0,120)||"Eleven Store order";
    // Do not pre-bind the order to the PayPal wallet. paypal.Applepay().confirmOrder()
    // supplies the Apple Pay token after the buyer authorizes the Apple payment sheet.
    const body={
      intent:"CAPTURE",
      purchase_units:[{
        reference_id:ref,
        custom_id:ref,
        description,
        amount:{currency_code:PAYPAL_CURRENCY,value:paypalAmount}
      }]
    };
    const {r,d}=await paypalApi("POST","/v2/checkout/orders",{body,requestId:paypalRequestId("applepay",ref)});
    if(!r.ok||!d.id)return res.status(502).json({message:d?.details?.[0]?.description||d?.message||`PayPal could not create the Apple Pay order (${r.status}).`});

    const rows=orders();
    const entry={
      id:nextId(rows),reference:ref,provider:"paypal",paymentMethod:"applepay",paypalOrderId:String(d.id),status:"paypal_applepay_created",
      amount:Number(totalSar.toFixed(2)),currency:"SAR",paypalAmount:Number(paypalAmount),paypalCurrency:PAYPAL_CURRENCY,
      subtotal:priced.subtotal,discount:priced.discount,coupon:priced.coupon,items:normalizedResult.items,
      email,phone,discord:req.session.discordUser,createdAt:new Date().toISOString()
    };
    rows.push(entry);saveOrders(rows);
    console.log(`[PAYPAL APPLE PAY CREATED] ${entry.paypalOrderId} | @${entry.discord.username} (${entry.discord.id}) | SAR ${entry.amount} => ${entry.paypalCurrency} ${paypalAmount}`);
    return res.json({id:d.id,amount:paypalAmount,currency:PAYPAL_CURRENCY,sarAmount:entry.amount});
  }catch(e){
    console.error("[PAYPAL APPLE PAY CREATE]",e&&e.stack?e.stack:e);
    return res.status(400).json({message:e.message||"Unable to create Apple Pay order."});
  }
});

app.post("/api/checkout/paypal/capture-order",requireCustomerApi,async(req,res)=>{
  try{
    if(!paypalConfigured())return res.status(503).json({message:"PayPal is not configured yet."});
    const orderID=String(req.body?.orderID||"").trim();
    if(!/^[A-Z0-9]+$/i.test(orderID))return res.status(400).json({message:"Invalid PayPal order ID."});
    const found=findPayPalPending(orderID,req.session.discordUser.id);
    if(!found.row)return res.status(404).json({message:"PayPal order was not found for this account."});

    // Idempotent retry: if we already finalized this payment, return the saved store order.
    if(found.row.status==="paypal_captured"){
      const existing=read(RECEIPT_LOGS,[]).find(x=>String(x.paypalOrderId||"")===orderID&&String(x?.discord?.id||"")===String(req.session.discordUser.id));
      if(existing)return res.json({ok:true,orderNumber:existing.orderNumber,status:existing.status,paypalOrderId:orderID,paypalCaptureId:existing.paypalCaptureId||""});
    }

    // Verify the approved PayPal order amount BEFORE capture.
    const details=await paypalApi("GET",`/v2/checkout/orders/${encodeURIComponent(orderID)}`);
    if(!details.r.ok)return res.status(502).json({message:details.d?.message||"Could not verify the PayPal order."});
    const pu=details.d?.purchase_units?.[0]||{};
    const remoteAmount=pu?.amount?.value,remoteCurrency=pu?.amount?.currency_code;
    if(String(remoteCurrency||"")!==found.row.paypalCurrency||!sameMoney(remoteAmount,found.row.paypalAmount)||String(pu.custom_id||"")!==String(found.row.reference||"")){
      console.error(`[PAYPAL VERIFY] amount/reference mismatch for ${orderID}`);
      return res.status(409).json({message:"PayPal order verification failed. Payment was not captured."});
    }

    const capture=await paypalApi("POST",`/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,{requestId:paypalRequestId("capture",found.row.reference)});
    if(!capture.r.ok||capture.d?.status!=="COMPLETED")return res.status(502).json({message:capture.d?.details?.[0]?.description||capture.d?.message||"PayPal payment could not be captured."});
    const cap=capture.d?.purchase_units?.[0]?.payments?.captures?.[0]||{};
    if(String(cap?.amount?.currency_code||"")!==found.row.paypalCurrency||!sameMoney(cap?.amount?.value,found.row.paypalAmount)){
      console.error(`[PAYPAL CAPTURE] captured amount mismatch for ${orderID}`);
      return res.status(409).json({message:"Payment was captured, but the amount did not match the store order. Contact support with your PayPal order ID."});
    }

    const logs=read(RECEIPT_LOGS,[]);
    let logIndex=logs.findIndex(x=>String(x.paypalOrderId||"")===orderID);
    let entry;
    if(logIndex>=0){
      entry=logs[logIndex];
    }else{
      const id=nextId(logs),orderNumber=`ES-${String(id).padStart(5,"0")}`;
      entry={
        id,orderNumber,email:found.row.email,phone:found.row.phone,discord:found.row.discord,
        subtotal:found.row.subtotal,discount:found.row.discount,coupon:found.row.coupon,
        amount:found.row.amount,currency:"SAR",items:found.row.items,
        receiptUrl:"",receiptFilename:"",paymentMethod:found.row.paymentMethod==="applepay"?"applepay":"paypal",paymentProvider:found.row.paymentMethod==="applepay"?"Apple Pay via PayPal":"PayPal",
        paypalOrderId:orderID,paypalCaptureId:String(cap.id||""),paypalAmount:Number(found.row.paypalAmount),paypalCurrency:found.row.paypalCurrency,
        payerEmail:String(capture.d?.payer?.email_address||""),status:"processing",createdAt:new Date().toISOString(),deliveredAt:null
      };
      logs.push(entry);logIndex=logs.length-1;write(RECEIPT_LOGS,logs);
    }

    // PayPal confirms that the money was captured, but fulfillment stays manual.
    // The order remains in Processing until an admin clicks Mark Delivered.
    if(entry.status!=="delivered"){
      entry.status="processing";
      entry.deliveredAt=null;
      logs[logIndex]=entry;
      write(RECEIPT_LOGS,logs);
    }

    found.rows[found.i]={...found.row,status:"paypal_captured",capturedAt:new Date().toISOString(),paypalCaptureId:String(cap.id||""),receiptLogId:entry.id};
    saveOrders(found.rows);
    console.log(`[PAYPAL CAPTURED] ${entry.orderNumber} | PayPal ${orderID} | ${entry.paypalCurrency} ${entry.paypalAmount} | SAR ${entry.amount} | fulfillment=processing`);
    return res.json({ok:true,orderNumber:entry.orderNumber,status:"processing",paypalOrderId:orderID,paypalCaptureId:entry.paypalCaptureId});
  }catch(e){
    console.error("[PAYPAL CAPTURE]",e&&e.stack?e.stack:e);
    return res.status(500).json({message:e.message||"Unable to capture PayPal payment."});
  }
});
app.post("/api/checkout/bank-transfer",requireCustomerApi,receiptUpload.single("receipt"),async(req,res)=>{
  console.log(`[BANK TRANSFER] request received | file=${req.file?.originalname||"none"} | type=${req.file?.mimetype||"none"} | size=${req.file?.size||0}`);
  try{
    if(!req.file)return res.status(400).json({message:"Please attach your payment receipt."});
    if(!req.session?.discordUser)return res.status(401).json({message:"Connect your Discord account first."});

    const email=String(req.body.email||"").trim().toLowerCase();
    const phone=String(req.body.phone||"").replace(/[\s()\-]/g,"");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))return res.status(400).json({message:"Enter a valid email address."});
    if(!/^\+[1-9]\d{6,14}$/.test(phone))return res.status(400).json({message:"Enter a valid international phone number."});

    let requestItems=[];
    if(Array.isArray(req.body?.items))requestItems=req.body.items;else try{requestItems=JSON.parse(String(req.body?.items||"[]"))}catch{return res.status(400).json({message:"Invalid cart data."})}
    if(!Array.isArray(requestItems)||!requestItems.length)return res.status(400).json({message:"Cart is empty."});

    let normalizedResult;
    try{normalizedResult=normalizeCartItems(req,requestItems)}catch(e){return res.status(400).json({message:e.message})}
    let priced;
    try{priced=applyCouponToCart(normalizedResult,req.body?.couponCode)}catch(e){return res.status(400).json({message:e.message})}
    const normalized=normalizedResult.items,total=priced.total;
    if(total<=0)return res.status(400).json({message:"This order is free after discount. Use the free order checkout."});

    const extMap={"image/png":".png","image/jpeg":".jpg","image/webp":".webp","application/pdf":".pdf"};
    const ext=extMap[req.file.mimetype]||".bin";
    const filename=`${Date.now()}-${crypto.randomBytes(10).toString("hex")}${ext}`;
    fs.mkdirSync(RECEIPT_DIR,{recursive:true});
    fs.writeFileSync(path.join(RECEIPT_DIR,filename),req.file.buffer);
    await persistBufferUpload(`receipts/${filename}`,req.file.buffer,req.file.mimetype);

    const logs=read(RECEIPT_LOGS,[]);
    const id=nextId(logs),orderNumber=`ES-${String(id).padStart(5,"0")}`;
    const entry={
      id,orderNumber,email,phone,
      discord:req.session.discordUser,
      subtotal:priced.subtotal,discount:priced.discount,coupon:priced.coupon,amount:Number(total.toFixed(2)),currency:"SAR",items:normalized,
      receiptUrl:`/uploads/receipts/${filename}`,receiptFilename:filename,
      status:"processing",createdAt:new Date().toISOString(),deliveredAt:null
    };
    logs.push(entry);write(RECEIPT_LOGS,logs);
    console.log(`[ORDER PROCESSING] ${orderNumber} | @${entry.discord.username} (${entry.discord.id}) | ${email} | ${phone} | SAR ${entry.amount}`);
    return res.json({ok:true,orderNumber,amount:entry.amount,status:"processing"});
  }catch(e){
    console.error("[BANK TRANSFER] save error:",e&&e.stack?e.stack:e);
    return res.status(500).json({message:"Could not save the receipt."});
  }
});

app.post("/api/checkout/free-order",requireCustomerApi,async(req,res)=>{
  try{
    if(!req.session?.discordUser)return res.status(401).json({message:"Connect your Discord account first."});
    const email=String(req.body.email||"").trim().toLowerCase();
    const phone=String(req.body.phone||"").replace(/[\s()\-]/g,"");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))return res.status(400).json({message:"Enter a valid email address."});
    if(!/^\+[1-9]\d{6,14}$/.test(phone))return res.status(400).json({message:"Enter a valid international phone number."});
    let requestItems=[];
    if(Array.isArray(req.body?.items))requestItems=req.body.items;else try{requestItems=JSON.parse(String(req.body?.items||"[]"))}catch{return res.status(400).json({message:"Invalid cart data."})}
    if(!Array.isArray(requestItems)||!requestItems.length)return res.status(400).json({message:"Cart is empty."});
    let normalizedResult;
    try{normalizedResult=normalizeCartItems(req,requestItems)}catch(e){return res.status(400).json({message:e.message})}
    let priced;
    try{priced=applyCouponToCart(normalizedResult,req.body?.couponCode)}catch(e){return res.status(400).json({message:e.message})}
    const normalized=normalizedResult.items,total=priced.total;
    if(total!==0)return res.status(400).json({message:"This order is not free. Use bank transfer checkout instead."});
    const logs=read(RECEIPT_LOGS,[]);
    const id=nextId(logs),orderNumber=`ES-${String(id).padStart(5,"0")}`;
    const entry={id,orderNumber,email,phone,discord:req.session.discordUser,subtotal:priced.subtotal,discount:priced.discount,coupon:priced.coupon,amount:0,currency:"SAR",items:normalized,receiptUrl:"",receiptFilename:"",status:"delivered",createdAt:new Date().toISOString(),deliveredAt:new Date().toISOString()};
    logs.push(entry);write(RECEIPT_LOGS,logs);
    const roleResult=await assignDiscordCustomerRole(entry.discord.id);
    entry.customerRoleAssigned=roleResult.ok===true;
    entry.customerRoleUpdatedAt=new Date().toISOString();
    if(!roleResult.ok)entry.customerRoleError=String(roleResult.reason||`HTTP ${roleResult.status||'error'}`).slice(0,300);
    logs[logs.length-1]=entry;write(RECEIPT_LOGS,logs);
    console.log(`[PREMIUM FREE ORDER] ${orderNumber} | @${entry.discord.username} (${entry.discord.id})`);
    return res.json({ok:true,orderNumber,amount:0,status:"delivered",customerRoleAssigned:entry.customerRoleAssigned});
  }catch(e){console.error('[PREMIUM FREE ORDER]',e);return res.status(500).json({message:'Could not create the free order.'})}
});

app.post("/api/checkout/cart-session",requireCustomerApi,async(req,res)=>{
  try{
    if(!MPK||!APIP||!BASE)return res.status(503).json({message:"Payment gateway is not activated yet."});
    const requestItems=Array.isArray(req.body?.items)?req.body.items:[];if(!requestItems.length)return res.status(400).json({message:"Cart is empty."});
    const ps=products(),orderItems=[];let total=0;
    for(const item of requestItems){
      const p=ps.find(x=>Number(x.id)===Number(item.productId)&&x.active!==false);
      const qty=Math.max(1,Math.min(Number(item.qty||1),20));
      if(!p)return res.status(400).json({message:"A product is unavailable."});

      let unitPrice=effectiveBasePrice(req,p);
      let orderName=p.name;
      let sku=p.slug;

      if(p.productType==="programming_service"){
        const option=String(item.option||"");
        const sp=p.servicePricing||{};
        if(option.startsWith("hours:")){
          const hours=Math.max(1,Math.min(Number(option.split(":")[1]||1),4));
          unitPrice=Number(sp.hourlyRate||0)*hours;
          orderName=`${p.name} - ${hours} Hour${hours>1?"s":""}`;
          sku=`${p.slug}-hours-${hours}`;
        }else if(option==="weekly"){
          unitPrice=Number(sp.weekly||0); orderName=`${p.name} - Weekly`; sku=`${p.slug}-weekly`;
        }else if(option==="half_monthly"){
          unitPrice=Number(sp.halfMonthly||0); orderName=`${p.name} - Half Monthly`; sku=`${p.slug}-half-monthly`;
        }else if(option==="monthly"){
          unitPrice=Number(sp.monthly||0); orderName=`${p.name} - Monthly`; sku=`${p.slug}-monthly`;
        }else if(option==="yearly"){
          unitPrice=Number(sp.yearly||0); orderName=`${p.name} - Yearly`; sku=`${p.slug}-yearly`;
        }else{
          return res.status(400).json({message:"Choose a programming service option."});
        }
        if(!Number.isFinite(unitPrice)||unitPrice<=0)return res.status(400).json({message:"This service option has no valid price yet."});
      }

      total+=unitPrice*qty;
      orderItems.push({name:orderName,count:qty,price:unitPrice,sku});
    }
    const ref=crypto.randomUUID(),rows=orders();rows.push({id:nextId(rows),reference:ref,amount:total,currency:"SAR",status:"created",createdAt:new Date().toISOString()});saveOrders(rows);
    const {r,d}=await geidea(total,ref,orderItems);if(!r.ok||d.responseCode!=="000"||!d.session?.id)return res.status(502).json({message:d.detailedResponseMessage||d.responseMessage||"Payment gateway rejected the session."});res.json({sessionId:d.session.id,reference:ref})
  }catch(e){console.error(e);res.status(500).json({message:"Unable to start checkout."})}
});
app.post("/api/payment/callback",(req,res)=>{console.log("Geidea callback",req.body);res.sendStatus(200)});
app.get("/api/health",async(_req,res)=>{const discordRole=await checkDiscordCustomerRoleConfig();res.json({ok:true,paymentConfigured:Boolean(MPK&&APIP&&BASE)||paypalConfigured(),geideaConfigured:Boolean(MPK&&APIP&&BASE),paypalConfigured:paypalConfigured(),paypalMode:PAYPAL_MODE,paypalCurrency:PAYPAL_CURRENCY,discordCustomerRoleConfigured:Boolean(DISCORD_BOT_TOKEN&&DISCORD_GUILD_ID&&DISCORD_CUSTOMER_ROLE_ID),discordRole});});


app.use((err,req,res,next)=>{
  console.error("[REQUEST ERROR]",err && err.stack ? err.stack : err);
  if(err instanceof multer.MulterError){
    if(err.code==="LIMIT_FILE_SIZE")return res.status(413).json({message:"Receipt file is too large. Maximum size is 8 MB."});
    return res.status(400).json({message:`Upload error: ${err.message}`});
  }
  if(err)return res.status(400).json({message:err.message||"Request failed."});
  next();
});

app.use((_req,res)=>res.status(404).send("Not found"));

async function startServer(){
  try{
    await bootstrapPersistentState();
  }catch(e){
    console.error("[PERSISTENCE] Startup aborted to protect store data:",e.message||e);
    process.exit(1);
  }
  app.listen(PORT,async()=>{
    console.log(`Eleven Store v6.6.0 PayPal + persistent running: http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
    console.log(`[PERSISTENCE] ${SUPABASE_ENABLED?"Supabase enabled":"LOCAL ONLY - NOT SAFE ON RENDER"}`);
    console.log(`[PAYPAL] ${paypalConfigured()?`ready | mode=${PAYPAL_MODE} | currency=${PAYPAL_CURRENCY} | 1 ${PAYPAL_CURRENCY}=${PAYPAL_SAR_PER_UNIT} SAR`:"not configured"}`);
    const roleCheck=await checkDiscordCustomerRoleConfig();
    if(roleCheck.ok)console.log(`[DISCORD CUSTOMER ROLE] ready | bot=${roleCheck.botUsername} | role=${roleCheck.roleName}`);
    else console.warn(`[DISCORD CUSTOMER ROLE] not ready | ${roleCheck.reason||'Check Render Environment and Discord role hierarchy'}`);
  });
}
startServer();
