const $=s=>document.querySelector(s);
let products=[],editing=null,csrf="",adminRole="none",adminCanEdit=false;

let confirmResolver=null;
function siteConfirm(message,{title='Confirm action',confirmText='Confirm'}={}){
  const modal=$('#siteConfirmModal');
  if(!modal)return Promise.resolve(window.confirm(message));
  $('#siteConfirmTitle').textContent=title;
  $('#siteConfirmText').textContent=message;
  $('#siteConfirmOk').textContent=confirmText;
  modal.classList.remove('hidden');
  return new Promise(resolve=>{confirmResolver=resolve});
}
function closeSiteConfirm(value){
  const modal=$('#siteConfirmModal');
  if(modal)modal.classList.add('hidden');
  const r=confirmResolver;confirmResolver=null;if(r)r(Boolean(value));
}
document.addEventListener('click',e=>{
  if(e.target.closest('#siteConfirmOk'))closeSiteConfirm(true);
  if(e.target.closest('#siteConfirmCancel')||e.target.matches('[data-confirm-cancel]'))closeSiteConfirm(false);
});


async function api(url,opts={}){
  opts.headers=opts.headers||{};
  const method=(opts.method||"GET").toUpperCase();
  if(["POST","PUT","PATCH","DELETE"].includes(method)&&csrf){
    opts.headers["X-CSRF-Token"]=csrf;
  }
  const r=await fetch(url,opts);
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||"Request failed");
  if(d.csrfToken)csrf=d.csrfToken;
  return d;
}

async function boot(){
  const s=await api("/api/admin/session");
  if(s.authenticated){csrf=s.csrfToken||"";adminRole=s.role||"staff";adminCanEdit=!!s.canEdit;await showDashboard(s);return}
  const access=await api("/api/admin/access-status").catch(()=>({connected:false,status:"none"}));
  if(access.authenticated){csrf=access.csrfToken||"";adminRole="staff";adminCanEdit=!!access.canEdit;await showDashboard();return}
  showLogin(access);
}

function showLogin(access={}){
  $("#loginView").classList.remove("hidden");
  $("#dashboard").classList.add("hidden");
  $("#logout").classList.add("hidden");
  const box=$("#staffAccessStatus");
  if(access.connected){
    const name=access.user?.globalName||access.user?.username||"Discord user";
    const text=access.status==="pending"?`@${name}: access request is waiting for owner approval.`:access.status==="denied"?`@${name}: access is currently denied by the owner.`:`@${name}: sign in request is registered.`;
    box.textContent=text;box.classList.remove("hidden");
  }else{box.classList.add("hidden");box.textContent=""}
}
async function showDashboard(sessionData=null){
  $("#loginView").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  $("#logout").classList.remove("hidden");
  const s=sessionData||await api("/api/admin/session");
  csrf=s.csrfToken||csrf;adminRole=s.role||adminRole;adminCanEdit=!!s.canEdit;
  $("#showAdminAccess").classList.toggle("hidden",adminRole!=="owner");
  $("#adminIdentity").textContent=adminRole==="owner"?"OWNER · FULL ACCESS":`${s.adminUser?.globalName||s.adminUser?.username||"STAFF"} · ${adminCanEdit?"EDIT ACCESS":"VIEW ONLY"}`;
  $("#newProduct").classList.toggle("hidden",!adminCanEdit);
  await load();
  loadSupportThreads(false).catch(()=>{});
  if(adminRole==="owner")loadAdminAccess(true).catch(()=>{});
}

$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  $("#loginMessage").textContent="";
  try{
    const d=await api("/api/admin/login",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({password:$("#password").value})
    });
    csrf=d.csrfToken||csrf;adminRole=d.role||"owner";adminCanEdit=true;
    $("#password").value="";
    await showDashboard();
  }catch(err){$("#loginMessage").textContent=err.message}
});

$("#logout").addEventListener("click",async()=>{
  try{await api("/api/admin/logout",{method:"POST"})}
  finally{csrf="";showLogin()}
});

