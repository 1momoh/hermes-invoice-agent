// Shared helpers: money formatting and the header rate chip (live FX with fixed fallback).
window.H={fx:null,
 money(v,cur='USD'){const s={USD:'$',NGN:'₦',KES:'KSh ',GHS:'GH₵',ZAR:'R ',INR:'₹'}[cur]??cur+' ';return s+Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})},
 rate(c){return H.fx?.currencies?.[c]},
 async loadFx(demo){try{H.fx=demo?{settle:'USD',provider:'open.er-api.com',currencies:{NGN:{symbol:'₦',rate:1334.3,source:'live',asOf:'2026-10-26T00:02:31Z'}}}:await (await fetch('/api/fx')).json()}catch{H.fx=null}
  const el=document.getElementById('rate');if(!el)return;const n=H.rate('NGN');
  if(!n){el.hidden=true;return}
  el.innerHTML=`<span>$1 = <b>₦${n.rate.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></span><span class="src">${n.source==='live'?'live · '+H.fx.provider:'fixed rate'}</span>`;
  el.title=`${n.source==='live'?'Live rate from '+H.fx.provider+(n.asOf?', updated '+new Date(n.asOf).toUTCString():''):'Fixed fallback rate (NGN_PER_USD)'}. ${H.fx.reason||''}`;
  el.setAttribute('aria-label',el.title)},
 toast(t){const el=document.getElementById('toast');el.textContent=t;el.classList.add('show');clearTimeout(H._t);H._t=setTimeout(()=>el.classList.remove('show'),6000)}};

/* Optional owner key. Public visitors use the sandbox demo with no sign-in. The owner opens any page with ?key=…
   (stored in localStorage, then stripped from the URL) or uses the Owner link; it goes out as a Bearer token on /api/*.
   The sign-in sheet only appears if the server answers 401 (live PayPal mode, where the demo is off). */
(()=>{const KEY='hia_code',demo=location.search.includes('demo'),raw=window.fetch.bind(window);let waiting=null;
 const code=()=>localStorage.getItem(KEY)||'';
 function sheet(msg){if(waiting)return waiting;waiting=new Promise(done=>{
  const d=document.createElement('div');d.className='gate';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-labelledby','gh');
  d.innerHTML=`<form class="receipt gatecard"><div class="rh"><span>Hermes</span><span>Private ledger</span></div><h2 id="gh">Owner sign-in</h2><p class="gp">Owner access code. It stays on this device. Without it you can still try the sandbox demo.</p>
   <label for="gc" class="sr">Access code</label><input id="gc" type="password" autocomplete="current-password" placeholder="Access code" required>
   <p class="gerr" role="alert"></p><button class="btn primary">Sign in</button><button type="button" class="btn gx">Not now</button></form>`;
  document.body.appendChild(d);d.querySelector('.gx').onclick=()=>{d.remove();waiting=null;done()};const f=d.querySelector('form'),i=d.querySelector('input'),e=d.querySelector('.gerr');if(msg)e.textContent=msg;i.focus();
  f.onsubmit=async ev=>{ev.preventDefault();const b=f.querySelector('button');b.disabled=true;e.textContent='';
   let r;try{r=await raw('/api/auth',{method:'POST',headers:{Authorization:'Bearer '+i.value.trim()}})}catch{r=null}b.disabled=false;
   if(r&&r.ok){localStorage.setItem(KEY,i.value.trim());d.remove();waiting=null;done()}
   else{e.textContent=!r?'Couldn’t reach the server. Try again.':r.status===429?'Too many tries. Wait a minute.':r.status===503?'This server has no access code configured yet.':'That code didn’t work.';i.select()}}});return waiting}
 window.fetch=async(u,o={})=>{const url=String(u);if(!url.startsWith('/api/')||demo)return raw(u,o);
  const go=()=>raw(u,{...o,headers:{...(o.headers||{}),...(code()?{Authorization:'Bearer '+code()}:{})}});
  let r=await go();if(r.status===401){localStorage.removeItem(KEY);await sheet('Your access code was rejected. Enter it again.');r=await go()}return r};
 H.signOut=()=>{localStorage.removeItem(KEY);location.reload()};
 /* SSE can't send headers: get a short-lived signed token, reconnect with a fresh one on error. */
 H.events=handlers=>{let es,t;const open=async()=>{try{const r=await fetch('/api/events/token',{method:'POST'});const j=await r.json();if(!j.token)throw 0;
   es=new EventSource('/api/events?t='+encodeURIComponent(j.token));for(const k in handlers)es.addEventListener(k,handlers[k]);
   es.onerror=()=>{es.close();clearTimeout(t);t=setTimeout(open,5000)}}catch{clearTimeout(t);t=setTimeout(open,15000)}};open()};
 const k=new URLSearchParams(location.search).get('key');if(k){localStorage.setItem(KEY,k);const u=new URL(location.href);u.searchParams.delete('key');history.replaceState(null,'',u)}
 H.owner=()=>!!code();H.signIn=()=>sheet();
 /* demo note + owner link, in the header */
 addEventListener('DOMContentLoaded',()=>{const top=document.querySelector('.top');if(!top||demo)return;const n=document.createElement('span');n.className='demo';
  n.innerHTML=code()?'<b>Owner</b> <button type="button" class="lnk">Sign out</button>':'<b>Sandbox demo</b><span class="dx">, try it</span> <button type="button" class="lnk">Owner</button>';
  n.title=code()?'Signed in with the owner key: all actions allowed.':'Public sandbox demo. Anyone can try it; invoices, reminders and cancellations only go to @example.com addresses. No real money moves.';
  n.querySelector('button').onclick=()=>code()?H.signOut():sheet().then(()=>location.reload());top.insertBefore(n,top.querySelector('.tabs'))})})();
