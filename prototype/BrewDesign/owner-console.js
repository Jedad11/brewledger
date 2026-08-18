/* BrewLedger — Owner Console P2 (core loop). Vanilla. */
(function(){
const $=(s,r=document)=>r.querySelector(s);
const B=n=>n==null?'—':'฿'+n.toLocaleString('th-TH');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const STATUS={unpaid:'รอชำระเงิน',accepted:'รับออเดอร์แล้ว',making:'กำลังทำ',ready:'พร้อมรับ',collected:'รับแล้ว',cancelled:'ยกเลิก',refunded:'คืนเงินแล้ว',expired:'หมดเวลา'};
const NEXT={accepted:['making','เริ่มทำ'],making:['ready','พร้อมรับ'],ready:['collected','รับแล้ว']};
const REASONS=['ของหมด','เครื่องเสีย','ลูกค้าขอยกเลิก','ร้านปิดกะทันหัน','อื่นๆ'];

const TILES=[{id:'am',n:'อเมริกาโน่',p:55,hot:true},{id:'lt',n:'ลาเต้',p:60,hot:true},{id:'ltx',n:'ลาเต้เย็นหวานน้อยพิเศษเพิ่มช็อต',p:75},{id:'cp',n:'คาปูชิโน่',p:60},{id:'th',n:'ชาไทย',p:50},{id:'es',n:'เอสเพรสโซ่',p:45},{id:'co',n:'โกโก้',p:55},{id:'cr',n:'ครัวซองต์เนยสด',p:65},{id:'bw',n:'บราวนี่',p:55},{id:'mc',n:'มัทฉะลาเต้',p:70}];

const seedOrders=()=>[
{id:'SJ-4821',name:'พลอย',slot:'08:15',status:'accepted',unseen:true,phone:'081-234-5678',items:[{n:'ลาเต้เย็นหวานน้อยพิเศษเพิ่มช็อต',o:'เย็น · หวานน้อย',q:1,p:80},{n:'ครัวซองต์เนยสด',o:'',q:1,p:65}],log:[['08:02','ลูกค้าสั่ง'],['08:03','ชำระเงินแล้ว'],['08:03','รับออเดอร์แล้ว']]},
{id:'SJ-4822',name:'ต้น',slot:'08:15',status:'making',unseen:false,phone:'',items:[{n:'อเมริกาโน่',o:'เย็น',q:2,p:120}],log:[['08:05','ลูกค้าสั่ง'],['08:05','ชำระเงินแล้ว'],['08:06','รับออเดอร์แล้ว'],['08:09','เริ่มทำ']]},
{id:'SJ-4823',name:'มิ้นท์',slot:'08:30',status:'accepted',unseen:true,phone:'089-777-1122',items:[{n:'ชาไทย',o:'เย็น · หวานปกติ',q:1,p:55},{n:'โกโก้',o:'ปั่น',q:1,p:65}],log:[['08:11','ลูกค้าสั่ง'],['08:12','ชำระเงินแล้ว'],['08:12','รับออเดอร์แล้ว']]},
{id:'SJ-4824',name:'เอก',slot:'08:30',status:'ready',unseen:false,phone:'',items:[{n:'คาปูชิโน่',o:'ร้อน',q:1,p:60}],log:[['08:08','ลูกค้าสั่ง'],['08:08','ชำระเงินแล้ว'],['08:09','รับออเดอร์แล้ว'],['08:14','เริ่มทำ'],['08:18','พร้อมรับ']]},
{id:'SJ-4825',name:'จอย',slot:'09:00',status:'accepted',unseen:false,phone:'082-555-0900',items:[{n:'เอสเพรสโซ่',o:'',q:1,p:45}],log:[['08:20','ลูกค้าสั่ง'],['08:20','ชำระเงินแล้ว'],['08:21','รับออเดอร์แล้ว']]}];

const S={screen:'dash',orders:seedOrders(),open:null,cancel:null,cart:[],recent:[],login:'phone',otp:['','','','','',''],resend:60,banner:true,
dev:{noRecipe:true,partial:false,noOrders:false,noBrief:false,perm:'denied',loading:false,newOrder:true}};
let resendTimer=null,undoTimer=null;

const total=o=>o.items.reduce((a,i)=>a+i.p,0);
const cups=o=>o.items.reduce((a,i)=>a+i.q,0);
const live=()=>S.dev.noOrders?[]:S.orders.filter(o=>!['collected','cancelled','refunded','expired'].includes(o.status));
const counts=()=>{const l=live();return{wait:l.filter(o=>o.status==='accepted').length,make:l.filter(o=>o.status==='making').length,ready:l.filter(o=>o.status==='ready').length}};
const unseen=()=>live().filter(o=>o.unseen).length;
const money=(v,cls='')=>`<span class="money ${v==null?'money--unknown':cls}">${B(v)}</span>`;

/* ---------- shell ---------- */
const NAV=[['dash','หน้าหลัก','home'],['orders','ออเดอร์','bag'],['quick','ขายหน้าร้าน','cup'],['reports','รายงาน','bars'],['settings','ตั้งค่า','gear']];
const ICON={home:'<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
bag:'<path d="M5 7h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor" stroke-width="1.7"/>',
cup:'<path d="M5 8h11a3 3 0 0 1 0 6h-.6M5 8l1.2 9.5A2 2 0 0 0 8.2 19h5.3a2 2 0 0 0 2-1.5L16 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
bars:'<path d="M5 19V9m5 10V5m5 14v-7m5 7V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
gear:'<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M12 3.5v2m0 13v2M3.5 12h2m13 0h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'};
const svg=(k,s=22)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">${ICON[k]}</svg>`;
const badge=()=>unseen()?`<span class="oc-badge num">${unseen()}</span>`:'';
function nav(){const cur=['dash','orders','quick','reports','settings'].includes(S.screen)?S.screen:S.screen==='detail'?'orders':S.screen;
 return `<nav class="oc-nav">${NAV.map(([k,l,i])=>`<button data-go="${k}" class="${cur===k?'is-active':''}${k==='quick'?' slot-sell':''}"><span class="glyph">${svg(i,k==='quick'?26:22)}</span>${l}${k==='orders'?badge():''}</button>`).join('')}</nav>`}
function side(){const cur=S.screen==='detail'?'orders':S.screen;
 return `<aside class="oc-side"><div class="wordmark">BrewLedger</div>${NAV.map(([k,l])=>`<button data-go="${k}" class="${cur===k?'is-active':''}">${l}${k==='orders'&&unseen()?`<span class="oc-count num">${unseen()}</span>`:''}</button>`).join('')}</aside>`}
const top=(t,sub)=>`<header class="oc-top"><div><h1>${t}</h1>${sub?`<p class="note-plain">${sub}</p>`:''}</div></header>`;

/* ---------- 1. login ---------- */
function scLogin(){
 if(S.login==='phone')return `<div class="oc-auth"><div class="card oc-authcard"><div class="wordmark">BrewLedger</div><h2>เข้าสู่ระบบร้านค้า</h2><p class="note-plain">ใส่เบอร์โทรที่ลงทะเบียนไว้ ระบบจะส่งรหัส 6 หลักให้ทาง SMS</p>
 <div class="field"><label>เบอร์โทร</label><input class="input" inputmode="tel" placeholder="08X-XXX-XXXX" value="081-234-5678"></div>
 <button class="btn btn--primary btn--wet" data-otp="1">ขอรหัส</button></div></div>`;
 const err=S.otp.join('').length===6&&S.otp.join('')!=='481920';
 return `<div class="oc-auth"><div class="card oc-authcard"><button class="btn btn--quiet" style="justify-self:start;padding-left:0" data-login="phone">ย้อนกลับ</button>
 <h2>ใส่รหัส 6 หลัก</h2><p class="note-plain">ส่งไปที่ 081-234-5678 แล้ว</p>
 <div class="oc-otp">${S.otp.map((v,i)=>`<input class="oc-otpbox${err?' is-error':''}" inputmode="numeric" maxlength="1" data-oi="${i}" value="${v}">`).join('')}</div>
 ${err?`<p class="err">รหัสไม่ถูกต้อง กรุณาลองใหม่</p>`:''}
 <button class="btn ${err?'btn--outline':'btn--primary'} btn--wet" data-go="dash">ยืนยัน</button>
 <button class="btn btn--quiet ${S.resend>0?'is-disabled':''}" data-resend="1">${S.resend>0?`ขอรหัสใหม่ได้ใน ${S.resend} วินาที`:'ขอรหัสใหม่'}</button></div></div>`}

/* ---------- 2. dashboard ---------- */
function brief(){
 if(S.dev.noBrief)return'';
 return `<div class="oc-brief"><span class="oc-brieftag">สรุปสำหรับวันนี้</span>
 <p>พรุ่งนี้จองแล้ว 14 แก้ว ช่วง 08:00–08:30 แน่นสุด</p>
 <p>นมสดเหลือพอราว 1 วัน ซื้อเพิ่มก่อนเปิดร้าน</p></div>`}
function scDash(){
 const c=counts(),rev=S.dev.noOrders?0:3240,exp=S.dev.noOrders?0:860;
 const profit=S.dev.noRecipe?null:S.dev.partial?1180:1905;
 const note=S.dev.noRecipe?'ยังไม่ได้บันทึกต้นทุน จึงยังคำนวณกำไรไม่ได้':S.dev.partial?'คำนวณจาก 8 จาก 12 รายการที่มีข้อมูลต้นทุน':'';
 if(S.dev.loading)return top('หน้าหลัก')+`<div class="oc-body"><div class="oc-metrics">${[1,2,3,4].map(()=>`<div class="card" style="display:grid;gap:1rem"><div class="skel" style="height:12px;width:45%"></div><div class="skel" style="height:30px;width:70%"></div></div>`).join('')}</div></div>`;
 return top('หน้าหลัก','อังคาร 17 ส.ค.')+`<div class="oc-body">${brief()}
 <div class="oc-metrics">
 <div class="card oc-metric"><p class="note-plain">ยอดขายวันนี้</p><div class="oc-big">${money(rev,'money--revenue')}</div></div>
 <div class="card oc-metric"><p class="note-plain">กำไรสุทธิวันนี้</p><div class="oc-big">${money(profit,'money--profit')}</div>${note?`<p class="note-plain oc-metnote">${note}</p>`:''}</div>
 <div class="card oc-metric"><p class="note-plain">ค่าใช้จ่ายวันนี้</p><div class="oc-big">${money(exp,'money--cost')}</div></div>
 <div class="card oc-metric"><p class="note-plain">ออเดอร์</p><div class="oc-split"><span><b class="num">${c.wait}</b>รอทำ</span><span><b class="num">${c.make}</b>กำลังทำ</span><span><b class="num">${c.ready}</b>พร้อมรับ</span></div></div></div>
 <div class="card"><h3>ช่วงเวลารับถัดไป</h3><div class="oc-slots">${[['08:15',3],['08:30',2],['09:00',1]].map(([t,n])=>`<div class="oc-slotrow"><b class="num">${t} น.</b><span class="note-plain">จองแล้ว ${n} ออเดอร์</span></div>`).join('')}</div></div>
 <div class="oc-quickrow"><button class="btn btn--outline btn--wet" data-go="orders">ออเดอร์</button><button class="btn btn--primary btn--wet" data-go="quick">ขายหน้าร้าน</button><button class="btn btn--outline btn--wet" data-go="capture">สแกนบิล</button></div></div>`}

/* ---------- 3. order inbox ---------- */
function orderCard(o,link){
 const nx=NEXT[o.status];
 return `<div class="card oc-order${o.unseen?' is-new':''}">
 <div class="oc-orderhead"><div><b class="num oc-code">${o.id}</b><p class="note-plain">${esc(o.name)} · รับ ${o.slot} น.</p></div><span class="st st--${o.status}">${STATUS[o.status]}</span></div>
 <div class="oc-items">${o.items.map(i=>`<div class="oc-item"><span>${esc(i.n)}${i.o?`<br><span class="note-plain">${i.o}</span>`:''}</span><b class="num">× ${i.q}</b></div>`).join('')}</div>
 <div class="oc-ordertot"><span class="note-plain">${cups(o)} แก้ว</span>${money(total(o),'money--revenue')}</div>
 ${nx?`<button class="btn btn--primary btn--wet" data-adv="${o.id}">${nx[1]}</button>`:''}
 <div class="oc-orderfoot">${link?`<button class="btn btn--quiet" data-open="${o.id}">ดูรายละเอียด</button>`:''}<button class="btn btn--quiet oc-cancel" data-cancel="${o.id}">ยกเลิกออเดอร์</button></div></div>`}
function scOrders(){
 const l=live();
 if(!l.length)return top('ออเดอร์')+`<div class="oc-body"><div class="empty"><div class="oc-mark"></div><h4>ยังไม่มีออเดอร์วันนี้</h4><p class="note-plain">ลูกค้าสั่งผ่านลิงก์ร้านของคุณได้เลย</p><button class="btn btn--outline" data-goset="1">ดูลิงก์ร้าน</button></div></div>`;
 const slots=[...new Set(l.map(o=>o.slot))].sort();
 return top('ออเดอร์')+`<div class="oc-body">${S.banner&&unseen()?`<div class="oc-banner"><span>มีออเดอร์ใหม่ ${unseen()} รายการ</span><button class="btn" data-seen="1">รับทราบ</button></div>`:''}
 ${slots.map((t,i)=>{const g=l.filter(o=>o.slot===t);return `<section class="oc-group"><div class="oc-grouphead"><h3>${t} น.${i===0?' <span class="oc-nearest">ใกล้ที่สุด</span>':''}</h3><button class="btn btn--quiet" data-bulk="${t}">ทำเสร็จทั้งช่วงเวลานี้</button></div>${g.map(o=>orderCard(o,true)).join('')}</section>`}).join('')}</div>`}

/* ---------- 4. order detail ---------- */
function scDetail(){
 const o=S.orders.find(x=>x.id===S.open);if(!o){S.screen='orders';return scOrders()}
 const nx=NEXT[o.status];
 return `<header class="oc-top"><button class="btn btn--quiet" style="padding-left:0" data-go="orders">ย้อนกลับ</button><div><h1 class="num">${o.id}</h1><p class="note-plain">${esc(o.name)} · รับ ${o.slot} น.</p></div></header>
 <div class="oc-body"><div class="card"><div class="oc-orderhead"><span class="st st--${o.status}">${STATUS[o.status]}</span>${money(total(o),'money--revenue')}</div>
 <div class="oc-items">${o.items.map(i=>`<div class="oc-item"><span>${esc(i.n)}${i.o?`<br><span class="note-plain">${i.o}</span>`:''}</span><b class="num">× ${i.q}</b></div>`).join('')}</div>
 ${nx?`<button class="btn btn--primary btn--wet" data-adv="${o.id}">${nx[1]}</button>`:''}</div>
 <div class="card"><h3>ติดต่อลูกค้า</h3>${o.phone?`<p class="note-plain">${esc(o.name)} · <b class="num">${o.phone}</b></p><a class="btn btn--outline" style="margin-top:1.2rem" href="tel:${o.phone.replace(/-/g,'')}">โทรหาลูกค้า</a>`:`<p class="note-plain">ลูกค้าไม่ได้ให้เบอร์โทร</p>`}</div>
 <div class="card"><h3>ประวัติสถานะ</h3><div class="oc-log">${o.log.map(([t,l])=>`<div class="oc-logrow"><b class="num">${t}</b><span>${l}</span></div>`).join('')}</div></div>
 ${['cancelled','refunded'].includes(o.status)?`<div class="card"><h3>กำลังคืนเงิน</h3><p class="note-plain">เงินจะคืนเข้าบัญชีเดิมของลูกค้าภายใน 3–5 วันทำการ ระบบแจ้งลูกค้าให้แล้ว</p></div>`:`<button class="btn btn--danger" data-cancel="${o.id}" style="width:100%">ยกเลิกออเดอร์</button>`}</div>`}
function cancelSheet(){
 if(!S.cancel)return'';
 const {id,reason,confirm}=S.cancel;
 if(confirm)return `<div class="oc-scrim" data-x="1"></div><div class="oc-sheet"><h3>ยืนยันการยกเลิก</h3><p class="note-plain">ออเดอร์ <b class="num">${id}</b> · เหตุผล: ${reason}<br>ลูกค้าจะได้รับแจ้งและระบบจะเริ่มคืนเงินทันที</p>
 <button class="btn btn--danger btn--wet" data-doCancel="1">ยืนยันยกเลิกและคืนเงิน</button><button class="btn btn--quiet" data-x="1">ไม่ยกเลิก</button></div>`;
 return `<div class="oc-scrim" data-x="1"></div><div class="oc-sheet"><h3>เหตุผลที่ยกเลิก</h3><div class="oc-reasons">${REASONS.map(r=>`<button class="cw-opt${reason===r?' is-on':''}" data-reason="${r}">${r}</button>`).join('')}</div>
 <button class="btn btn--danger btn--wet ${reason?'':'is-disabled'}" data-next="1">ต่อไป</button><button class="btn btn--quiet" data-x="1">ปิด</button></div>`}

/* ---------- 5. quick cash sale ---------- */
function scQuick(){
 const t=S.cart.reduce((a,l)=>a+l.p*l.q,0),n=S.cart.reduce((a,l)=>a+l.q,0);
 return top('ขายหน้าร้าน','แตะเพื่อเพิ่ม · กดค้างเพื่อเลือกตัวเลือก')+`<div class="oc-body oc-quick">
 <div class="oc-tiles">${TILES.map(x=>{const inCart=S.cart.find(l=>l.id===x.id);
  return `<button class="oc-tile${x.hot?' is-hot':''}" data-tile="${x.id}"><b>${esc(x.n)}</b><span class="num">${B(x.p)}</span>${inCart?`<span class="oc-tilebadge num">${inCart.q}</span>`:''}</button>`}).join('')}</div>
 ${S.recent.length?`<div class="card oc-recent"><h4>ขายล่าสุด</h4>${S.recent.map((r,i)=>`<div class="oc-recrow"><span class="num">${r.time}</span><span>${r.n} แก้ว</span><b class="num">${B(r.t)}</b>${r.undo?`<button class="btn btn--quiet" data-undo="${i}">ยกเลิก</button>`:`<span class="note-plain">หมดเวลายกเลิก</span>`}</div>`).join('')}</div>`:''}</div>
 <div class="oc-total"><div><span class="note-plain">${n} แก้ว</span><div class="oc-big">${money(t,'money--revenue')}</div></div><button class="btn btn--primary btn--wet ${n?'':'is-disabled'}" data-confirm="1" style="width:auto;padding:0 3.2rem">รับเงินสด</button></div>`}

/* ---------- 6. notifications ---------- */
function scSettings(){
 const p=S.dev.perm;
 return top('ตั้งค่า','การแจ้งเตือน')+`<div class="oc-body">
 <div class="card"><h3>การแจ้งเตือนออเดอร์ใหม่</h3>
 ${p==='ask'?`<p class="note-plain">เปิดการแจ้งเตือนเพื่อให้รู้ทันทีที่มีออเดอร์เข้า</p><button class="btn btn--primary btn--wet" data-perm="granted">เปิดการแจ้งเตือน</button>`:''}
 ${p==='granted'?`<p class="note-plain">เปิดอยู่ · อุปกรณ์นี้จะแจ้งเตือนเมื่อมีออเดอร์ใหม่</p><span class="st st--making" style="margin-top:1.2rem">เปิดใช้งานแล้ว</span>`:''}
 ${p==='denied'?`<p class="note-plain">อุปกรณ์นี้ปิดการแจ้งเตือนไว้ ระบบจึงตรวจหาออเดอร์ใหม่ให้ทุก 10 วินาทีขณะเปิดหน้านี้อยู่</p>
 <div class="oc-poll"><span class="dot"></span>กำลังตรวจหาออเดอร์ใหม่ · อัปเดตล่าสุด <b class="num">08:22:41</b></div>
 <p class="note-plain" style="margin-top:1.6rem">บน iPhone ต้องเพิ่มเว็บนี้ลงหน้าจอโฮมก่อน การแจ้งเตือนจึงจะทำงานได้ — เปิดเมนูแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”</p>`:''}
 </div>
 <div class="card"><h3>รูปแบบการแจ้งเตือนในระบบ</h3>
 <div class="oc-patrow"><span>ตัวเลขบนแท็บออเดอร์</span><span class="oc-badge num" style="position:static">3</span></div>
 <div class="oc-patrow"><span>แถบออเดอร์ใหม่ ค้างจนกดรับทราบ</span><span class="st st--ready">ค้างไว้</span></div>
 <div class="oc-patrow"><span>ขอบซ้ายหนาบนออเดอร์ที่ยังไม่ได้เปิด</span><span class="oc-newmark"></span></div></div>
 <div class="card"><h3>สถานะสิทธิ์การแจ้งเตือน</h3><div class="oc-perms">${[['ask','ยังไม่ได้ถาม'],['granted','อนุญาตแล้ว'],['denied','ถูกปฏิเสธ']].map(([k,l])=>`<button class="cw-opt${p===k?' is-on':''}" data-perm="${k}">${l}</button>`).join('')}</div></div></div>`}
const scStub=(t,b)=>top(t)+`<div class="oc-body"><div class="empty"><div class="oc-mark"></div><h4>${t}</h4><p class="note-plain">${b}</p></div></div>`;

const SCREENS={login:scLogin,dash:scDash,orders:scOrders,detail:scDetail,quick:scQuick,settings:scSettings,
reports:()=>scStub('รายงาน','หน้ารายงานกำไรและต้นทุนอยู่ในชุดถัดไป (P4)'),capture:()=>scStub('สแกนบิล','หน้าถ่ายบิลผู้ขายอยู่ในชุดถัดไป (P4)')};

function devPanel(){
 const d=S.dev,row=(k,l)=>`<label class="dv"><input type="checkbox" data-dev="${k}" ${d[k]?'checked':''}>${l}</label>`;
 return `<div class="dev${window.__blDev?' is-open':''}"><div class="dev-h">สถานะพิเศษ <span class="note-plain">กด D เพื่อซ่อน</span></div>
 ${row('noRecipe','ร้านที่ยังไม่มีข้อมูลต้นทุน')}${row('partial','มีต้นทุนบางรายการ')}${row('noOrders','ยังไม่มีออเดอร์')}${row('noBrief','ไม่มีสรุปที่ต้องบอก')}${row('loading','กำลังโหลด')}
 <div class="dev-h" style="margin-top:1.2rem">ไปที่หน้า</div>
 <div class="dev-go">${Object.keys(SCREENS).map(k=>`<button data-go="${k}">${k}</button>`).join('')}</div>
 <div class="dev-go" style="margin-top:.6rem"><button data-reset="1">รีเซ็ตออเดอร์</button></div></div>`}

function render(){
 const auth=S.screen==='login';
 $('#app').innerHTML=auth?`<div class="oc oc--auth">${scLogin()}</div>${devPanel()}`
 :`<div class="oc">${side()}<main class="oc-main">${SCREENS[S.screen]()}</main>${nav()}</div>${cancelSheet()}${devPanel()}`;
 const nv=document.querySelector('.oc-nav');
 document.documentElement.style.setProperty('--oc-navh',(nv?Math.ceil(nv.getBoundingClientRect().height):0)+'px');
 if(auth&&S.login==='otp'&&!resendTimer)resendTimer=setInterval(()=>{if(S.resend>0){S.resend--;const b=$('[data-resend]');if(b){b.textContent=S.resend>0?`ขอรหัสใหม่ได้ใน ${S.resend} วินาที`:'ขอรหัสใหม่';b.classList.toggle('is-disabled',S.resend>0)}}},1000);
}
function advance(id){const o=S.orders.find(x=>x.id===id);const nx=NEXT[o.status];if(!nx)return;
 o.status=nx[0];o.unseen=false;o.log.push([new Date().toTimeString().slice(0,5),nx[1]]);render()}

document.addEventListener('click',e=>{
 const t=e.target.closest('[data-go],[data-goset],[data-open],[data-adv],[data-cancel],[data-reason],[data-next],[data-doCancel],[data-x],[data-bulk],[data-seen],[data-tile],[data-confirm],[data-undo],[data-perm],[data-otp],[data-login],[data-resend],[data-reset]');
 if(!t||t.classList.contains('is-disabled'))return;const d=t.dataset;
 if(d.otp){S.login='otp';S.resend=60;return render()}
 if(d.login){S.login=d.login;clearInterval(resendTimer);resendTimer=null;return render()}
 if(d.resend){S.resend=60;return render()}
 if(d.goset||d.go==='settings'){location.href='Console Setup.html';return}
 if(d.go==='reports'||d.go==='capture'){location.href='Console Reports.html';return}
 if(d.go){S.screen=d.go;S.cancel=null;window.scrollTo(0,0);return render()}
 if(d.open){S.open=d.open;S.screen='detail';const o=S.orders.find(x=>x.id===d.open);if(o)o.unseen=false;return render()}
 if(d.adv)return advance(d.adv);
 if(d.cancel){S.cancel={id:d.cancel,reason:'',confirm:false};return render()}
 if(d.reason){S.cancel.reason=d.reason;return render()}
 if(d.next){S.cancel.confirm=true;return render()}
 if(d.doCancel){const o=S.orders.find(x=>x.id===S.cancel.id);o.status='cancelled';o.unseen=false;o.log.push([new Date().toTimeString().slice(0,5),'ยกเลิก · '+S.cancel.reason]);S.cancel=null;return render()}
 if(d.x!==undefined&&(t.classList.contains('oc-scrim')||t.dataset.x)){S.cancel=null;return render()}
 if(d.bulk){live().filter(o=>o.slot===d.bulk).forEach(o=>{o.status='ready';o.unseen=false;o.log.push([new Date().toTimeString().slice(0,5),'พร้อมรับ'])});return render()}
 if(d.seen){S.orders.forEach(o=>o.unseen=false);return render()}
 if(d.tile){const x=TILES.find(i=>i.id===d.tile),l=S.cart.find(c=>c.id===x.id);l?l.q++:S.cart.push({...x,q:1});return render()}
 if(d.confirm){const tt=S.cart.reduce((a,l)=>a+l.p*l.q,0),n=S.cart.reduce((a,l)=>a+l.q,0);
  const rec={time:new Date().toTimeString().slice(0,5),n,t:tt,undo:true};S.recent.unshift(rec);S.recent=S.recent.slice(0,5);S.cart=[];
  setTimeout(()=>{rec.undo=false;if(S.screen==='quick')render()},120000);return render()}
 if(d.undo){S.recent.splice(+d.undo,1);return render()}
 if(d.perm){S.dev.perm=d.perm;return render()}
 if(d.reset){S.orders=seedOrders();S.recent=[];S.cart=[];return render()}});
document.addEventListener('change',e=>{const k=e.target.dataset.dev;if(k){S.dev[k]=e.target.checked;if(k==='partial'&&e.target.checked)S.dev.noRecipe=false;if(k==='noRecipe'&&e.target.checked)S.dev.partial=false;render()}});
document.addEventListener('input',e=>{const i=e.target.dataset.oi;if(i===undefined)return;
 const v=e.target.value.replace(/\D/g,'');
 if(v.length>1){v.split('').slice(0,6).forEach((c,k)=>{if(+i+k<6)S.otp[+i+k]=c});render();const b=document.querySelector(`[data-oi="${Math.min(5,+i+v.length)}"]`);if(b)b.focus();return}
 S.otp[+i]=v;e.target.value=v;if(v){const nx=document.querySelector(`[data-oi="${+i+1}"]`);if(nx)nx.focus();else render()}});
document.addEventListener('keydown',e=>{
 if(e.key==='Backspace'&&e.target.dataset.oi!==undefined&&!e.target.value){const p=document.querySelector(`[data-oi="${+e.target.dataset.oi-1}"]`);if(p){p.focus();S.otp[+e.target.dataset.oi-1]=''; p.value=''}}
 if((e.key==='d'||e.key==='D')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){window.__blDev=!window.__blDev;render()}});
document.addEventListener('contextmenu',e=>{const t=e.target.closest('[data-tile]');if(t){e.preventDefault();const x=TILES.find(i=>i.id===t.dataset.tile);alert('ตัวเลือกสำหรับ '+x.n+' (กดค้าง)')}});
render();
})();