async function load(){
  products=await api("/api/admin/products");
  $("#totalProducts").textContent=products.length;
  $("#activeProducts").textContent=products.filter(p=>p.active).length;

  $("#productList").innerHTML=products.map(p=>`
    <article class="admin-product" data-product-id="${p.id}">
      <div class="admin-product-image">
        <img src="${p.image?esc(p.image):'/assets/eleven-logo.png'}" class="${p.image?'':'logo-fallback'}" alt="${esc(p.name)}">
      </div>
      <div class="admin-product-main">
        <span class="product-tag">${esc(p.tag||"ELEVEN")}</span>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.description||"")}</p>
      </div>
      <div class="admin-price">${p.productType==="programming_service"?"SERVICE":p.productType==="premium_subscription"?"PREMIUM":`SAR ${Number(p.price).toLocaleString("en-US",{maximumFractionDigits:2})}`}</div>
      <span class="status ${p.active?"active-status":"hidden-status"}">${p.active?"ACTIVE":"HIDDEN"}</span>
      <div class="actions">
        ${adminCanEdit?`<button type="button" class="action-btn toggle-btn" data-action="toggle" data-id="${p.id}">${p.active?"Hide":"Show"}</button><button type="button" class="action-btn" data-action="edit" data-id="${p.id}">Edit</button><button type="button" class="action-btn danger" data-action="delete" data-id="${p.id}">Delete</button>`:'<span class="view-only-label">View only</span>'}
      </div>
    </article>`).join("")||'<div class="empty-admin">No products yet.</div>';
}

function openEditor(p=null){
  editing=p;
  $("#editorTitle").textContent=p?"Edit Product":"Add Product";
  $("#productId").value=p?.id||"";
  $("#name").value=p?.name||"";
  $("#slug").value=p?.slug||"";
  $("#tag").value=p?.tag||"";
  $("#description").value=p?.description||"";
  $("#price").value=p?.price??"";
  $("#sortOrder").value=p?.sortOrder??0;
  $("#active").checked=p?!!p.active:true;
  $("#productType").value=p?.productType||"standard";
  const sp=p?.servicePricing||{};
  $("#hourlyRate").value=sp.hourlyRate??50;
  $("#weeklyPrice").value=sp.weekly??500;
  $("#halfMonthlyPrice").value=sp.halfMonthly??900;
  $("#monthlyPrice").value=sp.monthly??1500;
  $("#yearlyPrice").value=sp.yearly??15000;
  toggleServicePricing();
  $("#image").value="";
  $("#editorMessage").textContent="";
  if(p?.image){
    $("#preview").src=p.image;
    $("#previewWrap").classList.remove("hidden");
  }else{
    $("#previewWrap").classList.add("hidden");
    $("#preview").removeAttribute("src");
  }

  $("#previewImages").value="";
  const previews=Array.isArray(p?.previewImages)?p.previewImages:[];
  const existing=$("#existingPreviews");
  if(previews.length){
    existing.classList.remove("hidden");
    existing.innerHTML=`<span class="preview-label">Current Preview</span><div class="preview-thumb-grid">${previews.map((url,i)=>`
      <div class="preview-thumb">
        <img src="${esc(url)}" alt="Preview ${i+1}">
        <label><input type="checkbox" class="remove-preview" value="${esc(url)}"> Remove</label>
      </div>`).join("")}</div>`;
  }else{
    existing.classList.add("hidden");
    existing.innerHTML="";
  }
  $("#productModal").classList.remove("hidden");
}

$("#newProduct").addEventListener("click",()=>openEditor());
document.querySelectorAll("[data-close-product]").forEach(el=>{
  el.addEventListener("click",()=>$("#productModal").classList.add("hidden"));
});

$("#productList").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-action]");
  if(!btn)return;
  const id=Number(btn.dataset.id);
  const product=products.find(p=>Number(p.id)===id);
  if(!product)return;

  const action=btn.dataset.action;
  if(action==="edit"){
    openEditor(product);
    return;
  }

  if(action==="delete"){
    if(!(await siteConfirm(`Delete "${product.name}"?`,{title:"Delete product",confirmText:"Delete"})))return;
    btn.disabled=true;
    try{
      await api(`/api/admin/products/${id}`,{method:"DELETE"});
      await load();
    }catch(err){alert(err.message)}
    finally{btn.disabled=false}
    return;
  }

  if(action==="toggle"){
    btn.disabled=true;
    try{
      await api(`/api/admin/products/${id}/visibility`,{
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({active:!product.active})
      });
      await load();
    }catch(err){alert(err.message)}
    finally{btn.disabled=false}
  }
});

$("#image").addEventListener("change",()=>{
  const f=$("#image").files[0];
  if(!f)return;
  $("#preview").src=URL.createObjectURL(f);
  $("#previewWrap").classList.remove("hidden");
});

$("#name").addEventListener("input",()=>{
  if(!editing&&!$("#slug").value.trim()){
    $("#slug").value=$("#name").value.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  }
});

