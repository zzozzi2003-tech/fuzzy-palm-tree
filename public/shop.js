const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
let products=[],filter='all',sortMode='newest',search='',lang=localStorage.getItem('eleven_lang')||'ar';
const TXT={ar:{home:'الرئيسية',files:'الملفات',scripts:'السكربتات',all:'جميع المنتجات',latest:'أحدث المنتجات',search:'ابحث عن منتج...',cart:'سلة التسوق',item:'عنصر',items:'عناصر',coupon:'كود الخصم',apply:'تطبيق',summary:'ملخص الطلب',subtotal:'المجموع الفرعي',total:'المجموع الكلي',checkout:'متابعة عملية الدفع',empty:'لا توجد منتجات.',add:'أضف للسلة',orders:'طلباتي',heroBadge:'متجر FiveM احترافي',heroTitle:'كل ما يحتاجه سيرفرك<br><em>في مكان واحد.</em>',heroText:'ملفات وسكربتات مختارة بعناية، شراء سريع، ودعم فني مباشر داخل المتجر.',browse:'تصفح المنتجات <span>←</span>',talk:'تحدث مع الدعم',sectionSub:'اختر المنتج المناسب وابدأ مباشرة.'},en:{home:'Home',files:'Files',scripts:'Scripts',all:'All Products',latest:'Latest Products',search:'Search products...',cart:'Shopping Cart',item:'item',items:'items',coupon:'Coupon code',apply:'Apply',summary:'Order Summary',subtotal:'Subtotal',total:'Total',checkout:'Continue to payment',empty:'No products found.',add:'Add to cart',orders:'My Orders',heroBadge:'Premium FiveM Store',heroTitle:'Everything your server needs<br><em>in one place.</em>',heroText:'Hand-picked files and scripts, a fast checkout flow, and built-in technical support.',browse:'Browse products <span>→</span>',talk:'Talk to support',sectionSub:'Choose what fits your server and get started.'}};
const t=k=>TXT[lang][k]||k;const money=n=>`${Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})} SAR`;

