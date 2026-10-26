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
