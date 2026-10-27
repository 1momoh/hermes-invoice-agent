const today=new Date().toISOString().slice(0,10),q=location.search,demo=q.includes('demo');let api,rate=1500;
const open=s=>['SENT','UNPAID','PARTIALLY_PAID','SCHEDULED'].includes(s),isOverdue=r=>open(r.status)&&r.due&&r.due<today,isPaid=s=>s==='PAID'||s==='MARKED_AS_PAID';
const ngn=v=>'₦'+Math.round(Number(v||0)*rate).toLocaleString('en-US');
const LABEL={MARKED_AS_PAID:'PAID',PARTIALLY_PAID:'PART PAID'};
function grid(){const theme=agGrid.themeQuartz.withParams({backgroundColor:'#fcfaf5',foregroundColor:'#1a1814',headerBackgroundColor:'#fcfaf5',headerTextColor:'#4a463f',
 borderColor:'#ebe4d6',rowBorder:{style:'solid',width:1,color:'#ebe4d6'},headerRowBorder:{style:'solid',width:1,color:'#1a1814'},columnBorder:false,
 rowHoverColor:'#f3eee4',accentColor:'#b3301a',fontFamily:"'JetBrains Mono',ui-monospace,monospace",fontSize:13,headerFontSize:12,headerFontWeight:500,
 rowHeight:48,headerHeight:48,wrapperBorder:false,wrapperBorderRadius:0,oddRowBackgroundColor:'#fcfaf5',spacing:8,cellHorizontalPadding:24,chromeBackgroundColor:'#fcfaf5',iconSize:12});
 api=agGrid.createGrid(document.getElementById('grid'),{theme,domLayout:'autoHeight',suppressCellFocus:false,
 columnDefs:[{field:'number',headerName:'No.',width:96},
  {field:'recipient',headerName:'Client',flex:1,minWidth:200,cellStyle:{fontFamily:"'Fraunces',Georgia,serif",fontSize:'15px'}},
  {field:'status',headerName:'Status',width:136,cellRenderer:p=>{const s=isOverdue(p.data)?'OVERDUE':p.value;const c=isPaid(s)?'paid':s==='OVERDUE'?'overdue':s==='CANCELLED'?'void':'';return `<span class="tag ${c}">${LABEL[s]||s.replace(/_/g,' ')}</span>`}},
  {field:'amount',headerName:'USD',width:120,type:'rightAligned',valueFormatter:p=>H.money(p.value)},
  {colId:'1',headerName:'NGN',width:136,type:'rightAligned',valueGetter:p=>Number(p.data.amount||0)*rate,valueFormatter:p=>ngn(p.value/rate),cellStyle:{color:'#69635a'}},
  {field:'due',headerName:'Due',width:128,sort:'asc'},{field:'id',headerName:'PayPal ref',width:248,cellStyle:{color:'#69635a',fontSize:'12px'}}],
 defaultColDef:{sortable:true,resizable:true,suppressHeaderMenuButton:true},getRowId:p=>p.data.id,rowClassRules:{overdue:p=>isOverdue(p.data)},rowData:null});
 const fit=()=>api.setColumnsVisible(['id','1'],innerWidth>720);fit();addEventListener('resize',fit)}
function state(html){const s=document.getElementById('state');s.hidden=!html;s.innerHTML=html||'';document.getElementById('grid').hidden=!!html}
function render(rows){if(!rows.length){state('No invoices yet.<br><a class="btn primary" href="/">Send your first one from the chat</a>')}else{state('');api.setGridOption('rowData',rows)}
 const s=f=>rows.filter(f).reduce((a,x)=>a+Number(x.amount||0),0),P=s(r=>isPaid(r.status)),O=s(r=>open(r.status)),D=s(isOverdue),nO=rows.filter(r=>open(r.status)).length,nD=rows.filter(isOverdue).length;
 paid.textContent=H.money(P);out.textContent=H.money(O);od.textContent=H.money(D);od.classList.toggle('has',D>0);
 paidn.textContent=ngn(P);outn.textContent=`${ngn(O)} · ${nO} open`;odn.textContent=D?`${ngn(D)} · ${nD} late`:'Nothing late';
 upd.textContent=`${rows.length} invoices · updated ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`}
const SAMPLE=[['0001','folake@example.com','PAID','120.00','2026-10-02'],['0002','emeka@example.com','SENT','45.50','2026-10-19'],['0003','ada@example.com','MARKED_AS_PAID','10.00','2026-11-06'],
 ['0004','kunle@example.com','CANCELLED','18.00','2026-10-24'],['0005','tunde@example.com','PAID','37.47','2026-10-30'],['0006','wanjiru@example.com','SENT','92.40','2026-11-04'],['0007','bisi@example.com','SENT','27.80','2026-11-12']]
 .map(([number,recipient,status,amount,due],i)=>({id:'INV2-'+['7V9F','K2PQ','YVUC','M4TR','DM4C','Q8LB','H3ZN'][i]+'-4NG6-NMKV',number,recipient,status,amount,due}));
async function load(){if(demo)return render(SAMPLE);
 try{const r=await (await fetch('/api/invoices')).json();if(!Array.isArray(r))throw Error(r.error||'unknown error');render(r)}
 catch(e){state('Couldn’t reach PayPal, so the ledger is empty for now.<br><button class="btn" id="rt">Try again</button>');document.getElementById('rt').onclick=load;upd.textContent='Offline';
  for(const id of ['paid','out','od'])document.getElementById(id).textContent='·'}}
const lib=()=>new Promise((ok,no)=>{const t=document.createElement('script');t.src='/vendor/ag-grid/ag-grid-community.min.js';t.onload=ok;t.onerror=no;document.body.appendChild(t)});
addEventListener('load',async()=>{await H.loadFx(demo);rate=H.rate('NGN')?.rate||rate;try{await lib()}catch{return state('Couldn’t load the table. <button class="btn" id="rl">Reload</button>'),document.getElementById('rl').onclick=()=>location.reload()}grid();load();
 if(!q.includes('nolive')){H.events({invoices:e=>render(JSON.parse(e.data)),invoice:e=>{H.toast(JSON.parse(e.data).text);load()}})}});
