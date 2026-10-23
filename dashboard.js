// ============================================================
// IPMI Whiteboard dashboard
//
// Shows the WHITEBOARD Google Sheet to signed-in, approved people.
// The "Whiteboard sync" Apps Script sends the sheet to Supabase every
// 10 minutes (see whiteboard-sync/ and whiteboard.sql). This page signs
// you in with your IPMI Tasks account, checks the approved list, then
// reads the latest copy. No data from the sheet is stored in this file.
// ============================================================

// Builds the dashboard model from the WHITEBOARD workbook. Pure: (XLSX, base64, today "YYYY-MM-DD") -> model
function computeModel(XLSX, b64, todayStr){
  const wb = XLSX.read(b64, {type:'base64'});
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [ty,tm,td] = todayStr.split('-').map(Number);
  const dn = (y,m,d)=>Math.round(Date.UTC(y,m-1,d)/864e5);
  const TODAY = dn(ty,tm,td);
  const ymd = n=>{const d=new Date(n*864e5);return [d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()]};
  const fmt = n=>{const [,m,d]=ymd(n);return MON[m-1]+' '+d};
  const U = v=>String(v==null?'':v).trim().toUpperCase();
  const S = v=>String(v==null?'':v).replace(/\s+/g,' ').trim();
  function dateOf(v){
    if(v==null||v==='') return null;
    if(typeof v==='number' && v>20000 && v<80000){const p=XLSX.SSF.parse_date_code(v);return dn(p.y,p.m,p.d)}
    const s=String(v).trim().match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
    if(!s) return null;
    let y=+s[3]; if(y<100) y+=2000;
    return dn(y,+s[1],+s[2]);
  }
  const valid = n=>n!=null && n>=dn(2025,1,1) && n<=TODAY+400;
  const DIR = new Set(['n','n.','north','s','s.','south','e','e.','east','w','w.','west']);
  function key(a){
    const w=S(a).toLowerCase().replace(/[^a-z0-9#. ]/g,' ').split(/\s+/).filter(Boolean);
    if(!w.length||!/^\d+$/.test(w[0])) return null;
    let i=1; while(i<w.length && DIR.has(w[i])) i++;
    return w[0]+' '+(w[i]||'');
  }
  const short = a=>S(a).replace(/\s+(Street|St|Avenue|Ave|Court|Ct|Drive|Dr|Way|Place|Pl|Circle|Cir|Road|Rd|Lane|Ln)\b\.?/i,'').replace(/\s+/g,' ');
  function rows(name){
    const ws=wb.Sheets[name]; if(!ws) return [];
    return XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  }
  // Same rows, each with its 1-based row number in the sheet (n), so every record can link to its source row
  function rowsN(name){
    const ws=wb.Sheets[name]; if(!ws||!ws['!ref']) return [];
    const r0=XLSX.utils.decode_range(ws['!ref']).s.r;
    return XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}).map((r,i)=>({r,n:r0+i+1}));
  }
  const cols={}; wb.SheetNames.forEach(nm=>{const ws=wb.Sheets[nm]; if(ws&&ws['!ref']) cols[nm]=XLSX.utils.encode_col(XLSX.utils.decode_range(ws['!ref']).e.c)});
  const fmtFull = n=>{const [y,m,d]=ymd(n);return MON[m-1]+' '+d+', '+y};
  const DONE = new Set(['DONE','COMPLETED','YES','TRUE','RBP','N/A','NO HOA','INVOICES']);
  const NA = new Set(['N/A','NO HOA']);
  const PEND = ['SCHEDULED','ORDER','PARTIAL','PROGRESS','WORK ORDER','PENDING','READY TO REGISTER'];

  // Property checks
  const checks = rowsN('Property Check').slice(1).map(({r,n})=>({a:S(r[0]),k:key(r[0]),d:dateOf(r[1]),who:U(r[2]),n})).filter(c=>c.k&&valid(c.d));

  // Move-ins (dedupe: same property within 90 days keeps the later row)
  const miRaw = rowsN('Move In').slice(1).filter(({r})=>key(r[0])&&dateOf(r[1])!=null).map(({r,n})=>({a:S(r[0]),k:key(r[0]),d:dateOf(r[1]),r,n}));
  const moveIns=[];
  miRaw.forEach(m=>{const i=moveIns.findIndex(x=>x.k===m.k&&Math.abs(x.d-m.d)<90); if(i>=0) moveIns[i]=m; else moveIns.push(m)});
  const lastMoveIn = k=>Math.max(-Infinity,...moveIns.filter(m=>m.k===k&&m.d<=TODAY).map(m=>m.d));
  const STAGES=[['Move-in photos',4],['Confirmation email',6],['HOA registered',8],['Tenant logged',9],['Welcome letter',10],['Renters insurance',7],['Scanned & saved',11]];
  const thisYear = moveIns.filter(m=>ymd(m.d)[0]===ty && m.d<=TODAY);
  const upcomingIn = moveIns.filter(m=>m.d>TODAY).sort((a,b)=>a.d-b.d).map(m=>{
    const app=STAGES.filter(([,i])=>!NA.has(U(m.r[i]))); const done=app.filter(([,i])=>DONE.has(U(m.r[i]))).length;
    const pend=app.some(([,i])=>PEND.some(p=>U(m.r[i]).includes(p)));
    return {a:m.a,d:m.d,date:fmt(m.d),done,total:app.length,pend,days:m.d-TODAY,n:m.n}});
  const checklistRows = moveIns.filter(m=>m.d<=TODAY && m.d>=dn(ty,1,1)).map(m=>({d:m.d,v:STAGES.map(([,i])=>DONE.has(U(m.r[i])))}));
  const noInsurance = thisYear.filter(m=>U(m.r[7])==='NO').map(m=>short(m.a));
  const byMonth = MON.slice(0,Math.max(tm,1)).map((l,i)=>({l,n:moveIns.filter(m=>{const[y,mm]=ymd(m.d);return y===ty&&mm===i+1}).length,sched:i+1===tm&&moveIns.some(m=>{const[y,mm]=ymd(m.d);return y===ty&&mm===i+1&&m.d>TODAY})}));
  // quarter comparison: last complete quarter vs the one before
  const q=Math.floor((tm-1)/3); const qCount=(y,qq)=>moveIns.filter(m=>{const[yy,mm]=ymd(m.d);return yy===y&&Math.floor((mm-1)/3)===qq}).length;
  let lq=q-1,ly=ty; if(lq<0){lq=3;ly--} let pq=lq-1,py=ly; if(pq<0){pq=3;py--}
  const qa=qCount(ly,lq), qb=qCount(py,pq);
  const qDelta = qb? Math.round((qa-qb)/qb*100):null;

  // Move-outs
  const mo = rowsN('Move Out').slice(1).filter(({r})=>key(r[0])).map(({r,n})=>({a:S(r[0]),k:key(r[0]),d:dateOf(r[1]),type:/lease/i.test(r[2])?'Lease break':'Traditional',status:S(r[3]),n}));
  const moUpcoming = mo.filter(m=>m.d!=null&&m.d>TODAY).sort((a,b)=>a.d-b.d);
  const moRecent = mo.filter(m=>m.d==null||(m.d<=TODAY&&m.d>=TODAY-60)).sort((a,b)=>(a.d??TODAY)-(b.d??TODAY));

  // Cancellations
  const cxRows = rowsN('Cancellation').slice(1).filter(({r})=>key(r[0])||(S(r[0])&&S(r[1]||r[2])));
  const RL = {'SALE':'Owner sold','NEW PM':'New PM company','OWNER SELF':'Self-managing','BROKER TERM':'Broker term','OWNER TERM':'Owner term'};
  const cxList = cxRows.map(({r,n})=>({a:S(r[0]),k:key(r[0]),reason:RL[U(r[1])]||RL[U(r[2])]||(S(r[1])||S(r[2])||'Other'),n}));
  const cxRow = {}; cxList.forEach(c=>{if(c.k) cxRow[c.k]=c.n});
  const cxKeys = new Set(cxList.map(c=>c.k).filter(Boolean));
  const cxCount={}; cxList.forEach(c=>cxCount[c.reason]=(cxCount[c.reason]||0)+1);
  const cx = Object.entries(cxCount).sort((a,b)=>b[1]-a[1]);

  // Turnover (maintenance sheet + past move-outs without a row)
  const TCOL=[2,6,8,10,12,13];
  const maint = rowsN('Move out Maintenance').slice(1).filter(({r})=>key(r[0])).map(({r,n})=>{
    const ready=U(r[15])==='TRUE'; const app=TCOL.filter(i=>!NA.has(U(r[i])));
    const done=app.filter(i=>DONE.has(U(r[i]))).length; const target=dateOf(r[14])??(String(r[14]).match(/^\d{1,2}\/\d{1,2}$/)?dn(ty,...String(r[14]).split('/').map(Number)):null);
    return {a:S(r[0]),k:key(r[0]),pct:ready?100:app.length?Math.round(done/app.length*100):0,ready,overdue:!ready&&target!=null&&target<TODAY,target,n}});
  const maintKeys=new Set(maint.map(m=>m.k));
  const noTurn = mo.filter(m=>m.d!=null&&m.d<=TODAY&&m.d>=TODAY-60&&!maintKeys.has(m.k)&&!/SALE/i.test(m.status)&&!cxKeys.has(m.k));
  const turnover = maint.map(m=>({a:short(m.a),pct:m.pct,ready:m.ready,overdue:m.overdue,src:['Move out Maintenance',m.n]})).concat(noTurn.map(m=>({a:short(m.a),pct:0,ready:false,overdue:false,missing:true,src:['Move Out',m.n]}))).sort((a,b)=>b.pct-a.pct);

  // Vacancies
  const vac = rowsN('Vacancies').slice(1).filter(({r})=>key(r[0])).map(({r,n})=>{
    const raw=S(r[1]); const nums=raw.match(/\$?\s*([\d,]+(?:\.\d+)?)/g); const rent=nums?Number(nums[nums.length-1].replace(/[^\d.]/g,'')):(typeof r[1]==='number'?r[1]:null);
    const note=raw.replace(/\$?\s*[\d,]+(\.\d+)?/g,'').trim();
    const k=key(r[0]); const lmi=lastMoveIn(k);
    const after=checks.filter(c=>c.k===k&&c.d>lmi).map(c=>c.d);
    const out=mo.filter(m=>m.k===k&&m.d!=null&&m.d>lmi&&m.d<=TODAY).map(m=>m.d);
    const starts=[...after,...out]; const start=starts.length?Math.min(...starts):null;
    const allChecks=checks.filter(c=>c.k===k); const lastC=allChecks.length?allChecks.reduce((x,y)=>(y.d>x.d||(y.d===x.d&&y.n>x.n))?y:x):null; const last=lastC?lastC.d:null;
    return {a:S(r[0]),k,rent,note:note?note.replace(/\b\w+/g,w=>w[0]+w.slice(1).toLowerCase()):(cxKeys.has(k)?'Account cancelling':''),
      days:start!=null?TODAY-start:null,last:last!=null?fmt(last):null,lastAgo:last!=null?TODAY-last:null,app:S(r[2]),cancelling:cxKeys.has(k),n,lastN:lastC?lastC.n:null,cxN:cxRow[k]||null}}).sort((a,b)=>(b.days??-1)-(a.days??-1));
  const rents=vac.map(v=>v.rent).filter(x=>x!=null);

  // Lead sources
  const tr=rows('New Tenants Tracker 2026'); const hi=tr.findIndex(r=>/lead found/i.test(r[0]));
  const LS={'ZILLOW.COM':'Zillow','ZILLOW':'Zillow','AGENT FOUND':'Agent found','REALTOR':'Realtor','OTHER':'Owner / other','':'Not recorded'};
  const leadsC={}; tr.slice(hi+1).filter(r=>S(r[1])).forEach(r=>{const l=LS[U(r[0])]||S(r[0]);leadsC[l]=(leadsC[l]||0)+1});
  let leads=Object.entries(leadsC).sort((a,b)=>b[1]-a[1]);
  if(leads.length>6){const rest=leads.slice(5).reduce((s,x)=>s+x[1],0);leads=leads.slice(0,5).concat([['Other sites',rest]])}

  // Property checks per month (last 13 months)
  const pc=[]; for(let i=12;i>=0;i--){let m=tm-i,y=ty;while(m<1){m+=12;y--} pc.push({l:MON[m-1][0],full:MON[m-1]+' '+y,n:checks.filter(c=>{const[yy,mm]=ymd(c.d);return yy===y&&mm===m}).length})}
  const lastFull=pc[pc.length-1].n>0?pc[pc.length-1]:pc[pc.length-2];
  const who=[...new Set(checks.filter(c=>c.d>=TODAY-60).map(c=>c.who).filter(Boolean))].slice(0,3);

  // Onboarding
  const np=rows('New Properties').slice(1).filter(r=>key(r[0])&&!/CANCEL/.test(U(r[5])));
  const step=(i,skip)=>{const app=np.filter(r=>!NA.has(U(r[i]))&&!(skip&&skip(r)));return [app.filter(r=>DONE.has(U(r[i]))&&!NA.has(U(r[i]))).length,app.length]};
  const onboarding=[['Listing photos',...step(2)],['Added to HOA sheet',...step(4,r=>U(r[3])==='NO HOA')],['HOA registered',...step(3)],['Scanned & saved',...step(7)]];

  // Alerts
  const alerts=[];
  upcomingIn.filter(u=>u.days<=7&&u.done<u.total).forEach(u=>alerts.push(['bad',`${short(u.a)} move-in ${u.date} · ${u.done} of ${u.total} tasks done`,'Move In',u.n]));
  vac.filter(v=>v.days>90).forEach(v=>alerts.push(['bad',`${short(v.a)} vacant ${v.days} days`,'Vacancies',v.n]));
  maint.filter(m=>m.overdue).forEach(m=>alerts.push(['bad',`${short(m.a)} turnover past ${fmt(m.target)} target`,'Move out Maintenance',m.n]));
  noTurn.forEach(m=>alerts.push(['warn',`${short(m.a)} · no turnover started`,'Move Out',m.n]));
  vac.filter(v=>v.cancelling).forEach(v=>alerts.push(['warn',`${short(v.a)} · vacant & cancelling`,v.cxN?'Cancellation':'Vacancies',v.cxN||v.n]));
  if(noInsurance.length) alerts.push(['warn',`${noInsurance.length} tenants · no renters ins.`,'Move In',null]);
  vac.filter(v=>v.lastAgo==null||v.lastAgo>14).forEach(v=>alerts.push(['warn',`${short(v.a)} · ${v.lastAgo==null?'no property check logged':'last checked '+v.lastAgo+' days ago'}`,'Property Check',v.lastN]));

  const busiest = moUpcoming.length? Object.entries(moUpcoming.reduce((o,m)=>(o[m.d]=(o[m.d]||0)+1,o),{})).sort((a,b)=>b[1]-a[1])[0]:null;
  return {
    today:todayStr, todayLabel:fmt(TODAY)+', '+ty, year:ty,
    kpi:{vacant:vac.length, unleased:rents.reduce((s,x)=>s+x,0), avgRent:rents.length?Math.round(rents.reduce((s,x)=>s+x,0)/rents.length):0,
      ytd:thisYear.length, upcomingIn:upcomingIn.length, qDelta, qLabel:'Q'+(lq+1), moAhead:moUpcoming.length, busiest:busiest?{n:busiest[1],date:fmt(+busiest[0])}:null, lost:cxList.length},
    alerts:alerts.slice(0,7),
    vac, upcomingIn, moUpcoming:moUpcoming.map(m=>({a:m.a,date:fmt(m.d),type:m.type,status:m.status,d:m.d-TODAY,n:m.n})),
    moRecent:moRecent.map(m=>{const t=maint.find(x=>x.k===m.k);const sale=/SALE/i.test(m.status);
      const st= t?(t.ready?['up','Ready to list']:t.overdue?['down','Turnover overdue']:['amber','Turnover '+t.pct+'%']): sale?['amber','Sale']: cxKeys.has(m.k)?['amber','Account ended']:['down','No turnover row'];
      return {a:m.a,date:m.d!=null?fmt(m.d):'Date ?',type:m.type,tag:st,n:m.n,tn:t?t.n:null}}),
    checklist:{stages:STAGES.map(s=>s[0]),rows:checklistRows},
    byMonth, leads, cx, turnover, pc, pcLast:lastFull, who, onboarding, onbCount:np.length, cols,
    pcAll:checks.slice().sort((a,b)=>b.d-a.d||b.n-a.n).map(c=>{const [y,mm]=ymd(c.d);return {a:c.a,dl:fmtFull(c.d),m:MON[mm-1]+' '+y,who:c.who,n:c.n}}),
    timeline:[...upcomingIn.filter(u=>u.days<=60).map(u=>({d:u.days,t:'in',l:u.date})),
      ...Object.entries(moUpcoming.filter(m=>m.d-TODAY<=60).reduce((o,m)=>(o[m.d]=(o[m.d]||0)+1,o),{})).map(([d,n])=>({d:+d-TODAY,t:'out',l:fmt(+d)+(n>1?` (${n})`:'')}))]
  };
}


