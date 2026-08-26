const cfg=window.ELEVEN_STORE||{},$=s=>document.querySelector(s);
const money=n=>`${cfg.currency||"SAR"} ${Number(n||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;
function cart(){try{return JSON.parse(localStorage.getItem('eleven_cart')||'[]')}catch{return[]}}
const items=cart();
const countries=[
['SA','Saudi Arabia','966'],['AE','United Arab Emirates','971'],['KW','Kuwait','965'],['QA','Qatar','974'],['BH','Bahrain','973'],['OM','Oman','968'],['YE','Yemen','967'],['JO','Jordan','962'],['EG','Egypt','20'],['IQ','Iraq','964'],['LB','Lebanon','961'],['SY','Syria','963'],['PS','Palestine','970'],['MA','Morocco','212'],['DZ','Algeria','213'],['TN','Tunisia','216'],['LY','Libya','218'],['SD','Sudan','249'],['SO','Somalia','252'],['DJ','Djibouti','253'],['MR','Mauritania','222'],
['US','United States','1'],['CA','Canada','1'],['GB','United Kingdom','44'],['FR','France','33'],['DE','Germany','49'],['IT','Italy','39'],['ES','Spain','34'],['PT','Portugal','351'],['NL','Netherlands','31'],['BE','Belgium','32'],['CH','Switzerland','41'],['AT','Austria','43'],['SE','Sweden','46'],['NO','Norway','47'],['DK','Denmark','45'],['FI','Finland','358'],['IE','Ireland','353'],['PL','Poland','48'],['CZ','Czechia','420'],['GR','Greece','30'],['RO','Romania','40'],['HU','Hungary','36'],['UA','Ukraine','380'],['RU','Russia','7'],['TR','Türkiye','90'],
['IN','India','91'],['PK','Pakistan','92'],['BD','Bangladesh','880'],['LK','Sri Lanka','94'],['NP','Nepal','977'],['CN','China','86'],['JP','Japan','81'],['KR','South Korea','82'],['ID','Indonesia','62'],['MY','Malaysia','60'],['SG','Singapore','65'],['TH','Thailand','66'],['PH','Philippines','63'],['VN','Vietnam','84'],['AF','Afghanistan','93'],['IR','Iran','98'],
['AU','Australia','61'],['NZ','New Zealand','64'],['ZA','South Africa','27'],['NG','Nigeria','234'],['KE','Kenya','254'],['ET','Ethiopia','251'],['GH','Ghana','233'],['TZ','Tanzania','255'],['UG','Uganda','256'],['SN','Senegal','221'],
['BR','Brazil','55'],['MX','Mexico','52'],['AR','Argentina','54'],['CL','Chile','56'],['CO','Colombia','57'],['PE','Peru','51'],['VE','Venezuela','58'],['OTHER','Other / custom code','custom']
];
let discord=null,unlocked=false,pricing={items:[],subtotal:items.reduce((a,x)=>a+Number(x.price||0)*Number(x.qty||1),0),discount:0,total:0,coupon:null};
pricing.total=pricing.subtotal;
let paypalConfig=null,paypalRendered=false,paypalSdkPromise=null,applePayRendered=false,applePayInstance=null,applePayConfig=null;
function requestItems(){return items.map(x=>({productId:x.id,qty:x.qty,option:x.option||''}))}
function setupCountries(){const select=$('#countryCode');select.innerHTML=countries.map(([iso,name,code])=>`<option value="${code}" data-iso="${iso}" ${iso==='SA'?'selected':''}>${name} ${code==='custom'?'':`(+${code})`}</option>`).join('');select.addEventListener('change',()=>{const custom=select.value==='custom';$('#customCodeWrap').classList.toggle('hidden',!custom);updatePhonePreview()});$('#customCode').addEventListener('input',updatePhonePreview);$('#phone').addEventListener('input',updatePhonePreview);updatePhonePreview()}
function selectedCode(){const v=$('#countryCode').value;if(v!=='custom')return v;return $('#customCode').value.replace(/\D/g,'').slice(0,4)}
function cleanLocalPhone(){return $('#phone').value.replace(/\D/g,'').replace(/^0+/,'')}
function fullPhone(){const code=selectedCode(),local=cleanLocalPhone();return code&&local?`+${code}${local}`:''}
function validPhone(){return /^\+[1-9]\d{6,14}$/.test(fullPhone())}
function updatePhonePreview(){const code=selectedCode(),local=cleanLocalPhone(),preview=$('#phonePreview');preview.textContent=code?`Saved as +${code}${local||'…'}`:'Enter your international calling code.';preview.style.color=local&&!validPhone()?'#ff8b9a':''}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)}

function paypalStatus(message,type='info'){
  const el=$('#paypalStatus');if(!el)return;
  if(!message){el.textContent='';el.className='paypal-status hidden';return}
  el.textContent=message;el.className=`paypal-status ${type}`;
}
function paypalDisplayAmount(){
  if(!paypalConfig?.enabled||!Number(paypalConfig.sarPerUnit))return null;
  const decimals=paypalConfig.currency==='JPY'?0:2;
  const value=Number(pricing.total||0)/Number(paypalConfig.sarPerUnit);
  return {value:value.toFixed(decimals),currency:paypalConfig.currency};
}
function updatePayPalAmountNote(){
  const el=$('#paypalAmountNote');if(!el)return;
  if(Number(pricing.total||0)===0){el.textContent='No payment is required for this order.';return}
  const converted=paypalDisplayAmount();
  if(!paypalConfig){el.textContent='Loading PayPal...';return}
  if(!paypalConfig.enabled){el.textContent='PayPal is not configured yet. Bank transfer is still available.';return}
  el.textContent=`PayPal charge: ${converted.currency} ${converted.value} for ${money(pricing.total)} · conversion set to 1 ${converted.currency} = ${Number(paypalConfig.sarPerUnit)} SAR.`;
}
function validateCheckoutFields(){
  const email=$('#email').value.trim();
  if(!selectedCode())throw new Error('Choose your country code.');
  if(!validPhone())throw new Error('Enter a valid phone number for the selected country.');
  if(!validEmail(email))throw new Error('Enter a valid email address.');
  if(!discord)throw new Error('Connect your Discord account first.');
  return {email,phone:fullPhone()};
}
function loadPayPalSdk(clientId,currency){
  if(window.paypal)return Promise.resolve(window.paypal);
  if(paypalSdkPromise)return paypalSdkPromise;
  paypalSdkPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons,applepay`;
    s.async=true;s.onload=()=>window.paypal?resolve(window.paypal):reject(new Error('PayPal SDK did not initialize.'));s.onerror=()=>reject(new Error('Could not load PayPal.'));
    document.head.appendChild(s);
  });
  return paypalSdkPromise;
}

