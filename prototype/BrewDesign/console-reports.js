/* BrewLedger — Owner Console P4 (money & reports). Vanilla. */
(function(){
const $=(s,r=document)=>r.querySelector(s);
const B=(n,d=0)=>n==null?'—':'฿'+n.toLocaleString('th-TH',{maximumFractionDigits:d});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=(v,cls='',d=0)=>`<span class="money ${v==null?'money--unknown':cls}">${B(v,d)}</span>`;

const NAV=[['dash','หน้าหลัก'],['orders','ออเดอร์'],['quick','ขายหน้าร้าน'],['reports','รายงาน'],['setup','ตั้งค่า']];
const TABS=[['capture','สแกนบิล'],['review','ตรวจบิล'],['inventory','คลังวัตถุดิบ'],['ledger','รายการเดินบัญชี'],['pnl','กำไรขาดทุน'],['dish','กำไรต่อเมนู'],['overview','เปรียบเทียบ']];

/* ledger — amounts in satang, positive = money in */
const TXTYPE={online:'ขายออนไลน์',cash:'ขายหน้าร้าน',buy:'ซื้อวัตถุดิบ',fee:'ค่าธรรมเนียม',feeabs:'ค่าธรรมเนียม (BrewLedger ออกให้)',refund:'คืนเงิน'};
const TX=[
{t:'15:42',k:'cash',n:'ขายหน้าร้าน 3 แก้ว',id:'CS-0219',amt:17000},
{t:'14:58',k:'refund',n:'คืนเงิน · ของหมด',id:'SJ-4816',amt:-12000,link:'order'},
{t:'13:20',k:'buy',n:'ซัพพลายเออร์ ก.ไก่ เทรดดิ้ง',id:'บิล #4471',amt:-186000,link:'bill'},
{t:'11:05',k:'feeabs',n:'ค่าธรรมเนียมช่วงเช้า',id:'',amt:-2500},
{t:'10:31',k:'online',n:'ออเดอร์ล่วงหน้า · มิ้นท์',id:'SJ-4823',amt:12000,link:'order'},
{t:'09:47',k:'cash',n:'ขายหน้าร้าน 2 แก้ว',id:'CS-0218',amt:11000},
{t:'08:52',k:'online',n:'ออเดอร์ล่วงหน้า · ต้น',id:'SJ-4822',amt:12000,link:'order'},
{t:'08:14',k:'online',n:'ออเดอร์ล่วงหน้า · พลอย',id:'SJ-4821',amt:14500,link:'order'},
{t:'07:38',k:'cash',n:'ขายหน้าร้าน 1 แก้ว',id:'CS-0217',amt:5500}];
const TX_CASH=[
{t:'15:10',k:'cash',n:'ขายหน้าร้าน 2 แก้ว',id:'CS-0224',amt:11500},
{t:'12:26',k:'cash',n:'ขายหน้าร้าน 4 แก้ว',id:'CS-0223',amt:23000},
{t:'10:02',k:'buy',n:'ร้านนมสดสหกรณ์',id:'บิล #4468',amt:-54000,link:'bill'},
{t:'08:41',k:'cash',n:'ขายหน้าร้าน 3 แก้ว',id:'CS-0222',amt:16500}];
const MONTH_REST=[[15,14,72400,0],[14,11,58200,12000],[13,17,88100,64000],[12,12,61300,0],[11,8,39800,25500],[10,15,77600,0],[9,13,64900,142000],[8,10,52100,0],[7,16,81200,31000],[6,9,44300,0],[5,14,70500,58000]];
const dayRows=()=>S.dev.emptyDay?[]:S.dev.cashOnly?TX_CASH:TX;
const dayIn=r=>r.filter(x=>x.amt>0).reduce((a,x)=>a+x.amt,0);
const dayOut=r=>r.filter(x=>x.amt<0&&x.k!=='feeabs').reduce((a,x)=>a+x.amt,0);
const monthRows=()=>{const r=dayRows();return [[16,r.length,dayIn(r),-dayOut(r)],...MONTH_REST]};

const DISHES=[
{n:'ลาเต้เย็น',u:180,rev:13500,c:18,tracked:true},
{n:'อเมริกาโน่',u:210,rev:11550,c:11,tracked:true},
{n:'ชาไทย',u:96,rev:4800,c:14,tracked:true},
{n:'คาปูชิโน่',u:64,rev:3840,c:19,tracked:true},
{n:'ครัวซองต์เนยสด',u:52,rev:3380,c:38,tracked:true},
{n:'มัทฉะลาเต้',u:41,rev:2870,c:null,tracked:false},
{n:'บราวนี่',u:33,rev:1815,c:null,tracked:false},
{n:'เอสเพรสโซ่',u:28,rev:1260,c:null,tracked:false},
{n:'โกโก้',u:22,rev:1210,c:null,tracked:false},
{n:'ลาเต้เย็นหวานน้อยพิเศษเพิ่มช็อต',u:14,rev:1050,c:null,tracked:false}];

const INV=[
{n:'เมล็ดกาแฟคั่วกลาง',cost:'฿420/กก.',stock:'3.2 กก.',days:4.5,last:'12 ส.ค.'},
{n:'นมสด',cost:'฿45/ลิตร',stock:'6 ลิตร',days:1.5,last:'15 ส.ค.'},
{n:'ผงชาไทย',cost:'฿350/กก.',stock:'1.8 กก.',days:9,last:'2 ส.ค.'},
{n:'แก้ว 16 ออนซ์',cost:'฿2.20/ใบ',stock:'240 ใบ',days:6,last:'8 ส.ค.'},
{n:'นมข้นหวาน',cost:'฿62/กระป๋อง',stock:'-2 กระป๋อง',days:null,last:'—',neg:true}];

const BILL={vendor:'ซัพพลายเออร์ ก.ไก่ เทรดดิ้ง',date:'16 ส.ค. 2569',items:[
{n:'นมสด ตราหมี 1 ลิตร',q:12,u:'ขวด',up:45,conf:'high'},
{n:'เมล็ดกาแฟคั่วกลาง 1 กก.',q:2,u:'ถุง',up:420,conf:'high'},
{n:'น้ำตาลทราย 1 กก.',q:5,u:'ถุง',up:26,conf:'low'},
{n:'แก้ว 16 ออนซ์ (50 ใบ)',q:4,u:'แพ็ค',up:110,conf:'low'}]};

const S={screen:'pnl',period:'30',elapsed:0,capture:'idle',ledger:'day',
dev:{noRecipe:false,partial:true,allUntracked:false,manual:false,emptyInv:false,zeroBase:false,emptyDay:false,cashOnly:false,txLoading:false}};
let capTimer=null;

const top=(t,sub)=>`<header class="oc-top"><div><h1>${t}</h1>${sub?`<p class="note-plain">${sub}</p>`:''}</div></header>`;
const tabs=()=>`<div class="oc-subnav">${TABS.map(([k,l])=>`<button data-go="${k}" class="${S.screen===k?'is-active':''}">${l}</button>`).join('')}</div>`;
const untracked=()=>DISHES.filter(d=>!d.tracked);
const trackedRows=()=>S.dev.allUntracked?[]:DISHES.filter(d=>d.tracked);

/* ---- 1. capture ---- */
function scCapture(){
 if(S.capture==='working')return top('สแกนบิล')+`<div class="oc-body"><div class="card oc-capwork">
 <div class="oc-spin"></div><h3>กำลังอ่านบิล...</h3>
 <p class="note-plain">ใบแรกของวันอาจใช้เวลาถึง 1 นาที ระบบต้องปลุกเครื่องอ่านก่อน</p>
 <div class="oc-elapsed num">${String(Math.floor(S.elapsed/60)).padStart(2,'0')}:${String(S.elapsed%60).padStart(2,'0')}</div>
 <p class="note-plain">ออกไปทำอย่างอื่นก่อนได้ ระบบจะอ่านต่อให้เอง แล้วแจ้งเมื่อพร้อมตรวจ</p>
 <div class="oc-caprow"><button class="btn btn--outline" data-go="pnl">ไปทำอย่างอื่นก่อน</button><button class="btn btn--quiet" data-cap="idle">ยกเลิก</button></div></div></div>`;
 return top('สแกนบิล','บันทึกต้นทุนจากบิลผู้ขาย')+`<div class="oc-body">
 <div class="card oc-capcard">
 <div class="oc-viewfinder"><span class="oc-frame"></span><p class="note-plain">วางบิลให้เต็มกรอบ หลีกเลี่ยงเงาและแสงสะท้อน</p></div>
 <button class="btn btn--primary btn--wet oc-shutter" data-cap="working">ถ่ายบิล</button>
 <button class="btn btn--outline btn--wet" data-cap="working">เลือกจากคลังรูป</button>
 <button class="btn btn--quiet" data-manual="1">กรอกเอง</button></div></div>`}

/* ---- 2. review ---- */
function scReview(){
 const man=S.dev.manual;
 const tot=BILL.items.reduce((a,i)=>a+i.q*i.up,0);
 return `<header class="oc-top"><button class="btn btn--quiet" data-go="capture">ย้อนกลับ</button><div><h1>${man?'กรอกบิลเอง':'ตรวจบิลก่อนบันทึก'}</h1><p class="note-plain">${man?'ใส่ตัวเลขจากบิลได้เลย ไม่ต้องมีรูป':'ระบบจะยังไม่บันทึกต้นทุนจนกว่าคุณจะยืนยัน'}</p></div></header>
 <div class="oc-body oc-review">
 ${man?'':`<div class="card oc-billimg"><div class="oc-billph"></div><button class="btn btn--quiet">แตะเพื่อขยาย · ซูมด้วยสองนิ้วได้</button></div>`}
 <div class="oc-revfields">
 <div class="card oc-form">
 <div class="field"><label>ผู้ขาย</label><input class="input" value="${esc(BILL.vendor)}"></div>
 <div class="field"><label>วันที่</label><input class="input" value="${BILL.date}"></div></div>
 <div class="card"><h3>รายการในบิล</h3>
 <div class="oc-billrows">${BILL.items.map((i,k)=>{const low=!man&&i.conf==='low';
  return `<div class="oc-billrow${low?' is-low':''}">
  <input class="input oc-bname" value="${esc(i.n)}">
  <input class="input num" value="${i.q}" inputmode="decimal" data-b="${k}:q">
  <span class="note-plain">${i.u}</span>
  <input class="input num" value="${i.up}" inputmode="decimal" data-b="${k}:up">
  <b class="num oc-bline">${B(i.q*i.up)}</b>
  ${low?`<span class="oc-lowtag">ตัวเลขอาจอ่านไม่ชัด ตรวจอีกครั้ง</span>`:''}</div>`}).join('')}</div>
 <div class="oc-costline"><span>รวมทั้งบิล</span>${money(tot,'money--cost')}</div></div>
 <div class="card oc-changes"><h3>สิ่งที่จะเปลี่ยนหลังยืนยัน</h3>
 <p>นมสด: ต้นทุนเปลี่ยนจาก 42 เป็น 45 บาท/ลิตร กระทบ 6 เมนู</p>
 <p>แก้ว 16 ออนซ์: ต้นทุนเปลี่ยนจาก 2.20 เป็น 2.20 บาท/ใบ ไม่เปลี่ยนแปลง</p>
 <button class="btn btn--primary btn--wet" data-go="inventory">ยืนยันและบันทึกต้นทุน</button></div></div></div>`}

/* ---- 3. inventory ---- */
function scInventory(){
 if(S.dev.emptyInv)return top('คลังวัตถุดิบ')+tabsWrap(`<div class="empty"><div class="oc-mark"></div><h4>ยังไม่มีวัตถุดิบในระบบ</h4><p class="note-plain">ส่วนนี้ไม่จำเป็นต้องใช้ก็ขายได้ตามปกติ เปิดใช้เมื่อไหร่ก็ได้ที่สะดวก</p></div>`);
 return top('คลังวัตถุดิบ',`${INV.length} รายการ`)+tabsWrap(`
 <div class="card oc-invrows">${INV.map(i=>`<div class="oc-invrow">
 <div><b>${esc(i.n)}</b><p class="note-plain">${i.cost} · ซื้อล่าสุด ${i.last}</p></div>
 <div class="oc-invright"><b class="num">${i.stock}</b>
 ${i.neg?`<span class="note-plain">น่าจะยังไม่ได้บันทึกบิลซื้อ</span>`
 :i.days!=null?`<span class="${i.days<=2?'oc-lowdays':'note-plain'}">เหลือพอราว ${i.days} วัน</span>`:''}</div></div>`).join('')}</div>`)}
const tabsWrap=inner=>`<div class="oc-body">${inner}</div>`;

/* ---- 4. P&L ---- */
function spark(vals){
 const max=Math.max(...vals),min=Math.min(...vals),h=44,w=140;
 const pts=vals.map((v,i)=>`${(i/(vals.length-1)*w).toFixed(1)},${(h-(v-min)/((max-min)||1)*h).toFixed(1)}`).join(' ');
 return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" preserveAspectRatio="none"><polyline points="${pts}" stroke="var(--green-brew)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`}
function scPnl(){
 const all=S.dev.allUntracked;
 const rev=8420,cost=all?null:S.dev.partial?2180:2960,fee=45,other=560;
 const net=all?null:rev-(cost||0)-other;
 return top('กำไรขาดทุนรายวัน')+`<div class="oc-body">
 <div class="oc-datesel"><button class="oc-arrow" aria-label="วันก่อนหน้า">‹</button><b>อาทิตย์ 16 ส.ค. 2569</b><button class="oc-arrow" aria-label="วันถัดไป">›</button></div>
 <div class="card oc-pnl">
 <div class="oc-pnlrow"><span>ยอดขาย</span>${money(rev,'money--revenue')}</div>
 <div class="oc-pnlrow"><span>ต้นทุนวัตถุดิบ</span>${money(cost,'money--cost')}</div>
 <div class="oc-pnlrow"><span>ค่าธรรมเนียม (BrewLedger ออกให้)</span><span class="money oc-absorbed">${B(fee)}</span></div>
 <div class="oc-pnlrow"><span>ค่าใช้จ่ายอื่น</span>${money(other,'money--cost')}</div>
 <div class="oc-pnlrow is-net"><span>กำไรสุทธิ</span><span class="oc-big">${money(net,'money--profit')}</span></div>
 <p class="note-plain">ค่าธรรมเนียมแสดงไว้ให้เห็นโครงสร้างต้นทุนจริง แต่ยังไม่ได้หักจากกำไรของคุณในช่วงนี้</p></div>
 ${(all||S.dev.partial)?`<div class="card oc-disclose"><p>หมายเหตุ: ${all?'ทุกรายการ':'12 จาก 47 รายการ'}ยังไม่มีข้อมูลต้นทุน${all?'':' (คิดเป็นยอดขาย 540 บาท)'}<br>${all?'ยอดขายและค่าใช้จ่ายแสดงตามจริง ส่วนกำไรสุทธิจึงยังคำนวณไม่ได้':'กำไรที่แสดงจึงคำนวณจากรายการที่มีข้อมูลเท่านั้น'}</p></div>`:''}
 <div class="card"><h3>กำไรสุทธิ 7 วันล่าสุด</h3><div class="oc-spark">${spark([1420,1680,1310,1890,2050,1760,net||1600])}</div></div></div>`}

/* ---- 5. profit per dish ---- */
function scDish(){
 const tr=trackedRows().map(d=>({...d,pc:Math.round(d.rev/d.u)-d.c,tot:(Math.round(d.rev/d.u)-d.c)*d.u})).sort((a,b)=>b.tot-a.tot);
 const un=S.dev.allUntracked?DISHES:untracked();
 const best=[...DISHES].sort((a,b)=>b.u-a.u)[0],topProfit=tr[0];
 const insight=topProfit&&best&&topProfit.n!==best.n;
 return top('กำไรต่อเมนู')+`<div class="oc-body">
 <div class="oc-periods">${[['today','วันนี้'],['7','7 วัน'],['30','30 วัน'],['custom','กำหนดเอง']].map(([k,l])=>`<button class="oc-chip${S.period===k?' is-on':''}" data-per="${k}">${l}</button>`).join('')}</div>
 ${insight?`<div class="oc-insight"><span class="oc-brieftag">สิ่งที่ตัวเลขบอก</span><p>ขายดีที่สุดคือ ${best.n} (${best.u} แก้ว) แต่กำไรรวมสูงสุดคือ ${topProfit.n} (${topProfit.tot.toLocaleString('th-TH')} บาท)</p></div>`:''}
 ${tr.length?`<div class="card oc-tablewrap"><table class="oc-table"><thead><tr><th>เมนู</th><th>ขายได้</th><th>ยอดขาย</th><th>ต้นทุน</th><th>กำไรต่อแก้ว</th><th>กำไรรวม</th></tr></thead>
 <tbody>${tr.map(d=>`<tr><td>${esc(d.n)}</td><td class="num">${d.u}</td><td class="num">${B(d.rev)}</td><td class="num">${B(d.c)}</td><td class="num">${B(d.pc)}</td><td class="num"><b class="money money--profit">${B(d.tot)}</b></td></tr>`).join('')}</tbody></table></div>`:''}
 ${un.length?`<div class="card oc-tablewrap"><h3>ยังไม่มีข้อมูลต้นทุน (${un.length} รายการ)</h3>
 <table class="oc-table"><thead><tr><th>เมนู</th><th>ขายได้</th><th>ยอดขาย</th><th>ต้นทุน</th><th>กำไรต่อแก้ว</th><th>กำไรรวม</th></tr></thead>
 <tbody>${un.map(d=>`<tr><td>${esc(d.n)}</td><td class="num">${d.u}</td><td class="num">${B(d.rev)}</td><td class="money money--unknown">—</td><td class="money money--unknown">—</td><td class="money money--unknown">—</td></tr>`).join('')}</tbody></table></div>`:''}</div>`}

/* ---- 6. overview ---- */
function scOverview(){
 const zero=S.dev.zeroBase;
 const rows=[['ยอดขาย',48200,41300,'money--revenue'],['ต้นทุนวัตถุดิบ',12900,11800,'money--cost'],['ค่าใช้จ่ายอื่น',6400,7100,'money--cost'],['กำไรสุทธิ',28900,zero?0:22400,'money--profit']];
 const bars=[[38,22],[41,25],[36,20],[44,27],[47,29],[43,26],[45,28],[49,31],[46,29],[41,25],[48,30],[29,18]];
 const mx=Math.max(...bars.flat());
 return top('เปรียบเทียบช่วงเวลา')+`<div class="oc-body">
 <div class="card oc-cmphead"><b>เทียบ 1–16 ส.ค. กับ 1–16 ก.ค.</b><p class="note-plain">เดือนนี้ยังไม่จบ ตัวเลขจึงเทียบเฉพาะช่วงวันเท่ากันของทั้งสองเดือน</p></div>
 <div class="oc-cmpgrid">${rows.map(([n,cur,prev,cls])=>{
  const d=prev?((cur-prev)/prev*100):null,up=d!=null&&d>=0;
  return `<div class="card oc-cmp"><p class="note-plain">${n}</p><div class="oc-big">${money(cur,cls)}</div>
  <div class="oc-delta ${d==null?'is-unknown':up?'is-up':'is-down'}">${d==null?'—':`${up?'▲':'▼'} ${B(Math.abs(cur-prev))} · ${Math.abs(d).toFixed(1)}%`}</div>
  <p class="note-plain">${prev?`เดือนก่อน ${B(prev)}`:'เดือนก่อนไม่มียอด จึงเทียบเป็นเปอร์เซ็นต์ไม่ได้'}</p></div>`}).join('')}</div>
 <div class="card"><h3>ยอดขายและกำไร 12 เดือน</h3>
 <div class="oc-bars">${bars.map(([r,p],i)=>`<div class="oc-barcol"><div class="oc-bar" style="height:${r/mx*100}%"></div><div class="oc-bar is-profit" style="height:${p/mx*100}%"></div><span class="oc-barlab num">${(i+8)%12+1}</span></div>`).join('')}</div>
 <div class="oc-legend"><span><i class="sw sw--rev"></i>ยอดขาย</span><span><i class="sw sw--pro"></i>กำไรสุทธิ</span></div></div>
 <div class="card"><h3>ค่าธรรมเนียมเดือนนี้</h3><div class="oc-pnl">
 <div class="oc-pnlrow"><span>ร้านจ่ายเอง</span>${money(0,'money--cost')}</div>
 <div class="oc-pnlrow"><span>BrewLedger ออกให้</span><span class="money oc-absorbed">${B(1240)}</span></div>
 <div class="oc-pnlrow is-net"><span>รวมค่าธรรมเนียมทั้งหมด</span>${money(1240,'money--cost')}</div></div></div></div>`}

/* ---- 7. transaction ledger ---- */
const satang=v=>v==null?'—':(v<0?'-':v>0?'+':'')+'฿'+Math.abs(v/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
const netCls=v=>v<0?'money--negative':'money--profit';
function scLedger(){
 const day=S.ledger==='day';
 const head=`<div class="oc-segwrap"><div class="oc-seg"><button class="${day?'is-on':''}" data-led="day">รายวัน</button><button class="${day?'':'is-on'}" data-led="month">รายเดือน</button></div></div>`;
 return top('รายการเดินบัญชี','บันทึกเงินเข้าออกตามลำดับเวลา')+`<div class="oc-body">${head}${day?ledgerDay():ledgerMonth()}</div>`}
function ledgerDay(){
 const sel=`<div class="oc-datesel"><button class="oc-arrow" aria-label="วันก่อนหน้า">‹</button><b>อาทิตย์ 16 ส.ค. 2569</b><button class="oc-arrow" aria-label="วันถัดไป">›</button></div>`;
 if(S.dev.txLoading)return sel+`<div class="card" style="display:grid;gap:1.2rem">${[1,2,3,4,5].map(()=>`<div class="skel" style="height:44px"></div>`).join('')}</div>`;
 if(S.dev.emptyDay)return sel+`<div class="empty"><div class="oc-mark"></div><h4>วันนี้ยังไม่มีรายการ</h4><p class="note-plain">รายการจะขึ้นที่นี่เมื่อมีการขายหรือบันทึกบิลซื้อ</p></div>`;
 const rows=dayRows();
 const inn=dayIn(rows);
 const out=dayOut(rows);
 return sel+`<div class="card oc-sumbar"><div><p class="note-plain">รับเข้า</p><b class="money money--revenue num">${satang(inn)}</b></div>
 <div><p class="note-plain">จ่ายออก</p><b class="money money--cost num">${satang(out)}</b></div>
 <div class="is-net"><p class="note-plain">คงเหลือสุทธิ</p><b class="oc-big money ${netCls(inn+out)} num">${satang(inn+out)}</b></div></div>
 <div class="card oc-txwrap"><table class="oc-table oc-tx"><thead><tr><th>เวลา</th><th>รายการ</th><th>ประเภท</th><th>จำนวนเงิน</th></tr></thead><tbody>
 ${rows.map(r=>`<tr class="oc-txrow ${r.k==='feeabs'?'is-abs':r.amt>0?'is-in':'is-out'}" ${r.link?`data-src="${r.link}"`:''} ${r.link?'tabindex="0"':''}>
 <td class="num oc-txtime">${r.t}</td>
 <td class="oc-txname"><b>${esc(r.n)}</b>${r.id?`<span class="note-plain num">${esc(r.id)}</span>`:''}</td>
 <td class="oc-txtype"><span class="oc-txtag">${TXTYPE[r.k]}</span></td>
 <td class="num oc-txamt">${satang(r.amt)}</td></tr>`).join('')}
 </tbody></table></div>
 <p class="note-plain">ค่าธรรมเนียมที่ BrewLedger ออกให้ แสดงไว้ให้เห็นโครงสร้างต้นทุนจริง แต่ไม่ได้นับรวมในยอดจ่ายออก</p>`}
function ledgerMonth(){
 const M=monthRows();
 const ti=M.reduce((a,r)=>a+r[2],0),to=M.reduce((a,r)=>a+r[3],0),tn=M.reduce((a,r)=>a+r[1],0);
 return `<div class="oc-datesel"><button class="oc-arrow" aria-label="เดือนก่อน">‹</button><b>สิงหาคม 2569</b><button class="oc-arrow" aria-label="เดือนถัดไป">›</button></div>
 <div class="card oc-txwrap"><table class="oc-table oc-month"><thead><tr><th>วันที่</th><th>จำนวนรายการ</th><th>รับเข้า</th><th>จ่ายออก</th><th>คงเหลือ</th></tr></thead><tbody>
 ${M.map(([d,n,i,o])=>`<tr class="oc-txrow" data-day="${d}" tabindex="0"><td class="num">${d} ส.ค.</td><td class="num">${n}</td><td class="num money money--revenue">${satang(i)}</td><td class="num money money--cost">${satang(-o)}</td><td class="num money ${netCls(i-o)}">${satang(i-o)}</td></tr>`).join('')}
 </tbody><tfoot><tr class="oc-monthtot"><td>รวมทั้งเดือน</td><td class="num">${tn}</td><td class="num money money--revenue">${satang(ti)}</td><td class="num money money--cost">${satang(-to)}</td><td class="num money ${netCls(ti-to)}">${satang(ti-to)}</td></tr></tfoot></table></div>`}

const SCREENS={capture:scCapture,review:scReview,inventory:scInventory,ledger:scLedger,pnl:scPnl,dish:scDish,overview:scOverview};
function devPanel(){
 const d=S.dev,row=(k,l)=>`<label class="dv"><input type="checkbox" data-dev="${k}" ${d[k]?'checked':''}>${l}</label>`;
 return `<div class="dev${window.__blDev?' is-open':''}"><div class="dev-h">สถานะพิเศษ <span class="note-plain">กด D เพื่อซ่อน</span></div>
 ${row('partial','มีต้นทุนบางรายการ')}${row('allUntracked','ยังไม่มีข้อมูลต้นทุนเลย')}${row('manual','กรอกบิลเอง (ไม่มีรูป)')}${row('emptyInv','คลังว่าง')}${row('zeroBase','เดือนก่อนไม่มียอด')}
 <div class="dev-h" style="margin-top:1.2rem">รายการเดินบัญชี</div>
 ${row('emptyDay','วันที่ไม่มีรายการ')}${row('cashOnly','วันที่มีแต่เงินสด')}${row('txLoading','กำลังโหลด')}
 <div class="dev-h" style="margin-top:1.2rem">ไปที่หน้า</div>
 <div class="dev-go">${Object.keys(SCREENS).map(k=>`<button data-go="${k}">${k}</button>`).join('')}</div></div>`}
function render(){
 $('#app').innerHTML=`<div class="oc">
 <aside class="oc-side"><div class="wordmark">BrewLedger</div>${NAV.map(([k,l])=>`<button ${k==='reports'?'class="is-active"':`data-ext="${k}"`}>${l}</button>`).join('')}</aside>
 <main class="oc-main">${tabs()}${SCREENS[S.screen]()}</main>
 <nav class="oc-nav">${NAV.map(([k,l])=>`<button ${k==='reports'?'class="is-active"':`data-ext="${k}"`}>${l}</button>`).join('')}</nav></div>${devPanel()}`;
 if(capTimer){clearInterval(capTimer);capTimer=null}
 if(S.screen==='capture'&&S.capture==='working')capTimer=setInterval(()=>{S.elapsed++;const e=$('.oc-elapsed');
  if(e)e.textContent=String(Math.floor(S.elapsed/60)).padStart(2,'0')+':'+String(S.elapsed%60).padStart(2,'0');
  if(S.elapsed>=8){clearInterval(capTimer);capTimer=null;S.capture='idle';S.elapsed=0;S.screen='review';render()}},1000)}

document.addEventListener('click',e=>{
 const t=e.target.closest('[data-go],[data-cap],[data-manual],[data-per],[data-ext],[data-led],[data-src],[data-day]');if(!t)return;const d=t.dataset;
 if(d.led){S.ledger=d.led;return render()}
 if(d.day){S.ledger='day';return render()}
 if(d.src){location.href=d.src==='order'?'Owner Console.html':'Console Reports.html';if(d.src==='bill'){S.screen='review';render()}return}
 if(d.ext){location.href=d.ext==='setup'?'Console Setup.html':'Owner Console.html';return}
 if(d.cap){S.capture=d.cap;S.elapsed=0;return render()}
 if(d.manual){S.dev.manual=true;S.screen='review';return render()}
 if(d.per){S.period=d.per;return render()}
 if(d.go){S.screen=d.go;window.scrollTo(0,0);return render()}});
document.addEventListener('input',e=>{const d=e.target.dataset.b;if(!d)return;
 const[i,k]=d.split(':');BILL.items[i][k]=+e.target.value||0;
 const row=e.target.closest('.oc-billrow');row.querySelector('.oc-bline').textContent=B(BILL.items[i].q*BILL.items[i].up);
 const tot=BILL.items.reduce((a,x)=>a+x.q*x.up,0);const el=document.querySelector('.oc-costline .money');if(el)el.textContent=B(tot)});
document.addEventListener('change',e=>{const k=e.target.dataset.dev;if(k){S.dev[k]=e.target.checked;
 if(k==='allUntracked'&&e.target.checked)S.dev.partial=false;if(k==='partial'&&e.target.checked)S.dev.allUntracked=false;render()}});
document.addEventListener('keydown',e=>{if((e.key==='d'||e.key==='D')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){window.__blDev=!window.__blDev;render()}});
render();
})();