const FILE_ID='1Gxgagz7ACAMTT3rbEQYTY8ueOQvlawtIisQcNuNnmjU';
// Tab IDs in the WHITEBOARD sheet, so a link opens the right tab and selects the record's row.
// If a tab is deleted and re-created it gets a new ID; update it here.
const TAB_GID={'New Properties':1152984969,'Vacancies':611341358,'Move In':715685743,'New Tenants Tracker 2026':308544989,'Move Out':1782034959,'Move out Maintenance':0,'Cancellation':25246440,'Property Check':112152292};
const SHEET_URL=`https://docs.google.com/spreadsheets/d/${FILE_ID}/edit`;
function sheetHref(tab,n){const g=TAB_GID[tab];if(g==null)return SHEET_URL;let u=`${SHEET_URL}?gid=${g}#gid=${g}`;if(n){const lc=(MODEL&&MODEL.cols&&MODEL.cols[tab])||'A';u+=`&range=A${n}:${lc}${n}`}return u}
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>'$'+Math.round(n).toLocaleString('en-US');
const PAL=['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)'];
const col=p=>p>=85?'var(--up)':p>=60?'var(--amber)':'var(--down)';
const chev='<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
const hues=['#dfe9c6','#d6dbea','#e8efd8','#cfd5e6','#e3e8f2','#d2e3a8','#dde1ec','#c9d3e8'];
const thumb=i=>`<span class="thumb" style="background:${hues[i%hues.length]}"><svg viewBox="0 0 32 32"><path d="M5 16L16 7l11 9" fill="none" stroke="#1a2039" stroke-width="2"/><rect x="9" y="15" width="14" height="11" fill="#fdf6ea"/><rect x="14" y="19" width="4" height="7" fill="#99bf40"/></svg></span>`;
const shortA=a=>String(a).replace(/\s+(Street|St|Avenue|Ave|Court|Ct|Drive|Dr|Way|Place|Pl|Circle|Cir|Road|Rd)\b\.?/i,'');
let MODEL=null;
const extA=(href,label,cls,tip)=>`<a class="${cls} ext" href="${esc(href)}" target="_blank" rel="noopener"${tip?` title="${esc(tip)}"`:''}>${esc(label)}</a>`;
const recRow=(tab,n,label)=>n?`<div>${label||'Source'} ${extA(sheetHref(tab,n),tab+' · row '+n,'rec','Open '+tab+', row '+n+' in the WHITEBOARD sheet')}</div>`:'';

