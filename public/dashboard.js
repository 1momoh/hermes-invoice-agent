const today=new Date().toISOString().slice(0,10),q=location.search,demo=q.includes('demo');let api,rate=1500;
const open=s=>['SENT','UNPAID','PARTIALLY_PAID','SCHEDULED'].includes(s),isOverdue=r=>open(r.status)&&r.due&&r.due<today,isPaid=s=>s==='PAID'||s==='MARKED_AS_PAID';
const nv=r=>r.naira??Number(r.amount||0)*rate,ngn=v=>'₦'+Math.round(Number(v||0)).toLocaleString('en-US');
const LABEL={MARKED_AS_PAID:'PAID',PARTIALLY_PAID:'PART PAID'};
function grid(){const theme=agGrid.themeQuartz.withParams({backgroundColor:'var(--color-sheet)',foregroundColor:'var(--color-ink)',headerBackgroundColor:'var(--color-sheet)',headerTextColor:'var(--color-muted)',
 borderColor:'var(--color-rule-2)',rowBorder:{style:'solid',width:1,color:'var(--color-rule-2)'},headerRowBorder:{style:'solid',width:1,color:'var(--color-ink)'},columnBorder:false,
 rowHoverColor:'var(--color-accent-soft)',accentColor:'var(--color-accent)',fontFamily:'var(--font-body)',fontSize:14,headerFontSize:13,headerFontWeight:600,
 rowHeight:48,headerHeight:48,wrapperBorder:false,wrapperBorderRadius:0,oddRowBackgroundColor:'var(--color-sheet)',spacing:8,cellHorizontalPadding:24,chromeBackgroundColor:'var(--color-sheet)',iconSize:12});
 api=agGrid.createGrid(document.getElementById('grid'),{theme,domLayout:'autoHeight',suppressCellFocus:false,
 columnDefs:[{field:'number',headerName:'No.',width:96},
  {field:'recipient',headerName:'Client',flex:1,minWidth:200,cellStyle:{fontWeight:'600'}},
  {field:'status',headerName:'Status',width:136,cellRenderer:p=>{const s=isOverdue(p.data)?'OVERDUE':p.value;const c=isPaid(s)?'paid':s==='OVERDUE'?'overdue':s==='CANCELLED'?'void':'';return `<span class="tag ${c}">${LABEL[s]||s.replace(/_/g,' ')}</span>`}},
  {field:'amount',headerName:'USD',width:120,type:'rightAligned',valueFormatter:p=>H.money(p.value)},
  {colId:'1',headerName:'NGN',width:136,type:'rightAligned',valueGetter:p=>nv(p.data),valueFormatter:p=>ngn(p.value),cellStyle:{color:'var(--color-accent)',fontWeight:'500'}},
  {field:'due',headerName:'Due',width:128,sort:'asc'},{field:'id',headerName:'PayPal ref',width:248,cellStyle:{color:'var(--color-muted)',fontFamily:'var(--font-code)',fontSize:'12px'}}],
 defaultColDef:{sortable:true,resizable:true,suppressHeaderMenuButton:true},getRowId:p=>p.data.id,rowClassRules:{overdue:p=>isOverdue(p.data)},rowData:null});
 const fit=()=>api.setColumnsVisible(['id','1'],innerWidth>720);fit();addEventListener('resize',fit)}
function state(html){const s=document.getElementById('state');s.hidden=!html;s.innerHTML=html||'';document.getElementById('grid').hidden=!!html}
function render(rows){if(!rows.length){state('No invoices yet.<br><a class="btn primary" href="/">Send your first one from the chat</a>')}else{state('');api.setGridOption('rowData',rows)}
 const s=f=>rows.filter(f).reduce((a,x)=>a+Number(x.amount||0),0),P=s(r=>isPaid(r.status)),O=s(r=>open(r.status)),D=s(isOverdue),n=f=>rows.filter(f).reduce((a,x)=>a+nv(x),0),nO=rows.filter(r=>open(r.status)).length,nD=rows.filter(isOverdue).length;
 paid.textContent=H.money(P);out.textContent=H.money(O);od.textContent=H.money(D);od.classList.toggle('has',D>0);
 paidn.textContent=ngn(n(r=>isPaid(r.status)));outn.textContent=`${ngn(n(r=>open(r.status)))} · ${nO} open`;odn.textContent=D?`${ngn(n(isOverdue))} · ${nD} late`:'Nothing late';
 upd.textContent=`${rows.length} invoices · updated ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`}
const SAMPLE=[['0001','folake@example.com','PAID','120.00','2026-10-02'],['0002','emeka@example.com','SENT','45.50','2026-10-19'],['0003','kunle@example.com','CANCELLED','18.00','2026-10-24'],
 ['0004','chidi@example.com','PAID','60.00','2026-10-27'],['0005','bisi@example.com','SENT','27.80','2026-11-12'],['0006','ada@example.com','MARKED_AS_PAID','10.00','2026-11-06'],['0007','ifeoma@example.com','PAID','25.00','2026-10-28'],
 ['0008','wanjiru@example.com','SENT','92.40','2026-11-04'],['0009','tunde@example.com','PAID','37.14','2026-10-30',50000]]
 .map(([number,recipient,status,amount,due,naira],i)=>({id:'INV2-'+['7V9F','B6WD','M4TR','P2XC','H3ZN','YVUC','R5QT','K2PQ','DM4C'][i]+'-4NG6-NMKV',number,recipient,status,amount,due,...(naira?{naira}:{})}));
async function load(){if(demo)return render(SAMPLE);
 try{const r=await (await fetch('/api/invoices')).json();if(!Array.isArray(r))throw Error(r.error||'unknown error');render(r)}
 catch(e){state('Couldn’t reach PayPal, so the ledger is empty for now.<br><button class="btn" id="rt">Try again</button>');document.getElementById('rt').onclick=load;upd.textContent='Offline';
  for(const id of ['paid','out','od'])document.getElementById(id).textContent='·'}}
const lib=()=>new Promise((ok,no)=>{const t=document.createElement('script');t.src='/vendor/ag-grid/ag-grid-community.min.js';t.onload=ok;t.onerror=no;document.body.appendChild(t)});
addEventListener('load',async()=>{await H.loadFx(demo);rate=H.rate('NGN')?.rate||rate;try{await lib()}catch{return state('Couldn’t load the table. <button class="btn" id="rl">Reload</button>'),document.getElementById('rl').onclick=()=>location.reload()}grid();load();
 if(!q.includes('nolive')){H.events({invoices:e=>render(JSON.parse(e.data)),invoice:e=>{H.toast(JSON.parse(e.data).text);load()}})}});
