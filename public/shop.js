const cfg=window.ELEVEN_STORE||{},$=s=>document.querySelector(s);
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const money=n=>`${cfg.currency||"SAR"} ${Number(n||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;
function cart(){try{return JSON.parse(localStorage.getItem("eleven_cart")||"[]")}catch{return[]}}
function save(c){localStorage.setItem("eleven_cart",JSON.stringify(c));count()}
function count(){const n=cart().reduce((a,x)=>a+Number(x.qty||1),0);$("#cartCount").textContent=n}
function add(p){const c=cart(),x=c.find(i=>Number(i.id)===Number(p.id));if(x)x.qty++;else c.push({id:p.id,name:p.name,price:p.price,image:p.image||"",qty:1});save(c);location.href="/cart"}
async function load(){
 $("#year").textContent=new Date().getFullYear();count();
 const r=await fetch("/api/products"),products=await r.json();$("#productCount").textContent=`${products.length} product(s)`;
 const grid=$("#products");
 grid.innerHTML=products.map(p=>{
   const isService=p.productType==="programming_service";
   const priceText=isService?`From ${money(Number(p.servicePricing?.hourlyRate||0))}/hr`:money(p.price);
   return `<article class="product-card">
   <button class="product-image product-open" data-open-id="${p.id}"><img class="${p.image?'':'logo-fallback'}" src="${p.image?esc(p.image):'/assets/eleven-logo.png'}" alt="${esc(p.name)}"><span class="preview-badge">Preview</span></button>
   <div class="product-body"><span class="product-tag">${esc(p.tag||'ELEVEN')}</span><button class="product-title product-open" data-open-id="${p.id}">${esc(p.name)}</button><p>${esc(p.description||'')}</p><div class="product-price"><strong>${priceText}</strong></div><button class="add-btn ${isService?'service-btn':''}" data-id="${p.id}">${isService?'Choose Plan':'Add to cart'}</button></div></article>`;
 }).join("")||'<div class="empty">No products yet.</div>';
 grid.onclick=e=>{
   const open=e.target.closest(".product-open");
   if(open){
     const p=products.find(x=>Number(x.id)===Number(open.dataset.openId));
     if(p)openProductPreview(p);
     return;
   }
   const b=e.target.closest(".add-btn");if(!b)return;
   const p=products.find(x=>Number(x.id)===Number(b.dataset.id));if(!p)return;
   if(p.productType==="programming_service")openServiceModal(p);else add(p);
 };
 $("#searchInput").oninput=e=>{const v=e.target.value.toLowerCase();document.querySelectorAll(".product-card").forEach(card=>card.style.display=card.textContent.toLowerCase().includes(v)?"":"none")}
}load().catch(console.error);
function openServiceModal(p){
  let modal=document.querySelector("#serviceModal");
  if(!modal){
    modal=document.createElement("div");
    modal.id="serviceModal";
    modal.className="service-modal";
    document.body.appendChild(modal);
  }

  const sp=p.servicePricing||{};
  modal.innerHTML=`
    <div class="service-backdrop" data-close-service></div>
    <div class="service-dialog">
      <button class="service-close" data-close-service>×</button>
      <span class="eyebrow">PROGRAMMING SERVICE</span>
      <h2>${esc(p.name)}</h2>
      <p>${esc(p.description||"")}</p>

      <div class="service-tabs">
        <button class="active" data-service-tab="hours">Hourly</button>
        <button data-service-tab="plans">Plans</button>
      </div>

      <div id="serviceHours" class="service-panel">
        <label>Choose hours</label>
        <div class="hours-grid">
          ${[1,2,3,4].map(h=>`<button class="service-option" data-option="hours:${h}" data-price="${Number(sp.hourlyRate||0)*h}">${h} Hour${h>1?'s':''}<strong>${money(Number(sp.hourlyRate||0)*h)}</strong></button>`).join("")}
        </div>
      </div>

      <div id="servicePlans" class="service-panel hidden">
        <div class="plan-grid">
          <button class="service-option" data-option="weekly" data-price="${Number(sp.weekly||0)}">Weekly<strong>${money(sp.weekly||0)}</strong></button>
          <button class="service-option" data-option="half_monthly" data-price="${Number(sp.halfMonthly||0)}">Half Monthly<strong>${money(sp.halfMonthly||0)}</strong></button>
          <button class="service-option" data-option="monthly" data-price="${Number(sp.monthly||0)}">Monthly<strong>${money(sp.monthly||0)}</strong></button>
          <button class="service-option" data-option="yearly" data-price="${Number(sp.yearly||0)}">Yearly<strong>${money(sp.yearly||0)}</strong></button>
        </div>
      </div>

      <div class="service-summary">
        <span>Selected</span>
        <strong id="serviceSelected">Choose an option</strong>
      </div>
      <button id="serviceAdd" class="add-btn" disabled>Add to cart</button>
    </div>`;

  let selectedOption=null, selectedPrice=0, selectedLabel="";
  modal.classList.add("show");

  modal.querySelectorAll("[data-close-service]").forEach(x=>x.onclick=()=>modal.classList.remove("show"));
  modal.querySelectorAll("[data-service-tab]").forEach(btn=>btn.onclick=()=>{
    modal.querySelectorAll("[data-service-tab]").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    modal.querySelector("#serviceHours").classList.toggle("hidden",btn.dataset.serviceTab!=="hours");
    modal.querySelector("#servicePlans").classList.toggle("hidden",btn.dataset.serviceTab!=="plans");
  });

  modal.querySelectorAll(".service-option").forEach(btn=>btn.onclick=()=>{
    modal.querySelectorAll(".service-option").forEach(x=>x.classList.remove("selected"));
    btn.classList.add("selected");
    selectedOption=btn.dataset.option;
    selectedPrice=Number(btn.dataset.price||0);
    selectedLabel=btn.childNodes[0].textContent.trim();
    modal.querySelector("#serviceSelected").textContent=`${selectedLabel} · ${money(selectedPrice)}`;
    modal.querySelector("#serviceAdd").disabled=selectedPrice<=0;
  });

  modal.querySelector("#serviceAdd").onclick=()=>{
    if(!selectedOption||selectedPrice<=0)return;
    const c=cart();
    c.push({
      id:p.id,
      name:`${p.name} - ${selectedLabel}`,
      price:selectedPrice,
      image:p.image||"",
      qty:1,
      option:selectedOption
    });
    save(c);
    location.href="/cart";
  };
}

function openProductPreview(p){
  let modal=document.querySelector("#productPreviewModal");
  if(!modal){
    modal=document.createElement("div");
    modal.id="productPreviewModal";
    modal.className="product-preview-modal";
    document.body.appendChild(modal);
  }

  const gallery=[...(p.image?[p.image]:[]),...(Array.isArray(p.previewImages)?p.previewImages:[])];
  if(!gallery.length)gallery.push("/assets/eleven-logo.png");
  let index=0;

  modal.innerHTML=`
    <div class="preview-backdrop" data-close-preview></div>
    <div class="preview-dialog">
      <button class="preview-close" data-close-preview>×</button>
      <div class="preview-gallery">
        <div class="preview-main-wrap">
          <button class="preview-nav prev" aria-label="Previous">‹</button>
          <img id="previewMainImage" src="${esc(gallery[0])}" alt="${esc(p.name)}">
          <button class="preview-nav next" aria-label="Next">›</button>
        </div>
        <div id="previewThumbs" class="preview-thumbs">
          ${gallery.map((url,i)=>`<button data-preview-index="${i}" class="${i===0?'active':''}"><img src="${esc(url)}" alt="Preview ${i+1}"></button>`).join("")}
        </div>
      </div>
      <div class="preview-info">
        <span class="eyebrow">${esc(p.tag||"ELEVEN")}</span>
        <h2>${esc(p.name)}</h2>
        <p>${esc(p.description||"")}</p>
        <div class="preview-info-bottom">
          <strong>${p.productType==="programming_service"?`From ${money(Number(p.servicePricing?.hourlyRate||0))}/hr`:money(p.price)}</strong>
          <button id="previewAddToCart" class="add-btn">${p.productType==="programming_service"?"Choose Plan":"Add to cart"}</button>
        </div>
      </div>
    </div>`;

  const main=modal.querySelector("#previewMainImage");
  const thumbs=modal.querySelectorAll("[data-preview-index]");
  const show=i=>{
    index=(i+gallery.length)%gallery.length;
    main.src=gallery[index];
    thumbs.forEach((t,ti)=>t.classList.toggle("active",ti===index));
  };

  modal.querySelector(".prev").onclick=()=>show(index-1);
  modal.querySelector(".next").onclick=()=>show(index+1);
  thumbs.forEach(t=>t.onclick=()=>show(Number(t.dataset.previewIndex)));
  modal.querySelectorAll("[data-close-preview]").forEach(x=>x.onclick=()=>modal.classList.remove("show"));
  modal.querySelector("#previewAddToCart").onclick=()=>{
    if(p.productType==="programming_service"){
      modal.classList.remove("show");
      openServiceModal(p);
    }else add(p);
  };
  modal.classList.add("show");
}