function item(i,title,sub,detail){return `<div class="it" data-s="${esc(title.toLowerCase())}"><button class="item" aria-expanded="false">${thumb(i)}<span><b>${esc(title)}</b><span class="sub">${esc(sub)}</span></span>${chev}</button><div class="detail" hidden>${detail}</div></div>`}
function cols(id,xid,data,max,hi,pick){$(id).style.gridTemplateColumns=$(xid).style.gridTemplateColumns=`repeat(${data.length},minmax(0,1fr))`;
 const tag=pick?'button':'div';
 $(id).innerHTML=data.map((d,i)=>`<${tag} class="c${pick?' pick':''}"${pick?` type="button" data-i="${i}" aria-pressed="${i===pick.sel}" aria-label="${esc(d.full||d.l)}: ${d.n} ${pick.unit}"`:''} title="${esc(d.full||d.l)}: ${d.n}"><span class="v">${d.n}</span><span class="bar ${d.sched?'s':''} ${i===hi?'hi':''}" style="height:${max?Math.max(d.n?3:0,d.n/max*118):0}px"></span></${tag}>`).join('');
 $(xid).innerHTML=data.map(d=>`<span>${esc(d.l)}</span>`).join('')}
function donut(id,rows,label){const total=rows.reduce((s,r)=>s+r[1],0);let acc=0;const stops=rows.map(([,n],i)=>{const a=acc/total*360;acc+=n;return `${PAL[i%6]} ${a}deg ${acc/total*360}deg`}).join(',');
 $(id).innerHTML=`<div class="donut" style="background:${total?`conic-gradient(${stops})`:'var(--soft)'}"><div class="ctr"><b>${total}</b><span>${label}</span></div></div><div class="lg">${rows.map(([k,n],i)=>`<div><i style="background:${PAL[i%6]}"></i><span>${esc(k)}</span><span class="k">${n}</span></div>`).join('')}</div>`}