function applePayStatus(message,type='info'){
  const el=$('#applePayStatus');if(!el)return;
  if(!message){el.textContent='';el.className='applepay-status hidden';return}
  el.textContent=message;el.className=`applepay-status ${type}`;
}
function updateApplePayAmountNote(){
  const el=$('#applePayAmountNote');if(!el)return;
  if(Number(pricing.total||0)===0){el.textContent='No payment is required for this order.';return}
  const converted=paypalDisplayAmount();
  if(!paypalConfig){el.textContent='Loading Apple Pay eligibility...';return}
  if(!paypalConfig.enabled||!converted){el.textContent='Apple Pay through PayPal is not configured yet.';return}
  el.textContent=`Apple Pay charge: ${converted.currency} ${converted.value} for ${money(pricing.total)}.`;
}
async function initApplePay(){
  updateApplePayAmountNote();
  const container=$('#applepay-container');if(!container||applePayRendered)return;
  if(!paypalConfig?.enabled||!paypalConfig?.clientId){applePayStatus('PayPal is not configured yet.','info');return}
  try{
    const pp=await loadPayPalSdk(paypalConfig.clientId,paypalConfig.currency);
    if(!window.ApplePaySession||typeof ApplePaySession.canMakePayments!=='function'){
      applePayStatus('Apple Pay is unavailable on this browser/device. Use a compatible Apple Pay device after PayPal enables Apple Pay for the merchant.','info');return;
    }
    if(!ApplePaySession.canMakePayments()){
      applePayStatus('This device cannot make Apple Pay payments.','info');return;
    }
    if(typeof pp.Applepay!=='function'){
      applePayStatus('PayPal did not expose Apple Pay for this merchant. Enable Apple Pay in the PayPal Developer app and register the domain.','info');return;
    }
    applePayInstance=pp.Applepay();
    applePayConfig=await applePayInstance.config();
    if(!applePayConfig?.isEligible){
      applePayStatus('PayPal says Apple Pay is not eligible for this merchant/account, buyer region, or domain.','info');return;
    }
    container.innerHTML='<apple-pay-button id="btn-appl" buttonstyle="black" type="buy" locale="en-US"></apple-pay-button>';
    const btn=$('#btn-appl');
    if(!btn){applePayStatus('Could not render Apple Pay.','error');return}
    btn.addEventListener('click',startApplePayPayment);
    applePayRendered=true;
    applePayStatus('Apple Pay is ready.','');
  }catch(e){console.error('Apple Pay init',e);applePayStatus(e.message||'Apple Pay is currently unavailable.','error')}
}
async function startApplePayPayment(){
  let session=null;
  try{
    const contact=validateCheckoutFields();
    if(!applePayInstance||!applePayConfig?.isEligible)throw new Error('Apple Pay is not ready.');
    const converted=paypalDisplayAmount();
    if(!converted||Number(converted.value)<=0)throw new Error('Invalid Apple Pay amount.');
    const paymentRequest={
      countryCode:applePayConfig.countryCode,
      merchantCapabilities:applePayConfig.merchantCapabilities,
      supportedNetworks:applePayConfig.supportedNetworks,
      currencyCode:converted.currency,
      requiredBillingContactFields:['postalAddress'],
      total:{label:'Eleven Store',type:'final',amount:converted.value}
    };
    session=new ApplePaySession(4,paymentRequest);
    session.onvalidatemerchant=async event=>{
      try{
        const result=await applePayInstance.validateMerchant({validationUrl:event.validationURL,displayName:'Eleven Store'});
        session.completeMerchantValidation(result.merchantSession);
      }catch(e){console.error('Apple Pay merchant validation',e);applePayStatus('Apple Pay domain/merchant validation failed. Check PayPal Apple Pay domain registration.','error');session.abort()}
    };
    session.onpaymentauthorized=async event=>{
      let orderID='';
      try{
        applePayStatus('Authorizing Apple Pay with PayPal...','info');
        const r=await fetch('/api/checkout/paypal/applepay/create-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:contact.email,phone:contact.phone,items:requestItems(),couponCode:localStorage.getItem('eleven_coupon')||''})});
        const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error(out.message||'Could not create Apple Pay order.');
        orderID=out.id;
        await applePayInstance.confirmOrder({orderId:orderID,token:event.payment.token,billingContact:event.payment.billingContact});
        const cr=await fetch('/api/checkout/paypal/capture-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderID})});
        const captured=await cr.json().catch(()=>({}));if(!cr.ok)throw new Error(captured.message||'Could not capture Apple Pay payment.');
        session.completePayment(ApplePaySession.STATUS_SUCCESS);
        localStorage.removeItem('eleven_cart');localStorage.removeItem('eleven_coupon');
        applePayStatus(`Payment confirmed. Order ${captured.orderNumber} is processing and waiting for admin delivery.`,'');
        setTimeout(()=>{location.href=`/payment-success?provider=applepay&order=${encodeURIComponent(captured.orderNumber||'')}`},500);
      }catch(e){console.error('Apple Pay payment',e);try{session.completePayment(ApplePaySession.STATUS_FAILURE)}catch{}applePayStatus(`${e.message||'Apple Pay payment failed.'}${orderID?` PayPal order ID: ${orderID}`:''}`,'error')}
    };
    session.oncancel=()=>applePayStatus('Apple Pay was cancelled. No order was created for delivery.','info');
    session.begin();
  }catch(e){console.error('Apple Pay start',e);applePayStatus(e.message||'Could not start Apple Pay.','error')}
}

async function initPayPal(){
  try{
    const r=await fetch('/api/paypal/config');const d=await r.json().catch(()=>({}));paypalConfig=d;updatePayPalAmountNote();
    if(!r.ok||!d.enabled||!d.clientId){paypalStatus('PayPal is not configured yet. You can still use bank transfer.','info');return}
    const pp=await loadPayPalSdk(d.clientId,d.currency);
    initApplePay();
    if(paypalRendered)return;
    paypalRendered=true;
    await pp.Buttons({
      style:{layout:'vertical',shape:'rect',label:'paypal',height:45},
      createOrder:async()=>{
        try{
          const contact=validateCheckoutFields();
          paypalStatus('Creating secure PayPal checkout...','info');
          const r=await fetch('/api/checkout/paypal/create-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:contact.email,phone:contact.phone,items:requestItems(),couponCode:localStorage.getItem('eleven_coupon')||''})});
          const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error(out.message||'Could not start PayPal checkout.');
          paypalStatus('PayPal checkout ready. Complete the approval window.','info');
          return out.id;
        }catch(e){paypalStatus(e.message||'Could not start PayPal checkout.','error');throw e}
      },
      onApprove:async data=>{
        try{
          paypalStatus('PayPal approved. Confirming payment...','info');
          const r=await fetch('/api/checkout/paypal/capture-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderID:data.orderID})});
          const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error(out.message||'Could not confirm PayPal payment.');
          localStorage.removeItem('eleven_cart');localStorage.removeItem('eleven_coupon');
          paypalStatus(`Payment confirmed. Order ${out.orderNumber} is processing and waiting for admin delivery.`,'');
          setTimeout(()=>{location.href=`/payment-success?provider=paypal&order=${encodeURIComponent(out.orderNumber||'')}`},500);
        }catch(e){paypalStatus(`${e.message||'PayPal payment confirmation failed.'} If PayPal shows a completed charge, contact support and include the PayPal order ID ${data.orderID}.`,'error')}
      },
      onCancel:()=>paypalStatus('PayPal checkout was cancelled. No order was created for delivery.','info'),
      onError:err=>{console.error('PayPal button error',err);paypalStatus('PayPal could not complete the checkout. Try again or use bank transfer.','error')}
    }).render('#paypal-button-container');
  }catch(e){console.error('PayPal init',e);paypalConfig={enabled:false};updatePayPalAmountNote();paypalStatus(e.message||'PayPal is currently unavailable.','error')}
}
function renderSummary(){
  const rows=pricing.items.length?pricing.items:items.map(x=>({name:x.name,qty:x.qty,unitPrice:Number(x.price||0)}));
  $('#topTotal').textContent=money(pricing.total);
  $('#orderLines').innerHTML=rows.map(x=>`<div class="order-row"><span>${x.name} × ${x.qty}</span><strong>${money(Number(x.unitPrice||0)*Number(x.qty||1))}</strong></div>`).join('')+`${pricing.discount>0?`<div class="order-discount"><span>Coupon ${pricing.coupon?.code||''}</span><strong>- ${money(pricing.discount)}</strong></div>`:''}<div class="order-total"><span>Total</span><strong>${money(pricing.total)}</strong></div>`;
  const free=pricing.total===0;
  $('#paymentHeading').textContent=free?'Free Order':'Secure payment';
  $('#paymentSub').textContent=free?'Your total is zero after Premium or coupon discount.':'Pay with Apple Pay, PayPal, or bank transfer.';
  $('#applePayBox').classList.toggle('hidden',free);$('#paypalBox').classList.toggle('hidden',free);$('#bankBox').classList.toggle('hidden',free);$('#receiptBox').classList.toggle('hidden',free);$('#submitReceipt').textContent=free?'Place Free Order →':'I Have Paid — Upload Receipt →';updatePayPalAmountNote();updateApplePayAmountNote();
}
async function refreshPricing(code=localStorage.getItem('eleven_coupon')||'',showMessage=false){
  const msg=$('#checkoutCouponMessage');if(showMessage){msg.textContent='Checking coupon...';msg.className=''}
  try{const r=await fetch('/api/coupons/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,items:requestItems()})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Coupon could not be applied.');pricing={items:d.items||[],subtotal:Number(d.subtotal||0),discount:Number(d.discount||0),total:Number(d.total||0),coupon:d.coupon||null};if(code){localStorage.setItem('eleven_coupon',String(d.coupon?.code||code).toUpperCase());$('#checkoutCoupon').value=String(d.coupon?.code||code).toUpperCase();if(showMessage){msg.textContent=`Coupon applied. You saved ${money(pricing.discount)}.`;msg.className='coupon-ok'}}else{localStorage.removeItem('eleven_coupon');if(showMessage){msg.textContent='';msg.className=''}}renderSummary();return true}catch(e){if(code){if(showMessage){msg.textContent=e.message;msg.className='coupon-error'}localStorage.removeItem('eleven_coupon')}pricing={items:[],subtotal:items.reduce((a,x)=>a+Number(x.price||0)*Number(x.qty||1),0),discount:0,total:items.reduce((a,x)=>a+Number(x.price||0)*Number(x.qty||1),0),coupon:null};renderSummary();return false}}
async function loadDiscord(){try{const r=await fetch('/api/auth/discord');const d=await r.json();if(!d.connected){location.replace('/login?next=%2Fcheckout');return}discord=d.user;$('#connectDiscord').classList.add('hidden');$('#discordUser').classList.remove('hidden');$('#discordUser').textContent=`@${discord.username}${d.premiumActive?' · PREMIUM':''}`;const logout=$('#logoutCustomer');if(logout)logout.classList.remove('hidden');await refreshPricing(localStorage.getItem('eleven_coupon')||'',false)}catch{location.replace('/login?next=%2Fcheckout')}}
setupCountries();renderSummary();$('#checkoutCoupon').value=localStorage.getItem('eleven_coupon')||'';loadDiscord();initPayPal();
$('#applyCheckoutCoupon').onclick=async()=>{const code=$('#checkoutCoupon').value.trim().toUpperCase();if(!code){localStorage.removeItem('eleven_coupon');await refreshPricing('',true);return}await refreshPricing(code,true)};
$('#connectDiscord').onclick=()=>location.href='/auth/discord?next=%2Fcheckout';
const logoutCustomer=$('#logoutCustomer');if(logoutCustomer)logoutCustomer.onclick=async()=>{try{await fetch('/api/auth/logout',{method:'POST'})}finally{location.href='/login?next=%2Fcheckout'}};
$('#continue').onclick=()=>{try{validateCheckoutFields();unlocked=true;$('#paymentArea').classList.remove('locked');document.querySelector('.payment-section').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){alert(e.message)}};
$('#receipt').addEventListener('change',()=>{const f=$('#receipt').files[0],name=$('#fileName');if(!f){name.classList.add('hidden');name.textContent='';return}name.textContent=f.name;name.classList.remove('hidden')});
$('#submitReceipt').onclick=async()=>{
  if(!unlocked)return;const total=Number(pricing.total||0),message=$('#receiptMessage');message.classList.add('hidden');message.classList.remove('error','order-processing');const phone=fullPhone();const couponCode=localStorage.getItem('eleven_coupon')||'';const btn=$('#submitReceipt'),idleText=total===0?'Place Free Order →':'I Have Paid — Upload Receipt →';btn.disabled=true;btn.textContent=total===0?'Placing order...':'Uploading...';
  try{
    let r;
    if(total===0){r=await fetch('/api/checkout/free-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,email:$('#email').value.trim(),items:requestItems(),couponCode})})}
    else{const file=$('#receipt').files[0];if(!file)throw new Error('Please attach your payment receipt.');const form=new FormData();form.append('phone',phone);form.append('countryCode',`+${selectedCode()}`);form.append('email',$('#email').value.trim());form.append('items',JSON.stringify(requestItems()));form.append('couponCode',couponCode);form.append('receipt',file);r=await fetch('/api/checkout/bank-transfer',{method:'POST',body:form})}
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Request failed.');message.innerHTML=total===0?`Order <strong>#${d.orderNumber}</strong> has been created and delivered to your history.`:`Order <strong>#${d.orderNumber}</strong> is now processing. Please wait for confirmation.`;message.classList.remove('hidden');message.classList.add('order-processing');localStorage.removeItem('eleven_cart');localStorage.removeItem('eleven_coupon')
  }catch(err){message.textContent=err.message;message.classList.remove('hidden');message.classList.add('error')}finally{btn.disabled=false;btn.textContent=idleText}
};