function initPointerMotion(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||window.matchMedia('(pointer: coarse)').matches)return;
  const root=document.documentElement;
  window.addEventListener('pointermove',e=>{
    root.style.setProperty('--mx',`${e.clientX}px`);
    root.style.setProperty('--my',`${e.clientY}px`);
  },{passive:true});
}
function bindProductMotion(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||!window.matchMedia('(pointer: fine)').matches)return;
  $$('.product-card').forEach(card=>{
    card.addEventListener('pointermove',e=>{
      const r=card.getBoundingClientRect();
      const x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
      card.style.setProperty('--card-x',`${(x*100).toFixed(1)}%`);
      card.style.setProperty('--card-y',`${(y*100).toFixed(1)}%`);
      card.style.setProperty('--ry',`${((x-.5)*4.2).toFixed(2)}deg`);
      card.style.setProperty('--rx',`${((.5-y)*3.4).toFixed(2)}deg`);
    },{passive:true});
    card.addEventListener('pointerleave',()=>{
      card.style.setProperty('--ry','0deg');
      card.style.setProperty('--rx','0deg');
      card.style.setProperty('--card-x','50%');
      card.style.setProperty('--card-y','20%');
    });
  });
}
function updateShowcaseCount(){const el=$('#showcaseProducts');if(el)el.textContent=`${products.filter(p=>p.active!==false).length} ${lang==='ar'?'منتج':'PRODUCTS'}`}
function cart(){try{return JSON.parse(localStorage.getItem('eleven_cart')||'[]')}catch{return[]}}
function saveCart(v){localStorage.setItem('eleven_cart',JSON.stringify(v));updateCartBadge()}
function updateCartBadge(){const el=$('#cartBadge');if(el)el.textContent=cart().reduce((a,x)=>a+Number(x.qty||1),0)}
function category(p){const tag=String(p.tag||'').toLowerCase();if(p.productType==='programming_service'||p.productType==='premium_subscription')return 'scripts';if(tag.includes('script')||tag.includes('mt')||tag.includes('resource'))return 'scripts';return 'files'}
function price(p){return Number(p.effectivePrice??p.price??0)}
function rows(){let r=products.filter(p=>p.active!==false);if(filter!=='all')r=r.filter(p=>category(p)===filter);if(search)r=r.filter(p=>`${p.name} ${p.description||''} ${p.tag||''}`.toLowerCase().includes(search));if(sortMode==='price-low')r.sort((a,b)=>price(a)-price(b));else if(sortMode==='price-high')r.sort((a,b)=>price(b)-price(a));else r.sort((a,b)=>(Number(a.sortOrder||0)-Number(b.sortOrder||0))||(Number(b.id)-Number(a.id)));return r}
function productUrl(p){return `/product/${encodeURIComponent(p.slug||p.id)}`}
function productTypeLabel(p){const c=category(p);return c==='scripts'?'SCRIPT':c==='services'?'SERVICE':c==='subscription'?'PREMIUM':c==='mlo'?'MLO':'FILE'}
function starLine(rating){
  const value=Math.max(0,Math.min(5,Number(rating||0)));
  return `<span class="card-stars" aria-label="${value.toFixed(1)} out of 5">${[1,2,3,4,5].map(i=>`<i class="${i<=Math.round(value)?'on':''}">★</i>`).join('')}</span>`;
}
function render(){
  const root=$('#products'),r=rows();
  root.innerHTML=r.map(p=>{
    const rating=Number(p.rating?.average||0),reviews=Number(p.rating?.count||0),isFree=price(p)===0;
    return `<article class="product-card">
      <a class="product-image" href="${productUrl(p)}">
        <img class="${p.image?'':'fallback'}" src="${p.image||'/assets/eleven-logo.png'}" alt="${String(p.name).replaceAll('"','&quot;')}">
        <span class="product-hover-label">VIEW PRODUCT</span>
      </a>
      <div class="product-body">
        <div class="product-topline"><span class="product-tag">${p.tag||'ELEVEN'}</span><span class="product-type">${productTypeLabel(p)}</span></div>
        <a class="product-name" href="${productUrl(p)}">${p.name}</a>
        <div class="product-rating">${starLine(rating)}<span>${reviews?`${rating.toFixed(1)} (${reviews})`:(lang==='ar'?'بدون تقييم':'No ratings yet')}</span></div>
        <div class="product-bottom"><strong class="product-price">${isFree?(lang==='ar'?'مجاني':'FREE'):money(price(p))}</strong><a class="details-button" href="${productUrl(p)}">${lang==='ar'?'التفاصيل':'Details'}</a></div>
        <button class="add-button" data-id="${p.id}">${t('add')}</button>
      </div>
    </article>`
  }).join('')||`<div class="empty-state">${t('empty')}</div>`;
  root.querySelectorAll('.add-button').forEach(btn=>btn.onclick=()=>{
    const p=products.find(x=>Number(x.id)===Number(btn.dataset.id));if(!p)return;
    if(p.productType==='programming_service'){location.href=productUrl(p);return}
    const c=cart(),x=c.find(i=>Number(i.id)===Number(p.id)&&!i.option);
    if(x)x.qty++;else c.push({id:p.id,name:p.name,price:price(p),image:p.image||'',qty:1,option:'',productType:p.productType});
    saveCart(c);openCart()
  });
  bindProductMotion();
}
function cartRequestItems(){return cart().map(x=>({productId:x.id,qty:x.qty,option:x.option||''}))}
async function refreshCartCoupon(showMessage=false){const c=cart(),base=c.reduce((a,x)=>a+Number(x.price||0)*Number(x.qty||1),0),code=String(localStorage.getItem('eleven_coupon')||'').trim().toUpperCase(),msg=$('#couponMessage');$('#cartSubtotal').textContent=money(base);$('#cartTotal').textContent=money(base);$('#cartDiscountRow').classList.add('hidden');if(!code){if(msg)msg.textContent='';return}try{const r=await fetch('/api/coupons/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,items:cartRequestItems()})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Invalid coupon');$('#cartSubtotal').textContent=money(d.subtotal);$('#cartDiscount').textContent=`- ${money(d.discount)}`;$('#cartDiscountRow').classList.toggle('hidden',Number(d.discount||0)<=0);$('#cartTotal').textContent=money(d.total);if($('#couponInput'))$('#couponInput').value=d.coupon?.code||code;if(msg&&showMessage)msg.textContent=lang==='ar'?`تم تطبيق الخصم: ${money(d.discount)}`:`Discount applied: ${money(d.discount)}`}catch(e){localStorage.removeItem('eleven_coupon');if(msg&&showMessage)msg.textContent=e.message;$('#cartDiscountRow').classList.add('hidden')}}
function renderCart(){const c=cart(),count=c.reduce((a,x)=>a+Number(x.qty||1),0),total=c.reduce((a,x)=>a+Number(x.price||0)*Number(x.qty||1),0);$('#cartCountText').textContent=`${count} ${count===1?t('item'):t('items')}`;$('#cartSubtotal').textContent=money(total);$('#cartTotal').textContent=money(total);$('#cartItems').innerHTML=c.map((x,i)=>`<article class="cart-item"><img src="${x.image||'/assets/eleven-logo.png'}"><div><h4>${x.name}</h4><small>${money(x.price)}</small></div><div class="cart-controls"><button data-act="minus" data-i="${i}">−</button><b>${x.qty}</b><button data-act="plus" data-i="${i}">+</button><button class="remove" data-act="remove" data-i="${i}">×</button></div></article>`).join('')||`<div class="empty-state">${t('empty')}</div>`;$('#cartItems').querySelectorAll('button').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.i),a=b.dataset.act;if(a==='plus')c[i].qty++;if(a==='minus')c[i].qty=Math.max(1,c[i].qty-1);if(a==='remove')c.splice(i,1);saveCart(c);renderCart()});if($('#couponInput'))$('#couponInput').value=localStorage.getItem('eleven_coupon')||'';refreshCartCoupon(false)}
function openCart(){renderCart();$('#cartModal').classList.remove('hidden')}
function setFilter(v){filter=v;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x.dataset.filter===v));$$('[data-filter-button]').forEach(x=>x.classList.toggle('active',x.dataset.filterButton===v));render()}
function applyLang(){document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.body.classList.toggle('en',lang==='en');const nav=$$('.nav-main a');if(nav[0])nav[0].textContent=t('home');if(nav[1])nav[1].textContent=t('files');if(nav[2])nav[2].textContent=t('scripts');if(nav[3])nav[3].textContent=t('all');if($('#latestTitle'))$('#latestTitle').textContent=t('latest');if($('#sectionSub'))$('#sectionSub').textContent=t('sectionSub');if($('#searchInput'))$('#searchInput').placeholder=t('search');if($('#cartTitle'))$('#cartTitle').textContent=t('cart');if($('#couponLabel'))$('#couponLabel').textContent=t('coupon');if($('#couponApply'))$('#couponApply').textContent=t('apply');if($('#summaryTitle'))$('#summaryTitle').textContent=t('summary');if($('#subtotalLabel'))$('#subtotalLabel').textContent=t('subtotal');if($('#totalLabel'))$('#totalLabel').textContent=t('total');if($('#checkoutButton'))$('#checkoutButton').textContent=t('checkout');if($('.customer-orders-link'))$('.customer-orders-link').textContent=t('orders');if($('#heroBadge'))$('#heroBadge').textContent=t('heroBadge');if($('#heroTitle'))$('#heroTitle').innerHTML=t('heroTitle');if($('#heroText'))$('#heroText').textContent=t('heroText');if($('#browseBtn'))$('#browseBtn').innerHTML=t('browse');if($('#heroSupport'))$('#heroSupport').textContent=t('talk');const chips=$$('[data-filter-button]');if(chips[0])chips[0].textContent=lang==='ar'?'الكل':'All';if(chips[1])chips[1].textContent=t('files');if(chips[2])chips[2].textContent=t('scripts');if($('#langBtn'))$('#langBtn').innerHTML=`<span class="lang-dot">${lang==='ar'?'AR':'EN'}</span><span>${lang==='ar'?'العربية':'English'}</span><i>⌃</i>`;updateShowcaseCount();render()}