function prog(id,rows){$(id).innerHTML=rows.length?rows.map(([a,p,val,c,href,tip])=>`<div class="hr">${href?`<a class="lbl" href="${esc(href)}" target="_blank" rel="noopener"${tip?` title="${esc(tip)}"`:''}>${esc(a)}</a>`:`<span class="lbl">${esc(a)}</span>`}<span class="tr"><b style="width:${Math.max(p,3)}%;background:${c||col(p)}"></b></span><span class="val">${esc(val)}</span></div>`).join(''):'<p class="empty">Nothing in progress.</p>'}

function renderFunnel(){const m=MODEL,per=$('period').value;const y=m.year;const T=Date.UTC(...m.today.split('-').map((v,i)=>i===1?v-1:+v))/864e5;
 const rng={all:[-1e9,1e9],d90:[T-90,T],q1:[Date.UTC(y,0,1)/864e5,Date.UTC(y,3,1)/864e5-1],q2:[Date.UTC(y,3,1)/864e5,Date.UTC(y,6,1)/864e5-1],q3:[Date.UTC(y,6,1)/864e5,Date.UTC(y,9,1)/864e5-1]}[per];
 const rows=m.checklist.rows.filter(r=>r.d>=rng[0]&&r.d<=rng[1]);const n=rows.length;
 let h=`<div class="fr"><span class="k"><i>i</i>Moved in</span><span class="p">100%</span><span class="n">${n}</span><span class="bw"><span class="bar hatch"></span></span></div>`;
 h+=m.checklist.stages.map((t,i)=>{const d=rows.filter(r=>r.v[i]).length;const p=n?d/n*100:0;const miss=n-d;const cls=!n?'g':p<70?'r':p<90?'a':'g';
  return `<div class="fr"><span class="k"><i>i</i>${esc(t)}</span><span class="p">${Math.round(p)}%</span><span class="n">${d}</span><span class="bw"><span class="bar" style="width:${p*0.72}%;background:${p<70?'var(--down)':p<90?'var(--amber)':'var(--up)'}"></span><span class="drop ${cls}">${!n?'No move-ins':miss?`−${miss} not done`:'All done'}</span></span></div>`}).join('');
 $('fun').innerHTML=h}

