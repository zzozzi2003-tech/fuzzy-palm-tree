const cfg=window.ELEVEN_STORE||{},$=s=>document.querySelector(s);
const money=n=>`${cfg.currency||"SAR"} ${Number(n||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;
function cart(){try{return JSON.parse(localStorage.getItem("eleven_cart")||"[]")}catch{return[]}}

const items=cart();
const total=items.reduce((a,x)=>a+Number(x.price)*Number(x.qty),0);
$("#topTotal").textContent=money(total);
$("#orderLines").innerHTML=items.map(x=>`
  <div class="order-row"><span>${x.name} × ${x.qty}</span><strong>${money(Number(x.price)*Number(x.qty))}</strong></div>`
).join("")+`<div class="order-total"><span>Total</span><strong>${money(total)}</strong></div>`;

let discord=null,unlocked=false;

async function loadDiscord(){
  try{
    const r=await fetch("/api/auth/discord");
    const d=await r.json();
    if(d.connected){
      discord=d.user;
      $("#connectDiscord").classList.add("hidden");
      $("#discordUser").classList.remove("hidden");
      $("#discordUser").textContent=`@${discord.username}`;
    }
  }catch{}
}
loadDiscord();

$("#connectDiscord").onclick=()=>{ location.href="/auth/discord"; };

function validPhone(v){
  const x=v.replace(/\s+/g,"");
  return /^(05\d{8}|5\d{8})$/.test(x);
}
function validEmail(v){
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

$("#continue").onclick=()=>{
  const phone=$("#phone").value.trim();
  const email=$("#email").value.trim();
  if(!validPhone(phone))return alert("Enter a valid Saudi mobile number.");
  if(!validEmail(email))return alert("Enter a valid email address.");
  if(!discord)return alert("Connect your Discord account first.");
  unlocked=true;
  $("#paymentArea").classList.remove("locked");
  document.querySelector(".payment-title").scrollIntoView({behavior:"smooth"});
};

$("#submitReceipt").onclick=async()=>{
  if(!unlocked)return;
  if(!items.length)return alert("Your cart is empty.");
  const file=$("#receipt").files[0];
  const message=$("#receiptMessage");
  message.classList.add("hidden");message.classList.remove("error");
  if(!file){
    message.textContent="Please attach your payment receipt.";
    message.classList.remove("hidden");message.classList.add("error");return;
  }

  const form=new FormData();
  form.append("receipt",file);
  form.append("phone",$("#phone").value.trim());
  form.append("email",$("#email").value.trim());
  form.append("items",JSON.stringify(items.map(x=>({productId:x.id,qty:x.qty,option:x.option||""}))));

  const btn=$("#submitReceipt");
  btn.disabled=true;btn.textContent="Uploading...";
  try{
    const r=await fetch("/api/checkout/bank-transfer",{method:"POST",body:form});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||`Could not upload receipt (HTTP ${r.status}).`);
    message.innerHTML=`Order <strong>#${d.orderNumber}</strong> is now processing. Please wait for confirmation.`;
    message.classList.remove("hidden");
    message.classList.add("order-processing");
    localStorage.removeItem("eleven_cart");
  }catch(err){
    message.textContent=err.message;
    message.classList.remove("hidden");message.classList.add("error");
  }finally{
    btn.disabled=false;btn.textContent="I Have Paid — Upload Receipt";
  }
};