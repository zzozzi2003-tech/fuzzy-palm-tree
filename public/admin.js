const $=s=>document.querySelector(s);
let products=[],editing=null,csrf="";

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
  if(s.authenticated){
    csrf=s.csrfToken||"";
    await showDashboard();
  }else showLogin();
}

function showLogin(){
  $("#loginView").classList.remove("hidden");
  $("#dashboard").classList.add("hidden");
  $("#logout").classList.add("hidden");
}
async function showDashboard(){
  $("#loginView").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  $("#logout").classList.remove("hidden");
  const s=await api("/api/admin/session");
  csrf=s.csrfToken||csrf;
  await load();
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
    csrf=d.csrfToken||csrf;
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
      <div class="admin-price">SAR ${Number(p.price).toLocaleString("en-US",{maximumFractionDigits:2})}</div>
      <span class="status ${p.active?"active-status":"hidden-status"}">${p.active?"ACTIVE":"HIDDEN"}</span>
      <div class="actions">
        <button type="button" class="action-btn toggle-btn" data-action="toggle" data-id="${p.id}">${p.active?"Hide":"Show"}</button>
        <button type="button" class="action-btn" data-action="edit" data-id="${p.id}">Edit</button>
        <button type="button" class="action-btn danger" data-action="delete" data-id="${p.id}">Delete</button>
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
    if(!confirm(`Delete "${product.name}"?`))return;
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