function render(m){
 MODEL=m;const k=m.kpi;
 $('asof').textContent=`Integrity Property Management · Las Vegas, NV · as of ${m.todayLabel}`;
 $('kVac').textContent=k.vacant;$('kVacTag').textContent=`$${(k.unleased/1000).toFixed(1)}k/mo`;
 $('kYtdL').textContent=`Move-ins ${m.year}`;$('kYtd').textContent=k.ytd;
 const qt=$('kYtdTag');if(k.qDelta==null){qt.hidden=true}else{qt.hidden=false;qt.className='tag '+(k.qDelta>=0?'up':'down');qt.textContent=`${k.qDelta>=0?'↑':'↓'} ${Math.abs(k.qDelta)}% ${k.qLabel}`}
 $('kMo').textContent=k.moAhead;const bt=$('kMoTag');if(k.busiest){bt.hidden=false;bt.textContent=`${k.busiest.n} on ${k.busiest.date}`}else bt.hidden=true;
 $('kRent').textContent=money(k.avgRent);$('kRentTag').textContent=`${k.vacant} units`;
 $('alerts').innerHTML=m.alerts.length?m.alerts.map(([c,t,tab,n])=>tab?`<a class="alert ${c} ext" href="${esc(sheetHref(tab,n))}" target="_blank" rel="noopener" title="${esc(n?'Open '+tab+', row '+n:'Open the '+tab+' tab')}">${esc(t)}</a>`:`<span class="alert ${c}">${esc(t)}</span>`).join(''):'<span class="alert info">Nothing needs attention right now</span>';
 // hero
 $('heroN').textContent=m.pcLast?m.pcLast.n:0;$('heroL').textContent=`Property checks in ${m.pcLast?m.pcLast.full.split(' ')[0]:'the last month'}`;
 const avc=['#c6dc93','#ffffff','#d6dbea'];$('heroAv').innerHTML=(m.who.length?m.who:['IP']).map((w,i)=>`<i style="background:${avc[i%3]}">${esc(w)}</i>`).join('');
 $('acts').innerHTML=`<span title="Move-ins this year">${k.ytd}</span><span title="Vacant">${k.vacant}</span><span title="Move-outs ahead">${k.moAhead}</span>`;
 // sidebar
 $('upCount').textContent=m.upcomingIn.length;$('vacCount').textContent=m.vac.length;
 $('moCount').textContent=m.moUpcoming.length+m.moRecent.length;$('moUpL').textContent=`Upcoming · ${m.moUpcoming.length}`;$('moRecL').textContent=`Recent (60 days) · ${m.moRecent.length}`;
 $('upList').innerHTML=m.upcomingIn.map((u,i)=>item(i,u.a,'Move-in '+u.date,`<div>Checklist <span class="tag ${u.done===u.total?'up':u.days<=7?'down':'amber'}">${u.done} of ${u.total} done${u.pend?' · some scheduled':''}</span></div>${recRow('Move In',u.n)}`)).join('')||'<p class="empty">No move-ins scheduled.</p>';
 $('vacList').innerHTML=m.vac.map((v,i)=>item(i+2,v.a,v.rent!=null?money(v.rent)+'/mo':'Rent not set',`<div>Days vacant <b>${v.days??'Unknown'}</b></div>${v.last&&v.lastN?`<div>Last check ${extA(sheetHref('Property Check',v.lastN),v.last,'rec','Open Property Check, row '+v.lastN+' in the WHITEBOARD sheet')}</div>`:`<div>Last check <b>${v.last??'None logged'}</b></div>`}${v.app?`<div>Application <b>${esc(v.app)}</b></div>`:''}${v.note?`<div>Note <b>${esc(v.note)}</b></div>`:''}${recRow('Vacancies',v.n)}`)).join('')||'<p class="empty">No vacancies.</p>';
 $('outList').innerHTML=m.moUpcoming.map((o,i)=>item(i+4,o.a,o.type+' · '+o.date,`<div>Status <b>${esc(o.status||'Notice on file')}</b></div><div>In <b>${o.d} days</b></div>${recRow('Move Out',o.n)}`)).join('')||'<p class="empty">None scheduled.</p>';
 $('doneList').innerHTML=m.moRecent.map((o,i)=>item(i+1,o.a,o.type+' · '+o.date,`<div>Status <span class="tag ${o.tag[0]}">${esc(o.tag[1])}</span></div>${recRow('Move Out',o.n)}${recRow('Move out Maintenance',o.tn,'Turnover')}`)).join('')||'<p class="empty">None in the last 60 days.</p>';
 document.querySelectorAll('.item').forEach(b=>b.addEventListener('click',()=>{const o=b.classList.toggle('open');b.setAttribute('aria-expanded',o);b.nextElementSibling.hidden=!o}));
 filterList();
 renderFunnel();
 // vacancy bars
 const maxD=Math.max(1,...m.vac.map(v=>v.days||0));
 $('vacBars').innerHTML=m.vac.map(v=>{const d=v.days;const c=d==null?'var(--grey)':d>90?'var(--down)':d>45?'var(--amber)':'var(--up)';
  return `<div class="hr">${v.n?`<a class="lbl" href="${esc(sheetHref('Vacancies',v.n))}" target="_blank" rel="noopener" title="Open Vacancies, row ${v.n}">${esc(shortA(v.a))}</a>`:`<span class="lbl">${esc(shortA(v.a))}</span>`}<span class="tr"><b style="width:${d==null?100:Math.max(3,d/maxD*100)}%;background:${c};${d==null?'opacity:.35':''}"></b></span><span class="val">${d==null?'—':d+'d'}</span></div>`}).join('')||'<p class="empty">No vacancies.</p>';
 // timeline
 const pos=d=>Math.min(100,Math.max(0,d/60*100));
 const labels=['Today','+15d','+30d','+45d','+60d'];
 $('tl').innerHTML='<div class="axis"></div><div class="today"></div><div class="scale"></div>'+
  [0,15,30,45,60].map((d,i)=>`<span class="tm" style="left:${pos(d)}%"></span><span class="gl ${i===0?'first':''}" style="${i===4?'right:0;transform:none':'left:'+pos(d)+'%'}">${i===0?'Today, '+m.todayLabel.replace(/, \d+$/,''):dayLabel(m,d)}</span>`).join('')+
  m.timeline.map(e=>`<span class="dot ${e.t}" style="left:${pos(e.d)}%"></span><span class="ev ${e.t}" style="${pos(e.d)>88?'right:0;transform:none':'left:'+pos(e.d)+'%'}">${esc(e.l)}</span>`).join('');
 // charts
 $('miTitle').textContent=`${m.year} · striped = scheduled`;
 cols('miCols','miX',m.byMonth,Math.max(1,...m.byMonth.map(x=>x.n)),-1);
 renderPC();
 $('pcSub').textContent=`Per month, ${m.pc[0].full.replace(/ 20(\d\d)/," '$1")} – ${m.pc[m.pc.length-1].full.replace(/ 20(\d\d)/," '$1")}`;
 donut('leadDonut',m.leads,'tenants');donut('cxDonut',m.cx,'accounts');
 prog('turnBars',m.turnover.map(t=>[shortA(t.a),t.pct,t.missing?'Not started':t.ready?'Ready':t.overdue?'Overdue':t.pct+'%',t.overdue?'var(--down)':null,t.src&&t.src[1]?sheetHref(t.src[0],t.src[1]):null,t.src&&t.src[1]?'Open '+t.src[0]+', row '+t.src[1]:null]));
 prog('onbBars',m.onboarding.map(([t,d,n])=>[t,n?Math.round(d/n*100):0,`${d}/${n}`]));
 $('onbSub').textContent=`${m.onbCount} active properties`;
}
let pcSel=null; // month ("Sep 2026") whose checks are listed, or null
function renderPC(){const m=MODEL;const pcMax=Math.max(1,...m.pc.map(x=>x.n));
 if(pcSel&&!m.pc.some(x=>x.full===pcSel)) pcSel=null;
 const si=pcSel?m.pc.findIndex(x=>x.full===pcSel):-1;
 cols('pcCols','pcX',m.pc,pcMax,si>=0?si:m.pc.indexOf(m.pc.find(x=>x.full===m.pcLast.full)),{sel:si,unit:'checks'});
 $('pcCols').querySelectorAll('.pick').forEach(b=>b.addEventListener('click',()=>{const f=m.pc[+b.dataset.i].full;pcSel=pcSel===f?null:f;$('pcQ').value='';renderPC()}));
 renderPCList()}