$("#productForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const fd=new FormData();
  ["name","slug","tag","description","price","sortOrder"].forEach(k=>fd.append(k,$("#"+k).value));
  fd.append("productType",$("#productType").value);
  if($("#productType").value==="programming_service"){
    fd.append("servicePricing",JSON.stringify({
      hourlyRate:Number($("#hourlyRate").value||0),
      weekly:Number($("#weeklyPrice").value||0),
      halfMonthly:Number($("#halfMonthlyPrice").value||0),
      monthly:Number($("#monthlyPrice").value||0),
      yearly:Number($("#yearlyPrice").value||0)
    }));
  }
  fd.append("active",$("#active").checked?"1":"0");
  if($("#image").files[0])fd.append("image",$("#image").files[0]);
  Array.from($("#previewImages").files||[]).forEach(file=>fd.append("previewImages",file));
  const removePreviews=Array.from(document.querySelectorAll(".remove-preview:checked")).map(x=>x.value);
  fd.append("removePreviews",JSON.stringify(removePreviews));

  const id=$("#productId").value;
  $("#saveProduct").disabled=true;
  $("#editorMessage").textContent="";
  try{
    await api(id?`/api/admin/products/${id}`:"/api/admin/products",{
      method:id?"PUT":"POST",
      body:fd
    });
    $("#productModal").classList.add("hidden");
    await load();
  }catch(err){$("#editorMessage").textContent=err.message}
  finally{$("#saveProduct").disabled=false}
});

