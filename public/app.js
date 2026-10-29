let session=null,lastFx=null,lastDesc='';const log=document.getElementById('log'),inp=document.getElementById('i'),q=location.search,demo=q.includes('demo');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now=()=>new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const name=e=>(e||'').split('@')[0].replace(/[._-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
function wrap(c){const d=document.createElement('div');d.className='m '+c;log.appendChild(d);requestAnimationFrame(()=>log.scrollTop=log.scrollHeight);return d}
function add(t,c='a'){const d=wrap(c);d.innerHTML='<div class="b"></div>';d.firstChild.textContent=t;return d}

/* safe markdown: escape everything first, then add a small whitelist of tags */
function inl(t){return esc(t).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g,'$1<em>$2</em>')}
function md(src){const L=String(src??'').replace(/\r/g,'').split('\n'),o=[];let i=0;const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
 while(i<L.length){const l=L[i];
  if(/^\s*\|.*\|\s*$/.test(l)&&/^\s*\|?\s*:?-{2,}/.test(L[i+1]||'')){const h=cells(l);i+=2;const rows=[];while(i<L.length&&/^\s*\|.*\|\s*$/.test(L[i]))rows.push(cells(L[i++]));
   o.push(`<div class="tw"><table><thead><tr>${h.map(c=>`<th>${inl(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${h.map((hh,k)=>`<td data-h="${esc(hh)}">${inl(r[k]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);continue}
  if(/^\s*([-*•]|\d+[.)])\s+/.test(l)){const ol=/^\s*\d/.test(l),it=[];while(i<L.length&&/^\s*([-*•]|\d+[.)])\s+/.test(L[i]))it.push(L[i++].replace(/^\s*([-*•]|\d+[.)])\s+/,''));
   o.push(`<${ol?'ol':'ul'}>${it.map(x=>`<li>${inl(x)}</li>`).join('')}</${ol?'ol':'ul'}>`);continue}
  const hm=l.match(/^\s*#{1,6}\s+(.*)/);if(hm){o.push(`<p class="mh">${inl(hm[1])}</p>`);i++;continue}
  if(/^\s*(-{3,}|\*{3,})\s*$/.test(l)){o.push('<hr>');i++;continue}
  if(!l.trim()){i++;continue}
  const p=[];while(i<L.length&&L[i].trim()&&!/^\s*(\||[-*•]\s|\d+[.)]\s|#)/.test(L[i]))p.push(inl(L[i++]));if(!p.length)p.push(inl(L[i++]));o.push(`<p>${p.join('<br>')}</p>`)}
 return o.join('')}
function addMd(t){const d=wrap('a');d.innerHTML=`<div class="b md">${md(t)}</div>`;return d}
function typing(){const d=wrap('a typing');d.setAttribute('aria-label','Hermes is typing');d.innerHTML='<div class="b"><i></i><i></i><i></i></div>';return d}
function fxLine(f){if(!f)return '';if(f.from==='USD')return `<div class="fx"><b>${esc(H.money(f.usd))} USD, no conversion needed</b>${f.assumed?'<br>no currency given, so Hermes assumed USD':''}</div>`;const r=f.rate.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 return `<div class="fx"><b>${esc(H.money(f.amount,f.from))} → ${esc(H.money(f.usd))} USD</b><br>rate ${esc(f.symbol.trim())}${r}/$, ${f.source==='live'?'live':'fixed'}. PayPal settles in USD</div>`}
function receipt(o){return `<div class="receipt">${o.stamp?`<span class="stamp ${o.stamp==='PAID'?'paid':''}">${o.stamp}</span>`:''}<div class="rh"><span>${esc(o.head)}</span><span>${esc(o.no||'')}</span></div>
 ${o.who?`<p class="who">${esc(o.who)}</p>`:''}${(o.lines||[]).map(([a,b])=>`<div class="line"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('')}
 ${o.total?`<div class="line tot"><span>Total</span><span>${esc(o.total)}</span></div>`:''}${o.fx||''}</div>`}
async function post(u,b){const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...b,session})});const j=await r.json().catch(()=>({error:'The server sent an unreadable reply.'}));return j}
/* agent trace */
const KIND={think:'MODEL',tool:'CALL',fx:'FX',guard:'GATE',act:'PAYPAL'};
const KEYS={recipient_email:'to',recipient:'to',amount:'amount',currency:'currency',due_date:'due',description:'for',status:'status',id:'invoice'};
function tdetail(s){const d=s.detail;if(!d)return '';let o=null;if(/^\s*\{/.test(d))try{o=JSON.parse(d)}catch{}
 if(o&&typeof o==='object'){const ks=Object.keys(o).sort((x,y)=>(Object.keys(KEYS).indexOf(x)+99)%99-(Object.keys(KEYS).indexOf(y)+99)%99);
  return `<dl class="kv">${ks.map(k=>`<dt>${esc(KEYS[k]||k.replace(/_/g,' '))}</dt><dd${k==='status'?' class="st"':''} title="${esc(String(o[k]))}">${esc(typeof o[k]==='object'?JSON.stringify(o[k]):String(o[k]))}</dd>`).join('')}</dl>`}
 return s.k==='fx'?`<span class="math">${esc(d)}</span>`:`<span class="d">${esc(d)}</span>`}
function tstep(s){return `<li class="st-${esc(s.k)}"><span class="k">${KIND[s.k]||esc(s.k)}</span><span class="l">${esc(s.label)}${tdetail(s)}</span><span class="t">${s.ms!=null?(s.ms>=1000?(s.ms/1000).toFixed(2)+'s':s.ms+'ms'):''}</span></li>`}
const OUT={Signed:['Signed','ok'],Discarded:['Discarded','no']};
function trace(steps,title){const el=document.getElementById('trace');if(!steps?.length)return;el.querySelector('.ph')?.remove();
 const follow=OUT[title];let run=follow&&el.lastElementChild?.classList.contains('run')?el.lastElementChild:null;
 if(!run){el.insertAdjacentHTML('beforeend',`<li class="run"><div class="rhd"><span class="q" title="${esc(title)}">${esc(title)}</span><span class="b"></span><time>${now()}</time></div><ol class="steps"></ol></li>`);run=el.lastElementChild}
 run.querySelector('.steps').insertAdjacentHTML('beforeend',steps.map(tstep).join(''));
 const b=run.querySelector('.b'),last=steps[steps.length-1];
 const [txt,cls]=follow?(title==='Signed'&&steps.some(x=>x.k==='act'&&/SENT/i.test(x.detail||''))?['Sent','ok']:follow):last.k==='guard'?['Awaiting signature','wait']:steps.some(x=>x.k==='act')?['Done','ok']:['Answered',''];
 b.textContent=txt;b.className='b '+cls;run.scrollIntoView?.({block:'nearest'})}
function traceEmpty(){document.getElementById('trace').innerHTML='<li class="ph empty">Send a message and you’ll see which model step ran, the PayPal call it chose, and where it stopped for your signature.</li>'}
function confirmCard(r){const a=r.args||{},d=wrap('a'),acts=r.actions||[{tool:r.tool,args:a,summary:r.summary}];lastFx=r.fx;lastDesc=a.description||'';
 const ivLine=x=>{const v=x.invoice;if(!v)return [x.summary,''];return ['No. '+(v.number||'none')+', '+(v.client||'client')+(v.status?', '+v.status:''),H.money(v.amount,v.currency||'USD')]};
 if(r.tool!=='create_and_send_invoice'||acts.length>1){const reminders=acts.every(x=>x.tool==='send_reminder'),tot=acts.reduce((s,x)=>s+Number(x.invoice?.amount||0),0);
  d.innerHTML=receipt({head:'Needs your signature',no:acts.length>1?acts.length+' actions':'',who:reminders?(acts.length>1?'Send '+acts.length+' payment reminders':'Send a payment reminder'):acts.length>1?acts.length+' actions':'',lines:acts.map(ivLine),total:tot&&acts.every(x=>x.invoice)?H.money(tot):''})}
 else d.innerHTML=receipt({head:'Draft invoice',no:a.due_date?'Due '+a.due_date:'',who:a.recipient_email,lines:[[a.description,H.money(a.amount,a.currency)]],total:r.fx?H.money(r.fx.usd)+' USD':'',fx:fxLine(r.fx)});
 const rc=d.querySelector('.receipt'),row=document.createElement('div');row.className='acts';
 for(const [l,v,c] of [[acts.length>1?'Sign and send all':'Sign and send',true,'btn primary'],['Discard',false,'btn']]){const b=document.createElement('button');b.className=c;b.textContent=l;
  b.onclick=async()=>{if(demo)return;const bs=row.querySelectorAll('button');bs.forEach(x=>x.disabled=true);const old=b.textContent;if(v)b.textContent='Sending…';const t=typing();let x;
   try{x=await post('/api/confirm',{approve:v})}catch(e){x={error:'Connection failed. Check your network and try again.'}}
   t.remove();
   if(x.error&&!x.outcomes){b.textContent=old;if(!/expired/.test(x.error))bs.forEach(y=>y.disabled=false);else row.remove()}
   else{row.remove();const ok=(x.outcomes||[]).filter(o=>o.ok).length,n=(x.outcomes||[]).length;
    rc.insertAdjacentHTML('afterbegin',!v?'<span class="stamp">VOID</span>':ok===n&&n?'<span class="stamp paid">SENT</span>':ok?'<span class="stamp">PARTIAL</span>':'<span class="stamp">FAILED</span>')}
   trace(x.trace,v?'Signed':'Discarded');show(x)};row.appendChild(b)}
 rc.appendChild(row);if(!demo)row.firstChild.focus({preventScroll:true})}
function outcomesCard(x){const os=x.outcomes||[];if(!os.length)return;const ok=os.filter(o=>o.ok).length,rem=os.every(o=>o.tool==='send_reminder');
 const d=wrap('a'),lab=o=>o.invoice?'No. '+(o.invoice.number||'none')+', '+(o.invoice.client||''):o.summary;
 d.innerHTML=receipt({head:rem?'Reminders':'PayPal result',no:`${ok} of ${os.length} sent`,lines:os.map(o=>[lab(o),o.ok?'Sent':'Failed'])})+
  (os.some(o=>!o.ok)?`<div class="b err">${os.filter(o=>!o.ok).map(o=>`<p><strong>${esc(lab(o))}:</strong> ${esc(o.error||'failed')}</p>`).join('')}</div>`:'');
 d.querySelectorAll('.line span:last-child').forEach((s,k)=>s.className=os[k]?.ok?'ok':'bad');loadRecent()}
function sentCard(x){const d=wrap('a'),f=x.fx||lastFx;
 d.innerHTML=receipt({head:'Sent via PayPal',no:x.id,who:x.recipient,lines:[[lastDesc||'Invoice','Due '+(x.due_date||'')]],total:H.money(x.amount_usd)+' USD',fx:fxLine(f),stamp:'SENT'});
 if(x.pay_link){const amt=f&&f.from!=='USD'?`${H.money(f.amount,f.from)} (${H.money(f.usd)})`:H.money(x.amount_usd);
  const msg=`Hi ${name(x.recipient)}, here’s your invoice${lastDesc?' for '+lastDesc.toLowerCase():''}: ${amt}, due ${x.due_date}. You can pay securely with PayPal here: ${x.pay_link}`;
  const row=document.createElement('div');row.className='acts';
  row.innerHTML=`<a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Send on WhatsApp</a><button class="btn" type="button">Copy pay link</button>`;
  row.querySelector('button').onclick=async e=>{try{await navigator.clipboard.writeText(x.pay_link);e.target.textContent='Copied'}catch{e.target.textContent='Copy failed'}};
  d.querySelector('.receipt').appendChild(row)}
 loadRecent()}
function show(r){session=r.session||session;
 if(r.error){add('That didn’t go through. '+r.error,'e');return}
 let shown=false;const single=r.outcomes?.length===1&&r.outcomes[0].ok&&r.result?.id&&r.result?.status;
 if(single){sentCard(r.result);shown=true}
 else if(r.approved===false){add('Discarded. Nothing was sent.');shown=true}
 else if(r.outcomes?.length){outcomesCard(r);shown=true}
 if(r.kind==='reply'&&r.text&&!single){addMd(r.text);shown=true}
 if(r.kind==='confirm'){confirmCard(r);shown=true}
 if(!shown)add('Done, but Hermes had nothing to add. Check the ledger for the latest status.')}
async function send(t){t=(t||inp.value).trim();if(!t){inp.focus();return}inp.value='';add(t,'u');document.getElementById('chips').hidden=true;const ty=typing();let r;
 try{r=await post('/api/chat',{message:t});if(r.expired){session=null;r=await post('/api/chat',{message:t})}}catch{r={error:'Connection failed. Check your network and try again.'}}ty.remove();trace(r.trace,'“'+(t.length>40?t.slice(0,40)+'…':t)+'”');show(r)}
document.getElementById('f').onsubmit=e=>{e.preventDefault();send()};document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>send(c.textContent));
function paidCard(t){const d=wrap('a');d.innerHTML=receipt({head:'Payment received',no:now(),lines:[[t,'']],stamp:'PAID'})}
const SAMPLE=[{id:'INV2-DM4C-CGKR',number:'0007',recipient:'tunde@example.com',amount:'37.47',status:'PAID',due:'2026-10-30'},{id:'INV2-K2PQ-88XA',number:'0006',recipient:'wanjiru@example.com',amount:'92.40',status:'SENT',due:'2026-11-04'},{id:'INV2-YVUC-7KDS',number:'0005',recipient:'ada@example.com',amount:'10.00',status:'MARKED_AS_PAID',due:'2026-11-06'}];
function recent(rows){const el=document.getElementById('recent');
 if(!rows.length){el.innerHTML='<p class="empty">No invoices yet. Your first one will appear here the moment PayPal accepts it.</p>';return}
 el.innerHTML=rows.slice(0,3).map(x=>receipt({head:'No. '+(x.number||'none'),no:'Due '+(x.due||'not set'),who:x.recipient,total:H.money(x.amount)+' USD',stamp:/^(PAID|MARKED_AS_PAID)$/.test(x.status)?'PAID':x.status==='CANCELLED'?'VOID':''})).join('')}
async function loadRecent(){if(demo)return recent(SAMPLE);const el=document.getElementById('recent');
 try{const r=await (await fetch('/api/invoices')).json();if(!Array.isArray(r))throw Error(r.error);recent(r.slice().sort((a,b)=>String(b.number).localeCompare(String(a.number))))}
 catch(e){el.innerHTML='<p class="empty">Couldn’t reach PayPal. <button class="btn" type="button" id="rt">Try again</button></p>';document.getElementById('rt').onclick=loadRecent}}
H.loadFx(demo);loadRecent();traceEmpty();
if(demo){document.getElementById('chips').hidden=true;
 add('Bill tunde@example.com ₦50,000 for logo design, due Friday','u');
 const fx={from:'NGN',symbol:'₦',amount:50000,usd:37.47,rate:1334.3,source:'live'};
 trace([{k:'think',label:'deepseek-chat chose create_and_send_invoice',ms:1412},{k:'tool',label:'Call create_and_send_invoice',detail:'{"recipient_email":"tunde@example.com","amount":50000,"currency":"NGN","due_date":"2026-10-30"}'},{k:'fx',label:'Convert NGN → USD',detail:'50,000 ÷ 1334.3 = 37.47 (live rate)'},{k:'guard',label:'Paused for your signature',detail:'create_and_send_invoice changes money or emails a client, so it needs approval'}],'“Bill tunde@example.com ₦50,000 for logo…”');
 confirmCard({tool:'create_and_send_invoice',args:{recipient_email:'tunde@example.com',description:'Logo design',amount:50000,currency:'NGN',due_date:'2026-10-30'},fx});
 trace([{k:'guard',label:'You signed',detail:'create_and_send_invoice'},{k:'act',label:'PayPal create_and_send_invoice',detail:'{"id":"INV2-DM4C-CGKR-LXJ7-C7ZL","status":"SENT"}',ms:2210},{k:'think',label:'deepseek-chat wrote a reply',ms:960}],'Signed');
 sentCard({id:'INV2-DM4C-CGKR-LXJ7',status:'SENT',recipient:'tunde@example.com',amount_usd:'37.47',due_date:'2026-10-30',pay_link:'https://www.sandbox.paypal.com/invoice/p/#DM4CCGKRLXJ7C7ZL',fx})}
else{add('Who are we billing? Give me the client’s email, the amount in any currency, and what it’s for. I won’t send anything until you sign.');
 if(!q.includes('nolive')){const on=e=>{const x=JSON.parse(e.data).text;/paid/i.test(x)?paidCard(x):add(x);H.toast(x);loadRecent()};H.events({invoice:on,event:on})}}