function renderPCList(){const m=MODEL;const raw=$('pcQ').value.trim();const q=raw.toLowerCase();const all=m.pcAll||[];let list,head;
 if(q){list=all.filter(c=>c.a.toLowerCase().includes(q));head=`${list.length} check${list.length===1?'':'s'} matching “${raw}”`}
 else if(pcSel){list=all.filter(c=>c.m===pcSel);head=`${pcSel} · ${list.length} check${list.length===1?'':'s'}`}
 else{$('pcBox').hidden=true;$('pcHint').hidden=false;return}
 $('pcBox').hidden=false;$('pcHint').hidden=true;$('pcHead').textContent=head;
 $('pcList').innerHTML=list.length?list.map(c=>`<li><a href="${esc(sheetHref('Property Check',c.n))}" target="_blank" rel="noopener" title="Open Property Check, row ${c.n} in the WHITEBOARD sheet"><b>${esc(c.a)}</b><span>${esc(c.dl)}${c.who?' · '+esc(c.who):''}</span><em class="ext">Row ${c.n}</em></a></li>`).join(''):`<li class="none">${q?'No checks match that address.':'No checks logged in '+esc(pcSel)+'.'}</li>`}
function dayLabel(m,d){const [y,mo,da]=m.today.split('-').map(Number);const t=new Date(Date.UTC(y,mo-1,da+d));return t.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}
function filterList(){const q=$('q').value.toLowerCase().trim();document.querySelectorAll('.it').forEach(el=>el.hidden=!!q&&!el.dataset.s.includes(q))}
$('q').addEventListener('input',filterList);
$('pcQ').addEventListener('input',()=>{if($('pcQ').value.trim())pcSel=null;renderPC()});
$('pcClear').addEventListener('click',()=>{pcSel=null;$('pcQ').value='';renderPC();$('pcQ').focus()});
document.querySelectorAll('a[data-tab]').forEach(a=>{const t=a.dataset.tab;a.href=sheetHref(t);a.title=t?`Open the ${t} tab in the WHITEBOARD sheet`:'Open the WHITEBOARD sheet in Google Sheets'});
$('period').addEventListener('change',renderFunnel);