async function loadCustomerLogin(){try{const r=await fetch('/api/auth/discord');const d=await r.json();const a=$('#customerLogin');if(!a)return;if(d.connected){a.textContent=`@${d.user.username}${d.premiumActive?' · PREMIUM':''}`;a.href='/orders';a.title='My account'}else{a.textContent=lang==='ar'?'تسجيل الدخول':'Login';a.href='/login'}}catch{}}
async function init(){products=await fetch('/api/products').then(r=>r.json());if($('#heroProducts'))$('#heroProducts').textContent=products.length;fetch('/api/store-stats').then(r=>r.json()).then(s=>{if($('#heroCustomers'))$('#heroCustomers').textContent=Number(s.totalUsers||0)}).catch(()=>{});updateCartBadge();render();applyLang();loadCustomerLogin();if($('#sortSelect'))$('#sortSelect').onchange=e=>{sortMode=e.target.value;render()};$$('[data-filter]').forEach(a=>a.onclick=e=>{const f=a.dataset.filter;if(!f)return;e.preventDefault();setFilter(f);document.querySelector('#products').scrollIntoView({behavior:'smooth'})});$$('[data-filter-button]').forEach(b=>b.onclick=()=>setFilter(b.dataset.filterButton));if($('#cartButton'))$('#cartButton').onclick=openCart;$$('[data-cart-close]').forEach(x=>x.onclick=()=>$('#cartModal').classList.add('hidden'));if($('#couponApply'))$('#couponApply').onclick=()=>{const code=$('#couponInput').value.trim().toUpperCase();if(code)localStorage.setItem('eleven_coupon',code);else localStorage.removeItem('eleven_coupon');refreshCartCoupon(true)};if($('#checkoutButton'))$('#checkoutButton').onclick=()=>location.href='/checkout';if($('#searchButton'))$('#searchButton').onclick=()=>{$('#searchBar').classList.toggle('hidden');if(!$('#searchBar').classList.contains('hidden'))$('#searchInput').focus()};if($('#closeSearch'))$('#closeSearch').onclick=()=>$('#searchBar').classList.add('hidden');if($('#searchInput'))$('#searchInput').oninput=e=>{search=e.target.value.toLowerCase().trim();render()};if($('#langBtn'))$('#langBtn').onclick=e=>{e.stopPropagation();$('#langMenu').classList.toggle('hidden')};$$('#langMenu button').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;localStorage.setItem('eleven_lang',lang);$('#langMenu').classList.add('hidden');applyLang()});document.addEventListener('click',e=>{if(!e.target.closest('.lang-wrap'))$('#langMenu').classList.add('hidden')})}
initPointerMotion();
init().catch(console.error);
