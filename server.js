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
const RECEIPT_DIR=path.join(UPLOADS,"receipts");
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UPLOADS,{recursive:true});fs.mkdirSync(RECEIPT_DIR,{recursive:true});

function read(file,fallback){try{return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):fallback}catch(e){console.error(e);return fallback}}
function write(file,data){const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file)}
function products(){return read(PRODUCTS,[])}function saveProducts(v){write(PRODUCTS,v)}function orders(){return read(ORDERS,[])}function saveOrders(v){write(ORDERS,v)}
function nextId(rows){return rows.reduce((m,x)=>Math.max(m,Number(x.id||0)),0)+1}
if(!fs.existsSync(PRODUCTS))saveProducts([]);if(!fs.existsSync(ORDERS))saveOrders([]);if(!fs.existsSync(RECEIPT_LOGS))write(RECEIPT_LOGS,[]);if(!fs.existsSync(NOTIFICATIONS))write(NOTIFICATIONS,[]);if(!fs.existsSync(PRODUCT_COMMENTS))write(PRODUCT_COMMENTS,{});if(!fs.existsSync(SUPPORT_CHATS))write(SUPPORT_CHATS,[]);if(!fs.existsSync(PREMIUM_ACCESS))write(PREMIUM_ACCESS,[]);if(!fs.existsSync(COUPONS))write(COUPONS,[]);if(!fs.existsSync(ADMIN_ACCESS))write(ADMIN_ACCESS,[]);