// ============================================================
// Sign-in, approved list and data
// ============================================================

// ---- Status bar ----
function setStatus(kind,text,detail){const s=$('status');s.className='status '+kind;$('statusT').textContent=text;$('statusD').textContent=detail||''}
const lvToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const timeStr=ms=>new Date(ms).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' PT';

const CHECK_EVERY_MS = 2 * 60 * 1000; // look for a newer copy every 2 minutes while the page is open
const SYNC_MINUTES = 10;              // how often the sheet sends a copy (whiteboard-sync/Code.gs)
const STALE_MINUTES = 30;             // warn when no copy has arrived for this long

const VIEWS = ['authView', 'gateView', 'appView'];
const show = (id) => VIEWS.forEach((v) => { $(v).hidden = v !== id; });

let db = null;
let userId = null;       // whose session the dashboard is showing
let shownAt = null;      // updated_at of the copy on screen
let reachedOk = true;    // did the last check reach Supabase?
let readFailed = false;  // was the newest copy unreadable?
let recovering = false;  // on the "choose a new password" step
let busy = false;
let timers = [];

// An expired or reused email link comes back with an error in the address
const linkError = new URLSearchParams(location.hash.slice(1)).get('error_description');

const GATES = {
  loading: ['Loading the whiteboard…', ''],
  denied:  ["This account can't open the whiteboard", ''],
  setup:   ["The whiteboard isn't set up yet", "Supabase doesn't have the dashboard tables yet. Run whiteboard.sql in the Supabase SQL editor, then check again."],
  empty:   ['Waiting for the WHITEBOARD sheet', `The sheet hasn't sent a copy yet. Run syncWhiteboard in the Whiteboard sync script, or wait up to ${SYNC_MINUTES} minutes. This page checks again by itself.`],
  error:   ["Couldn't load the whiteboard", ''],
  shape:   ["Couldn't read the WHITEBOARD sheet", "The sheet arrived, but its tabs or columns have changed in a way this page can't read. Check that the tab names and columns are as they were."],
  tools:   ["Couldn't load the page", 'Part of the page did not load. Check your connection, then reload.'],
};

function showGate(kind, detail) {
  const [title, text] = GATES[kind];
  $('gateTitle').textContent = title;
  $('gateText').textContent = detail || text;
  $('gateRetry').hidden = !['denied', 'setup', 'empty', 'error', 'shape'].includes(kind);
  $('gateSignOut').hidden = kind === 'loading' || kind === 'tools';
  show('gateView');
}

function authMsg(text, isError) {
  const el = $('authMsg');
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.toggle('err', !!isError);
}

function friendlyError(error) {
  const code = (error && error.code) || '';
  if (code === 'invalid_credentials') return "That email and password don't match. Check them, or tap Forgot password.";
  if (code === 'email_not_confirmed') return 'Confirm your email first: open the link in the email you were sent, then sign in here.';
  if (code === 'user_already_exists') return 'That email already has an account. Sign in instead, or tap Forgot password.';
  if (code === 'weak_password') return 'Choose a stronger password with at least 8 characters.';
  if (code === 'same_password') return 'That is your current password. Choose a different one.';
  if (/rate_limit/.test(code) || (error && error.status === 429)) return 'Too many tries. Wait a minute, then try again.';
  return (error && error.message) || 'Something went wrong. Try again.';
}

const isMissing = (e) => !!e && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(e.code);

function cleanUrl() {
  if (/access_token|refresh_token|error_description|type=recovery/.test(location.hash)) {
    history.replaceState(null, '', location.pathname);
  }
}

function showAuth(mode) {
  stopTimers();
  const recovery = mode === 'recovery';
  $('signInForm').hidden = recovery;
  $('newPasswordForm').hidden = !recovery;
  $('authSub').textContent = recovery
    ? 'Choose a new password. You will use it here and in IPMI Tasks.'
    : 'Sign in with your IPMI Tasks account to see the dashboard.';
  show('authView');
  if (recovery) $('newPassword').focus();
}

// ---- After sign-in: check the approved list, then load the sheet ----
async function start(user) {
  if (userId === user.id && timers.length) { refresh(false); return; }
  stopTimers();
  userId = user.id;
  shownAt = null;
  $('who').textContent = user.email || '';
  $('who').title = user.email ? 'Signed in as ' + user.email : '';
  showGate('loading');

  const { data, error } = await db.rpc('can_view_whiteboard');
  if (userId !== user.id) return; // signed out meanwhile
  if (error) {
    console.error(error);
    if (isMissing(error)) showGate('setup');
    else showGate('error', friendlyError(error) + ' Check your connection and try again.');
    return;
  }
  if (data !== true) {
    showGate('denied', `You're signed in as ${user.email}. Only people on the approved list can see the whiteboard. Ask Wendy to add this email, then check again.`);
    return;
  }
  await refresh(true);
  startTimers();
}