function esc(s){
  return String(s??"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

boot().catch(err=>{$("#loginMessage").textContent=err.message});

function toggleServicePricing(){
  const show=$("#productType").value==="programming_service";
  $("#servicePricingFields").classList.toggle("hidden",!show);
}
$("#productType").addEventListener("change",toggleServicePricing);

async function loadReceiptLogs(){clearInterval(supportPoll);supportPoll=null;try{const logs=await api("/api/admin/receipt-logs");$("#receiptLogs").innerHTML=logs.map(log=>`<article class="receipt-log-card"><div><span class="log-status">${esc(log.status||"receipt_uploaded")}</span><h3>Order #${esc(log.orderNumber||String(log.id))}</h3><p>${esc(log.customer||"No contact")} · ${esc(log.createdAt||"")}</p></div><div class="log-total">SAR ${Number(log.amount||0).toLocaleString("en-US",{maximumFractionDigits:2})}</div><a class="action-btn" href="${esc(log.receiptUrl||"#")}" target="_blank" rel="noopener">View Receipt</a></article>`).join("")||'<div class="empty-admin">No receipt logs yet.</div>';$("#receiptLogsSection").classList.remove("hidden");$("#premiumSection").classList.add("hidden");$("#supportSection").classList.add("hidden");$("#productList").classList.add("hidden")}catch(e){alert(e.message)}}$("#showReceiptLogs").addEventListener("click",loadReceiptLogs);$("#closeReceiptLogs").addEventListener("click",()=>{$("#receiptLogsSection").classList.add("hidden");$("#productList").classList.remove("hidden")});

let currentOrderFilter="processing";
async function loadOrders(filter=currentOrderFilter){
  clearInterval(supportPoll);supportPoll=null;
  currentOrderFilter=filter;
  const orders=await api(`/api/admin/orders?status=${encodeURIComponent(filter)}`);
  $("#ordersList").innerHTML=orders.map(o=>`
    <article class="order-card">
      <div class="order-main">
        <span class="log-status">${esc(o.status||"processing")}</span>
        <h3>${esc(o.orderNumber||String(o.id))}</h3>
        <p>${esc(o.email||"")} · ${esc(o.phone||"")}</p>
        <p>Discord: <strong>@${esc(o.discord?.username||"not-linked")}</strong> ${o.discord?.id?`(${esc(o.discord.id)})`:""}</p>
        <p>${esc(o.createdAt||"")}</p>
      </div>
      <div class="log-total">SAR ${Number(o.amount||0).toLocaleString("en-US",{maximumFractionDigits:2})}</div>
      <div class="order-products">
        <span class="order-products-title">PRODUCTS</span>
        ${(o.items||[]).map(i=>`<div class="admin-order-item"><strong>${esc(i.name||`Product #${i.productId||''}`)}</strong><span>Qty ${Number(i.qty||1)} × SAR ${Number(i.unitPrice||0).toLocaleString("en-US",{maximumFractionDigits:2})}</span><b>SAR ${(Number(i.unitPrice||0)*Number(i.qty||1)).toLocaleString("en-US",{maximumFractionDigits:2})}</b></div>`).join('')||'<div class="admin-order-item"><strong>No product details saved</strong></div>'}
        ${Number(o.discount||0)>0?`<div class="admin-order-discount"><span>Coupon ${esc(o.coupon?.code||'')}</span><b>- SAR ${Number(o.discount||0).toLocaleString("en-US",{maximumFractionDigits:2})}</b></div>`:''}
      </div>
      <div class="actions">
        ${o.receiptUrl?`<a class="action-btn" href="${esc(o.receiptUrl)}" target="_blank" rel="noopener">Receipt</a>`:""}
        ${o.status!=="delivered"&&adminCanEdit?`<button class="action-btn" data-order-action="delivered" data-order-id="${o.id}">Mark Delivered</button>`:""}
        ${o.discord?.id?`<span class="role-state ${o.customerRoleAssigned?'ok':o.customerRoleError?'fail':''}">${o.customerRoleAssigned?'Customer role added':o.customerRoleError?'Role failed':'Role pending'}</span>`:''}
        ${o.status==="delivered"&&o.discord?.id&&!o.customerRoleAssigned&&adminCanEdit?`<button class="action-btn" data-order-action="retry-role" data-order-id="${o.id}">Retry Customer Role</button>`:""}
      </div>
    </article>`).join("")||'<div class="empty-admin">No orders in this section.</div>';
  $("#ordersSection").classList.remove("hidden");
  $("#couponsSection").classList.add("hidden");$("#adminAccessSection").classList.add("hidden");
  $("#premiumSection").classList.add("hidden");
  $("#supportSection").classList.add("hidden");
  $("#productList").classList.add("hidden");
  $("#receiptLogsSection").classList.add("hidden");
}
$("#showOrders").addEventListener("click",()=>loadOrders("processing"));
$("#closeOrders").addEventListener("click",()=>{$("#ordersSection").classList.add("hidden");$("#productList").classList.remove("hidden")});
document.querySelectorAll("[data-order-filter]").forEach(btn=>btn.addEventListener("click",async()=>{
  document.querySelectorAll("[data-order-filter]").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  await loadOrders(btn.dataset.orderFilter);
}));
$("#ordersList").addEventListener("click",async e=>{
  const b=e.target.closest("[data-order-action]");
  if(!b)return;
  if(b.dataset.orderAction==="delivered"){
    if(!(await siteConfirm("Mark this order as delivered?",{title:"Complete order",confirmText:"Mark Delivered"})))return;
    await api(`/api/admin/orders/${b.dataset.orderId}/status`,{
      method:"PATCH",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({status:"delivered"})
    });
    await loadOrders(currentOrderFilter);
    return;
  }
  if(b.dataset.orderAction==="retry-role"){
    b.disabled=true;
    try{
      const out=await api(`/api/admin/orders/${b.dataset.orderId}/customer-role`,{method:'POST'});
      if(!out.customerRoleAssigned)throw new Error(out.customerRoleError||'Discord role could not be assigned.');
      await loadOrders(currentOrderFilter);
    }catch(err){await siteConfirm(err.message,{title:'Discord role error',confirmText:'OK'});}finally{b.disabled=false}
  }
});

async function loadNotificationHistory(){
  const rows=await api("/api/admin/notifications");
  $("#notificationHistory").innerHTML=rows.map(n=>`<article class="notification-row"><div><strong>${esc(n.message)}</strong><p>${n.targetDiscordId?`Target: ${esc(n.targetDiscordId)}`:"Everyone"} · ${esc(n.createdAt||"")}</p></div></article>`).join("")||'<div class="empty-admin">No notifications sent yet.</div>';
}
$("#showNotifications").addEventListener("click",async()=>{
  clearInterval(supportPoll);supportPoll=null;
  $("#notificationsSection").classList.remove("hidden");$("#couponsSection").classList.add("hidden");$("#adminAccessSection").classList.add("hidden");$("#premiumSection").classList.add("hidden");$("#supportSection").classList.add("hidden");$("#productList").classList.add("hidden");$("#ordersSection").classList.add("hidden");$("#receiptLogsSection").classList.add("hidden");await loadNotificationHistory();
});
$("#closeNotifications").addEventListener("click",()=>{$("#notificationsSection").classList.add("hidden");$("#productList").classList.remove("hidden")});
$("#notificationForm").addEventListener("submit",async e=>{
  e.preventDefault();$("#notificationResult").textContent="";
  try{await api("/api/admin/notifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:$("#notificationMessage").value,targetDiscordId:$("#notificationTarget").value.trim()})});$("#notificationMessage").value="";$("#notificationTarget").value="";$("#notificationResult").textContent="Notification sent.";await loadNotificationHistory()}catch(err){$("#notificationResult").textContent=err.message}
});



// Premium access management
async function loadPremiumMembers(){
  clearInterval(supportPoll);supportPoll=null;
  const rows=await api('/api/admin/premium-members');
  $('#premiumMembers').innerHTML=rows.map(m=>`<article class="premium-member-card"><div class="premium-avatar">P</div><div class="premium-member-main"><span class="status ${m.active?'active-status':'hidden-status'}">${m.active?'PREMIUM ACTIVE':'PREMIUM REVOKED'}</span><h3>${esc(m.globalName||m.username||'Discord Member')}</h3><p>@${esc(m.username||'unknown')} · ${esc(m.discordId)}</p><small>Premium order: ${esc(m.orderNumber||'—')} · ${esc(m.purchasedAt||'')}</small></div>${adminCanEdit?`<button class="action-btn ${m.active?'danger':''}" data-premium-id="${esc(m.discordId)}" data-premium-active="${m.active?'0':'1'}">${m.active?'Revoke Premium':'Restore Premium'}</button>`:'<span class="view-only-label">View only</span>'}</article>`).join('')||'<div class="empty-admin">No Premium members yet.</div>';
  $('#premiumSection').classList.remove('hidden');$('#couponsSection').classList.add('hidden');$('#adminAccessSection').classList.add('hidden');$('#supportSection').classList.add('hidden');$('#notificationsSection').classList.add('hidden');$('#ordersSection').classList.add('hidden');$('#receiptLogsSection').classList.add('hidden');$('#productList').classList.add('hidden');
}
$('#showPremium').addEventListener('click',()=>loadPremiumMembers().catch(e=>alert(e.message)));
$('#closePremium').addEventListener('click',()=>{$('#premiumSection').classList.add('hidden');$('#productList').classList.remove('hidden')});
$('#premiumMembers').addEventListener('click',async e=>{const b=e.target.closest('[data-premium-id]');if(!b)return;const active=b.dataset.premiumActive==='1';const label=active?'restore Premium for':'revoke Premium from';if(!(await siteConfirm(`Are you sure you want to ${label} this member?`,{title:'Premium access'})))return;b.disabled=true;try{await api(`/api/admin/premium-members/${encodeURIComponent(b.dataset.premiumId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});await loadPremiumMembers()}catch(err){alert(err.message)}finally{b.disabled=false}});

// Coupon management
let coupons=[];
function couponSelectedIds(){return Array.from(document.querySelectorAll('#couponProducts input:checked')).map(x=>Number(x.value))}
function renderCouponProductOptions(selected=[]){const set=new Set((selected||[]).map(Number));$('#couponProducts').innerHTML=products.map(p=>`<label class="coupon-product-check"><input type="checkbox" value="${p.id}" ${set.has(Number(p.id))?'checked':''}><span>${esc(p.name)}</span></label>`).join('')||'<small>No products available.</small>'}
function resetCouponForm(){ $('#couponId').value='';$('#couponCode').value='';$('#couponType').value='percent';$('#couponValue').value='';$('#couponActive').checked=true;$('#cancelCouponEdit').classList.add('hidden');$('#couponMessage').textContent='';renderCouponProductOptions([]) }
async function loadCoupons(){
  clearInterval(supportPoll);supportPoll=null;coupons=await api('/api/admin/coupons');renderCouponProductOptions([]);
  $('#couponList').innerHTML=coupons.map(c=>{const names=(c.productIds||[]).map(id=>products.find(p=>Number(p.id)===Number(id))?.name).filter(Boolean);return `<article class="coupon-card"><div><span class="status ${c.active?'active-status':'hidden-status'}">${c.active?'ACTIVE':'INACTIVE'}</span><h3>${esc(c.code)}</h3><p>${c.type==='percent'?`${Number(c.value)}%`:`SAR ${Number(c.value).toLocaleString('en-US')}`} · ${names.length?esc(names.join(', ')):'All products'}</p></div><div class="actions">${adminCanEdit?`<button class="action-btn" data-coupon-edit="${c.id}">Edit</button><button class="action-btn danger" data-coupon-delete="${c.id}">Delete</button>`:'<span class="view-only-label">View only</span>'}</div></article>`}).join('')||'<div class="empty-admin">No coupons yet.</div>';
  $('#couponsSection').classList.remove('hidden');$('#adminAccessSection').classList.add('hidden');$('#premiumSection').classList.add('hidden');$('#supportSection').classList.add('hidden');$('#notificationsSection').classList.add('hidden');$('#ordersSection').classList.add('hidden');$('#receiptLogsSection').classList.add('hidden');$('#productList').classList.add('hidden');
  $('#couponForm').classList.toggle('readonly-form',!adminCanEdit);Array.from($('#couponForm').querySelectorAll('input,select,button')).forEach(el=>{if(el.id!=='cancelCouponEdit')el.disabled=!adminCanEdit});
}
$('#showCoupons').addEventListener('click',()=>loadCoupons().catch(e=>alert(e.message)));
$('#closeCoupons').addEventListener('click',()=>{$('#couponsSection').classList.add('hidden');$('#productList').classList.remove('hidden')});
$('#cancelCouponEdit').addEventListener('click',resetCouponForm);
$('#couponForm').addEventListener('submit',async e=>{e.preventDefault();if(!adminCanEdit)return;const id=$('#couponId').value;const body={code:$('#couponCode').value,type:$('#couponType').value,value:Number($('#couponValue').value),active:$('#couponActive').checked,productIds:couponSelectedIds()};$('#saveCoupon').disabled=true;try{await api(id?`/api/admin/coupons/${id}`:'/api/admin/coupons',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});resetCouponForm();await loadCoupons()}catch(err){$('#couponMessage').textContent=err.message}finally{$('#saveCoupon').disabled=false}});
$('#couponList').addEventListener('click',async e=>{const edit=e.target.closest('[data-coupon-edit]'),del=e.target.closest('[data-coupon-delete]');if(edit){const c=coupons.find(x=>Number(x.id)===Number(edit.dataset.couponEdit));if(!c)return;$('#couponId').value=c.id;$('#couponCode').value=c.code;$('#couponType').value=c.type;$('#couponValue').value=c.value;$('#couponActive').checked=c.active!==false;renderCouponProductOptions(c.productIds||[]);$('#cancelCouponEdit').classList.remove('hidden');$('#couponForm').scrollIntoView({behavior:'smooth'});return}if(del){if(!(await siteConfirm('Delete this coupon?',{title:'Delete coupon',confirmText:'Delete'})))return;await api(`/api/admin/coupons/${del.dataset.couponDelete}`,{method:'DELETE'});await loadCoupons()}});


// Review moderation
async function loadAdminReviews(){
  clearInterval(supportPoll);supportPoll=null;
  const rows=await api('/api/admin/reviews');
  $('#reviewsAdminList').innerHTML=rows.map(r=>`<article class="review-admin-card"><div><span class="review-admin-stars">${'★'.repeat(Math.max(0,Math.min(5,Number(r.rating||0))))}${'☆'.repeat(5-Math.max(0,Math.min(5,Number(r.rating||0))))}</span><h3>${esc(r.productName||'Product')}</h3><p>${esc(r.message||'No written comment')}</p><small>${esc(r.displayName||r.username||'Discord User')} · @${esc(r.username||'discord')} · ${supportDate(r.updatedAt||r.createdAt)}</small></div>${adminCanEdit?`<button class="action-btn danger" data-review-delete="${esc(r.id)}" data-review-product="${Number(r.productId)}">Delete</button>`:'<span class="view-only-label">View only</span>'}</article>`).join('')||'<div class="empty-admin">No reviews yet.</div>';
  $('#reviewsAdminSection').classList.remove('hidden');$('#supportSection').classList.add('hidden');$('#couponsSection').classList.add('hidden');$('#adminAccessSection').classList.add('hidden');$('#premiumSection').classList.add('hidden');$('#notificationsSection').classList.add('hidden');$('#ordersSection').classList.add('hidden');$('#receiptLogsSection').classList.add('hidden');$('#productList').classList.add('hidden');
}
$('#showReviews').addEventListener('click',()=>loadAdminReviews().catch(e=>alert(e.message)));
$('#closeReviewsAdmin').addEventListener('click',()=>{$('#reviewsAdminSection').classList.add('hidden');$('#productList').classList.remove('hidden')});
$('#reviewsAdminList').addEventListener('click',async e=>{const b=e.target.closest('[data-review-delete]');if(!b||!adminCanEdit)return;if(!(await siteConfirm('Delete this review?',{title:'Delete review',confirmText:'Delete'})))return;await api(`/api/admin/products/${b.dataset.reviewProduct}/reviews/${encodeURIComponent(b.dataset.reviewDelete)}`,{method:'DELETE'});await loadAdminReviews()});

// Owner-only staff access management
async function loadAdminAccess(background=false){
  if(adminRole!=='owner')return;const rows=await api('/api/admin/admin-access');const pending=rows.filter(x=>x.status==='pending').length;$('#adminPendingBadge').textContent=pending;$('#adminPendingBadge').classList.toggle('hidden',pending===0);
  $('#adminAccessList').innerHTML=rows.map(a=>`<article class="admin-access-card"><div class="admin-access-avatar">${esc((a.globalName||a.username||'A').slice(0,1).toUpperCase())}</div><div class="admin-access-main"><span class="status ${a.status==='approved'?'active-status':a.status==='denied'?'hidden-status':'pending-status'}">${esc((a.status||'pending').toUpperCase())}</span><h3>${esc(a.globalName||a.username||'Discord Admin')}</h3><p>@${esc(a.username||'unknown')} · ${esc(a.discordId)}</p><small>Last login: ${esc(a.lastLoginAt||a.requestedAt||'')}</small></div><div class="admin-access-actions">${a.status!=='approved'?`<button class="action-btn" data-access-status="approved" data-access-id="${esc(a.discordId)}">Approve Access</button>`:`<button class="action-btn danger" data-access-status="denied" data-access-id="${esc(a.discordId)}">Disable Access</button>`}<button class="action-btn ${a.canEdit?'toggle-btn':''}" data-access-edit="${a.canEdit?'0':'1'}" data-access-id="${esc(a.discordId)}">${a.canEdit?'Disable Editing':'Allow Editing'}</button></div></article>`).join('')||'<div class="empty-admin">No staff login requests yet.</div>';
  if(!background){$('#adminAccessSection').classList.remove('hidden');$('#couponsSection').classList.add('hidden');$('#premiumSection').classList.add('hidden');$('#supportSection').classList.add('hidden');$('#notificationsSection').classList.add('hidden');$('#ordersSection').classList.add('hidden');$('#receiptLogsSection').classList.add('hidden');$('#productList').classList.add('hidden')}
}
$('#showAdminAccess').addEventListener('click',()=>loadAdminAccess(false).catch(e=>alert(e.message)));
$('#closeAdminAccess').addEventListener('click',()=>{$('#adminAccessSection').classList.add('hidden');$('#productList').classList.remove('hidden')});
$('#adminAccessList').addEventListener('click',async e=>{const status=e.target.closest('[data-access-status]'),edit=e.target.closest('[data-access-edit]');const b=status||edit;if(!b)return;const body=status?{status:status.dataset.accessStatus}:{canEdit:edit.dataset.accessEdit==='1'};await api(`/api/admin/admin-access/${encodeURIComponent(b.dataset.accessId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await loadAdminAccess(false)});
setInterval(()=>{if(adminRole==='owner'&&!$('#dashboard').classList.contains('hidden'))loadAdminAccess(true).catch(()=>{})},10000);

// Technical support inbox
let activeSupportId="",supportPoll=null;
function supportDate(v){try{return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(v))}catch{return String(v||"")}}
async function loadSupportThreads(keepSelection=true){
  const rows=await api("/api/admin/support");
  const unread=rows.reduce((a,x)=>a+Number(x.unreadAdmin||0),0);
  $("#supportUnreadBadge").textContent=unread;
  $("#supportUnreadBadge").classList.toggle("hidden",unread===0);
  $("#supportThreadList").innerHTML=rows.map(t=>`<button class="support-thread ${t.id===activeSupportId?'active':''}" data-support-id="${esc(t.id)}"><div class="support-thread-top"><div><b>${esc(t.customer?.name||'Visitor')}</b><small>${supportDate(t.updatedAt)}</small></div>${Number(t.unreadAdmin||0)>0?`<span class="thread-unread">${Number(t.unreadAdmin||0)}</span>`:`<span class="thread-status ${t.status==='closed'?'closed':''}">${esc(t.status||'open')}</span>`}</div><p>${esc(t.lastMessage||'No messages yet')}</p></button>`).join("")||'<div class="empty-admin">No support messages yet.</div>';
  if(keepSelection&&activeSupportId&&rows.some(x=>x.id===activeSupportId))await loadSupportConversation(activeSupportId,false);
}
async function loadSupportConversation(id,refreshList=true){
  activeSupportId=id;
  const t=await api(`/api/admin/support/${encodeURIComponent(id)}`);
  const discord=t.customer?.discordUsername?` · Discord @${esc(t.customer.discordUsername)}`:"";
  $("#supportConversationHead").innerHTML=`<div><b>${esc(t.customer?.name||'Visitor')}</b><small>${esc(t.customer?.discordId||'Guest session')}${discord}${t.claimedBy?` · Claimed by ${esc(t.claimedBy.name||'Staff')}`:''}</small></div><div class="support-head-actions"><button class="support-close-btn" data-support-control="${t.claimedBy?'release':'claim'}">${t.claimedBy?'Release Chat':'Take Chat'}</button><button class="support-close-btn" data-support-ai="${t.aiEnabled!==false?'0':'1'}">${t.aiEnabled!==false?'Stop Assistant':'Enable Assistant'}</button><button class="support-close-btn" data-support-status="${t.status==='closed'?'open':'closed'}">${t.status==='closed'?'Reopen':'Close'}</button></div>`;
  $("#supportMessages").innerHTML=(t.messages||[]).map(m=>`<div class="admin-chat-msg ${m.from==='support'?'support':m.from==='ai'?'ai':'customer'}">${esc(m.message)}<small>${m.from==='support'?'Support':m.from==='ai'?'Assistant':'Customer'} · ${supportDate(m.createdAt)}</small></div>`).join("")||'<div class="empty-admin">No messages yet.</div>';
  $("#supportMessages").scrollTop=$("#supportMessages").scrollHeight;
  $("#supportReply").disabled=!adminCanEdit;$("#supportReplyButton").disabled=!adminCanEdit;
  document.querySelectorAll(".support-thread").forEach(x=>x.classList.toggle("active",x.dataset.supportId===id));
  if(refreshList)await loadSupportThreads(false);
}
$("#showSupport").addEventListener("click",async()=>{$("#supportSection").classList.remove("hidden");$("#couponsSection").classList.add("hidden");$("#adminAccessSection").classList.add("hidden");$("#premiumSection").classList.add("hidden");$("#productList").classList.add("hidden");$("#notificationsSection").classList.add("hidden");$("#ordersSection").classList.add("hidden");$("#receiptLogsSection").classList.add("hidden");await loadSupportThreads(false);clearInterval(supportPoll);supportPoll=setInterval(()=>loadSupportThreads(true).catch(()=>{}),4000)});
$("#closeSupport").addEventListener("click",()=>{$("#supportSection").classList.add("hidden");$("#productList").classList.remove("hidden");clearInterval(supportPoll);supportPoll=null});
$("#supportThreadList").addEventListener("click",e=>{const b=e.target.closest("[data-support-id]");if(b)loadSupportConversation(b.dataset.supportId).catch(err=>alert(err.message))});
$("#supportReplyForm").addEventListener("submit",async e=>{e.preventDefault();if(!activeSupportId)return;const message=$("#supportReply").value.trim();if(!message)return;$("#supportReplyButton").disabled=true;try{await api(`/api/admin/support/${encodeURIComponent(activeSupportId)}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})});$("#supportReply").value="";await loadSupportConversation(activeSupportId)}catch(err){alert(err.message)}finally{$("#supportReplyButton").disabled=false}});
$("#supportConversationHead").addEventListener("click",async e=>{
  if(!activeSupportId)return;
  const status=e.target.closest('[data-support-status]'),control=e.target.closest('[data-support-control]'),ai=e.target.closest('[data-support-ai]');
  if(status)await api(`/api/admin/support/${encodeURIComponent(activeSupportId)}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status.dataset.supportStatus})});
  if(control)await api(`/api/admin/support/${encodeURIComponent(activeSupportId)}/control`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:control.dataset.supportControl})});
  if(ai)await api(`/api/admin/support/${encodeURIComponent(activeSupportId)}/control`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ai',enabled:ai.dataset.supportAi==='1'})});
  if(status||control||ai)await loadSupportConversation(activeSupportId);
});
setInterval(()=>{if(!$("#dashboard").classList.contains("hidden"))loadSupportThreads(false).catch(()=>{})},15000);

setInterval(async()=>{if(!$('#loginView').classList.contains('hidden')){try{const access=await api('/api/admin/access-status');if(access.authenticated){csrf=access.csrfToken||csrf;adminRole='staff';adminCanEdit=!!access.canEdit;await showDashboard()}else showLogin(access)}catch{}}},5000);

document.querySelector('.dash-actions')?.addEventListener('click',e=>{if(!e.target.closest('#showReviews'))document.querySelector('#reviewsAdminSection')?.classList.add('hidden')});