app.set("trust proxy",1);
app.use(helmet({
  contentSecurityPolicy:{
    directives:{
      defaultSrc:["'self'"],
      scriptSrc:["'self'","https://www.ksamerchant.geidea.net"],
      styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
      fontSrc:["'self'","https://fonts.gstatic.com","data:"],
      imgSrc:["'self'","data:","blob:"],
      connectSrc:["'self'","https://api.ksamerchant.geidea.net"],
      frameSrc:["'self'","https://www.ksamerchant.geidea.net"],
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
function publicProduct(req,p){const premiumActive=hasPremiumAccess(req.session?.discordUser?.id);const effectivePrice=premiumActive&&isPremiumEligibleScript(p)?0:Number(p.price||0);return {...p,effectivePrice,premiumIncluded:premiumActive&&isPremiumEligibleScript(p),category:categoryForProduct(p)} }
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
function getCommentsForProduct(id){const all=commentStore();const key=commentKey(id);const entry=all[key]||{comments:[],reactions:{like:0,love:0,wow:0,angry:0}};entry.comments=Array.isArray(entry.comments)?entry.comments:[];entry.reactions=entry.reactions&&typeof entry.reactions==='object'?entry.reactions:{like:0,love:0,wow:0,angry:0};for(const k of ['like','love','wow','angry']) entry.reactions[k]=Number(entry.reactions[k]||0);
  return entry;
}
function saveCommentsForProduct(id,entry){const all=commentStore();all[commentKey(id)]=entry;write(PRODUCT_COMMENTS,all);return entry;}

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

app.use("/assets",express.static(path.join(PUBLIC,"assets"),{maxAge:"1d"}));
app.use("/uploads",express.static(UPLOADS,{maxAge:"1d",fallthrough:false}));
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

app.get("/api/products/:id/comments",(req,res)=>{res.json(getCommentsForProduct(req.params.id));});
app.post("/api/products/:id/comments",(req,res)=>{try{const productId=Number(req.params.id);const author=String(req.body?.author||req.session?.discordUser?.username||"Anonymous").trim().slice(0,40)||"Anonymous";const message=String(req.body?.message||"").trim().slice(0,1000);if(!productId||!message)return res.status(400).json({message:"Comment text is required."});const entry=getCommentsForProduct(productId);const list=entry.comments;const id=nextId(list);list.unshift({id,author,message,createdAt:new Date().toISOString()});entry.comments=list.slice(0,100);saveCommentsForProduct(productId,entry);res.json({ok:true,comments:entry.comments,reactions:entry.reactions});}catch(e){console.error("Comment post error:",e);res.status(500).json({message:"Could not save comment."})}});
app.post("/api/products/:id/react",(req,res)=>{try{const productId=Number(req.params.id);const reaction=String(req.body?.reaction||"");if(!productId||!["like","love","wow","angry"].includes(reaction))return res.status(400).json({message:"Invalid reaction."});const entry=getCommentsForProduct(productId);entry.reactions[reaction]=Number(entry.reactions[reaction]||0)+1;saveCommentsForProduct(productId,entry);res.json({ok:true,reactions:entry.reactions});}catch(e){console.error("Reaction error:",e);res.status(500).json({message:"Could not save reaction."})}});

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
    rows.push({id:token,customer:customerForSupport(req,token),status:"open",unreadAdmin:0,unreadCustomer:0,createdAt:now,updatedAt:now,messages:[]});
    i=rows.length-1;
  }
  const thread=rows[i];
  thread.customer=customerForSupport(req,token);
  thread.status="open";
  const list=Array.isArray(thread.messages)?thread.messages:[];
  list.push({id:nextId(list),from:"customer",message,createdAt:now});
  thread.messages=list.slice(-300);
  thread.unreadAdmin=Number(thread.unreadAdmin||0)+1;
  thread.updatedAt=now;
  saveSupportChats(rows);
  res.json({ok:true,thread:publicSupportThread(thread)});
});

app.get("/api/admin/support",requireAdmin,(_req,res)=>{
  const rows=supportChats().sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  res.json(rows.map(t=>({id:t.id,customer:t.customer||{},status:t.status||"open",unreadAdmin:Number(t.unreadAdmin||0),unreadCustomer:Number(t.unreadCustomer||0),createdAt:t.createdAt,updatedAt:t.updatedAt,lastMessage:(Array.isArray(t.messages)&&t.messages.length?t.messages[t.messages.length-1].message:"")})));
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

app.post("/api/admin/products",requireAdmin,requireAdminEdit,requireCsrf,upload.fields([{name:"image",maxCount:1},{name:"previewImages",maxCount:12}]),(req,res)=>{
  const rows=products(),name=String(req.body.name||"").trim(),slug=cleanSlug(req.body.slug||name),price=Number(req.body.price||0);
  if(!name||!slug)return res.status(400).json({message:"Name and slug are required."});
  if(!Number.isFinite(price)||price<0)return res.status(400).json({message:"Invalid price."});
  if(rows.some(p=>p.slug===slug))return res.status(409).json({message:"Slug already exists."});
  const productType=String(req.body.productType||"standard");
  let servicePricing={};
  if(productType==="programming_service"){
    try{servicePricing=JSON.parse(String(req.body.servicePricing||"{}"))}catch{}
  }
  const row={id:nextId(rows),slug,name,tag:String(req.body.tag||"ELEVEN").trim().slice(0,30),description:String(req.body.description||"").trim(),price,image:req.files?.image?.[0]?`/uploads/${req.files.image[0].filename}`:"",previewImages:(req.files?.previewImages||[]).map(f=>`/uploads/${f.filename}`),active:String(req.body.active||"1")==="1",sortOrder:Number(req.body.sortOrder||0),productType,servicePricing};
  rows.push(row);saveProducts(rows);res.json(row)
});
app.put("/api/admin/products/:id",requireAdmin,requireAdminEdit,requireCsrf,upload.fields([{name:"image",maxCount:1},{name:"previewImages",maxCount:12}]),(req,res)=>{
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
  const newPreviewUrls=(req.files?.previewImages||[]).map(f=>`/uploads/${f.filename}`);
  previewImages=[...previewImages,...newPreviewUrls].slice(0,12);

  rows[i]={...old,name,slug,tag:String(req.body.tag??old.tag).trim().slice(0,30),description:String(req.body.description??old.description).trim(),price,image:req.files?.image?.[0]?`/uploads/${req.files.image[0].filename}`:old.image,previewImages,active:String(req.body.active??(old.active?"1":"0"))==="1",sortOrder:Number(req.body.sortOrder??old.sortOrder??0),productType,servicePricing};
  saveProducts(rows);res.json(rows[i])
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

app.patch("/api/admin/orders/:id/status",requireAdmin,requireAdminEdit,requireCsrf,(req,res)=>{
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
  }
  console.log(`[ORDER STATUS] ${rows[i].orderNumber} => ${status}`);
  res.json(rows[i]);
});


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
app.post("/api/checkout/bank-transfer",requireCustomerApi,receiptUpload.single("receipt"),(req,res)=>{
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

app.post("/api/checkout/free-order",requireCustomerApi,(req,res)=>{
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
    console.log(`[PREMIUM FREE ORDER] ${orderNumber} | @${entry.discord.username} (${entry.discord.id})`);
    return res.json({ok:true,orderNumber,amount:0,status:"delivered"});
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
app.get("/api/health",(_req,res)=>res.json({ok:true,paymentConfigured:Boolean(MPK&&APIP&&BASE)}));


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
app.listen(PORT,()=>{console.log(`Eleven Store v6.3.4 running: http://localhost:${PORT}`);console.log(`Admin: http://localhost:${PORT}/admin`)});