async function refresh(force) {
  if (busy || !userId) return;
  busy = true;
  try {
    // A small check first; the sheet itself is only downloaded when it has changed
    const head = await db.from('whiteboard').select('updated_at').eq('id', 1).maybeSingle();
    if (head.error) throw head.error;
    reachedOk = true;
    if (!head.data) {
      // Either nothing has been sent yet, or this account was just taken off the list
      if (MODEL) location.reload(); else showGate('empty');
      return;
    }
    if (force || head.data.updated_at !== shownAt || (MODEL && MODEL.today !== lvToday())) {
      const full = await db.from('whiteboard').select('workbook, updated_at').eq('id', 1).maybeSingle();
      if (full.error) throw full.error;
      if (!full.data) { if (MODEL) location.reload(); else showGate('empty'); return; }
      let model;
      try {
        model = computeModel(XLSX, full.data.workbook, lvToday());
      } catch (e) {
        console.error(e);
        readFailed = true;
        if (MODEL) paintStatus(); else showGate('shape');
        return;
      }
      readFailed = false;
      render(model);
      shownAt = full.data.updated_at;
      show('appView');
    }
    paintStatus();
  } catch (e) {
    console.error(e);
    reachedOk = false;
    if (MODEL) paintStatus();
    else if (isMissing(e)) showGate('setup');
    else showGate('error', friendlyError(e) + ' Check your connection and try again.');
  } finally {
    busy = false;
  }
}

function paintStatus() {
  if (!shownAt) return;
  const at = Date.parse(shownAt);
  if (!reachedOk) setStatus('warn', 'Refresh delayed', `Couldn't reach Supabase just now. Showing the copy from ${timeStr(at)}.`);
  else if (readFailed) setStatus('warn', 'Sync problem', `The newest copy of the sheet couldn't be read. Showing the copy from ${timeStr(at)}.`);
  else if (Date.now() - at > STALE_MINUTES * 60000) setStatus('warn', 'Not updating', `The sheet last sent a copy at ${timeStr(at)}. Check that the Whiteboard sync script is still running.`);
  else setStatus('live', 'Live', `Synced with the WHITEBOARD sheet · ${timeStr(at)}`);
}

function startTimers() {
  stopTimers();
  timers.push(setInterval(() => refresh(false), CHECK_EVERY_MS));
  // Once a minute: keep the "synced" time honest, and roll the day counts over at midnight
  timers.push(setInterval(() => { if (MODEL && MODEL.today !== lvToday()) refresh(true); else paintStatus(); }, 60 * 1000));
}

function stopTimers() {
  timers.forEach(clearInterval);
  timers = [];
}

async function signOut() {
  stopTimers();
  try { await db.auth.signOut({ scope: 'local' }); } catch (e) { console.error(e); }
  // Reload so nothing from the sheet stays on this screen
  location.replace(location.pathname);
}

async function retry() {
  userId = null;
  stopTimers();
  const { data } = await db.auth.getSession();
  if (data && data.session) start(data.session.user); else showAuth();
}

function onAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') { recovering = true; cleanUrl(); showAuth('recovery'); return; }
  if (recovering) return; // stay on the new-password step until it's saved
  if (session && session.user) {
    cleanUrl();
    start(session.user);
  } else {
    userId = null;
    showAuth();
    if (linkError) { cleanUrl(); authMsg('That email link has expired or was already used. Request a new one below.', true); }
  }
}

// ---- Forms and buttons ----
function init() {
  $('signInForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    authMsg('Signing in…');
    const { error } = await db.auth.signInWithPassword({
      email: $('authEmail').value.trim(),
      password: $('authPassword').value,
    });
    authMsg(error ? friendlyError(error) : '', !!error);
  });

  $('signUpBtn').addEventListener('click', async () => {
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    if (!email || password.length < 8) {
      authMsg('Enter your email and a password of at least 8 characters, then tap Create your account again.', true);
      return;
    }
    authMsg('Creating your account…');
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) authMsg(friendlyError(error), true);
    else if (!data.session) authMsg('Check your email and open the confirmation link, then come back and sign in.');
    else authMsg('');
  });

  $('forgotBtn').addEventListener('click', async () => {
    const email = $('authEmail').value.trim();
    if (!email) { authMsg('Type your email above, then tap Forgot password.', true); $('authEmail').focus(); return; }
    authMsg('Sending a reset link…');
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    authMsg(error ? friendlyError(error) : `If ${email} has an account, a reset link is on its way. Open it on this device.`, !!error);
  });

  $('newPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('newPassword').value;
    if (password.length < 8) { authMsg('Use at least 8 characters.', true); return; }
    authMsg('Saving…');
    const { error } = await db.auth.updateUser({ password });
    if (error) { authMsg(friendlyError(error), true); return; }
    recovering = false;
    authMsg('');
    $('newPassword').value = '';
    const { data } = await db.auth.getSession();
    if (data && data.session) start(data.session.user); else showAuth();
  });

  $('gateRetry').addEventListener('click', retry);
  $('gateSignOut').addEventListener('click', signOut);
  $('signOutBtn').addEventListener('click', signOut);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && timers.length) refresh(false); });

  if (!window.supabase || !window.XLSX || typeof SUPABASE_URL === 'undefined') { showGate('tools'); return; }
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  // Defer so Supabase finishes its own work before we query
  db.auth.onAuthStateChange((event, session) => setTimeout(() => onAuth(event, session), 0));
}

init();
