
(()=>{
  const html=`
  <button id="supportFab" class="support-fab" type="button" aria-label="Support chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.75h14a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-8l-4.7 3.2c-.55.37-1.3-.02-1.3-.68v-2.52a2 2 0 0 1-2-2v-7.5a2 2 0 0 1 2-2Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/></svg></button>
  <section id="supportPanel" class="support-panel hidden" aria-live="polite">
    <div class="support-panel-head">
      <div>
        <strong>Technical Support</strong>
        <small>مساعد تلقائي، ويقدر فريق الدعم يستلم المحادثة عند الحاجة.</small>
      </div>
      <button id="supportClose" type="button" aria-label="Close">×</button>
    </div>
    <div id="supportMessages" class="support-messages"></div>
    <form id="supportForm" class="support-form">
      <textarea id="supportInput" rows="3" maxlength="1200" placeholder="Write your message..."></textarea>
      <div class="support-form-row">
        <small id="supportState">Ready</small>
        <button id="supportSend" type="submit">Send</button>
      </div>
    </form>
  </section>`;
  document.body.insertAdjacentHTML('beforeend', html);

  const $=s=>document.querySelector(s);
  const fab=$('#supportFab'), panel=$('#supportPanel'), closeBtn=$('#supportClose'), messages=$('#supportMessages'), form=$('#supportForm'), input=$('#supportInput'), state=$('#supportState');
  const tokenKey='eleven_support_token';
  let token=localStorage.getItem(tokenKey);
  if(!token){ token=(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-f0-9-]/gi,''); localStorage.setItem(tokenKey,token); }
  let polling=0, opened=false;

  const labelMap={customer:'أنت',support:'الدعم',ai:'المساعد'};
  function timeText(v){ try{return new Date(v).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});}catch{return ''} }
  function bubble(msg){
    const mine=msg.from==='customer';
    const cls=mine?'mine':msg.from==='ai'?'ai':'support';
    const safe=(msg.message||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
    return `<article class="msg ${cls}"><div class="msg-meta"><span>${labelMap[msg.from]||'Support'}</span><time>${timeText(msg.createdAt)}</time></div><p>${safe.replace(/\n/g,'<br>')}</p></article>`;
  }
  function scrollDown(){ messages.scrollTop=messages.scrollHeight; }
  async function loadThread(){
    try{
      const res=await fetch(`/api/support/thread/${encodeURIComponent(token)}`);
      const data=await res.json();
      const list=data.thread?.messages||[];
      messages.innerHTML=list.length?list.map(bubble).join(''):`<div class="support-empty">ابدأ محادثتك مع الدعم الفني.</div>`;
      if(data.thread?.claimedBy)state.textContent=`استلمها ${data.thread.claimedBy.name||'الدعم'}`;else if(data.thread?.aiEnabled===false)state.textContent='بانتظار الدعم';else state.textContent='متصل';
      if(opened) scrollDown();
    }catch(e){ state.textContent='Connection error'; }
  }
  async function sendMessage(text){
    state.textContent='Sending...';
    const res=await fetch('/api/support/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,message:text})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.message||'Could not send message');
    const list=data.thread?.messages||[];
    messages.innerHTML=list.map(bubble).join('');
    scrollDown();
    state.textContent=(data.thread?.claimedBy?'تم استلام المحادثة من الدعم':data.thread?.aiEnabled===false?'بانتظار الدعم':'تم الرد');
  }
  function setOpen(value=true){opened=Boolean(value);panel.classList.toggle('hidden',!opened);fab.classList.toggle('active',opened);if(opened){loadThread().then(scrollDown);setTimeout(()=>input?.focus(),80)}}
  fab.addEventListener('click',()=>setOpen(!opened));
  window.openElevenSupport=()=>setOpen(true);
  document.addEventListener('click',e=>{if(e.target.closest('[data-open-support]')){e.preventDefault();setOpen(true)}});
  closeBtn.addEventListener('click',()=>{opened=false; panel.classList.add('hidden'); fab.classList.remove('active');});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const text=input.value.trim();
    if(!text) return;
    input.value='';
    try{ await sendMessage(text); }catch(err){ state.textContent=err.message||'Send failed'; }
  });
  loadThread();
  polling=window.setInterval(()=>{ if(opened) loadThread(); }, 7000);
})();
