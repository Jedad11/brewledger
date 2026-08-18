/* BrewLedger — Customer Web (P1). Vanilla, no framework. */
(function(){
const $=(s,r=document)=>r.querySelector(s);
const B=n=>n==null?'—':'฿'+n.toLocaleString('th-TH');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const STORE={name:'ร้านสมใจ คอฟฟี่',slug:'somjai-coffee',addr:'ซอยอารีย์ 4 พหลโยธิน กรุงเทพฯ',hours:'07:00 – 16:00 (จ.–ส.)',next:'พรุ่งนี้ 07:00'};
const MENU=[
{cat:'กาแฟ',items:[
{id:'am',n:'อเมริกาโน่',d:'เมล็ดคั่วกลาง กลิ่นคาราเมล',p:55},
{id:'lt',n:'ลาเต้',d:'นมสดกับเอสเพรสโซ่สองช็อต',p:60},
{id:'ltx',n:'ลาเต้เย็นหวานน้อยพิเศษเพิ่มช็อต',d:'สูตรประจำร้าน สำหรับคนติดคาเฟอีน',p:75},
{id:'cp',n:'คาปูชิโน่',d:'ฟองนมหนา โรยผงโกโก้',p:60},
{id:'es',n:'เอสเพรสโซ่',d:'ช็อตเดียว เข้มจัด',p:45}]},
{cat:'ชาและนม',items:[
{id:'mc',n:'มัทฉะลาเต้',d:'มัทฉะจากอุจิ',p:70,out:true},
{id:'th',n:'ชาไทย',d:'ชาไทยแท้ นมข้นหวาน',p:50},
{id:'co',n:'โกโก้',d:'ผงโกโก้เข้มข้น 70%',p:55}]},
{cat:'ขนม',items:[
{id:'cr',n:'ครัวซองต์เนยสด',d:'อบใหม่ทุกเช้า',p:65},
{id:'bw',n:'บราวนี่',d:'หน้ากรอบ เนื้อหนึบ',p:55}]}];
const OPTS=[
{id:'temp',n:'ร้อน / เย็น / ปั่น',ch:[{id:'hot',n:'ร้อน',d:0},{id:'ice',n:'เย็น',d:5},{id:'bl',n:'ปั่น',d:10}]},
{id:'sweet',n:'ระดับความหวาน',ch:[{id:'s100',n:'หวานปกติ',d:0},{id:'s50',n:'หวานน้อย',d:0},{id:'s0',n:'ไม่หวาน',d:0}]}];
const SLOTS=[
{h:'08:00',list:[{t:'08:00',left:3},{t:'08:15',left:1},{t:'08:30',left:0},{t:'08:45',left:5}]},
{h:'09:00',list:[{t:'09:00',left:0},{t:'09:15',left:4},{t:'09:30',left:2},{t:'09:45',left:5}]},
{h:'10:00',list:[{t:'10:00',left:5},{t:'10:15',left:5},{t:'10:30',left:5},{t:'10:45',left:5}]}];

const S={screen:'menu',sheet:null,cart:[],slot:null,name:'',phone:'',order:null,secs:14*60+38,payState:'wait',trackStep:2,
dev:{closed:false,slotsFull:false,noMenu:false,qrExpired:false,paying:false,slotTaken:false,track:'normal',findErr:false}};
let timer=null;

const findItem=id=>{for(const g of MENU)for(const it of g.items)if(it.id===id)return it};
const lineTotal=l=>{const it=findItem(l.item);let p=it.p;for(const g of OPTS){const c=g.ch.find(c=>c.id===l.opts[g.id]);if(c)p+=c.d}return p*l.q};
const cartCups=()=>S.cart.reduce((a,l)=>a+l.q,0);
const cartTotal=()=>S.cart.reduce((a,l)=>a+lineTotal(l),0);
const optLabel=l=>OPTS.map(g=>g.ch.find(c=>c.id===l.opts[g.id])).filter(Boolean).map(c=>c.n).join(' · ');
const ordering=()=>!S.dev.closed&&!S.dev.slotsFull;

function header(title,back){return `<header class="cw-header">${back?`<button class="back" data-go="${back}" aria-label="ย้อนกลับ"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 4 6.5 10l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`:''}<span class="name">${esc(title)}</span></header>`}
function cartbar(){if(!S.cart.length||S.screen!=='menu')return'';if(!ordering())return `<div class="cw-cartbar"><span class="cw-sum">${cartCups()} แก้ว · ${B(cartTotal())}</span><button class="btn" disabled>สั่งได้อีกครั้ง ${STORE.next}</button></div>`;return `<div class="cw-cartbar"><span class="cw-sum">${cartCups()} แก้ว · ${B(cartTotal())}</span><button class="btn" data-go="cart">ดูตะกร้า</button></div>`}
const ph=(h=64)=>`<div class="cw-photo" style="height:${h}px;width:${h}px"></div>`;

/* 1. MENU */
function scMenu(){
 if(S.dev.noMenu)return header(STORE.name)+`<div class="cw-body"><div class="empty"><div class="cw-mark"></div><h4>ร้านนี้ยังไม่ได้เพิ่มเมนู</h4><p class="note-plain">ลองกลับมาใหม่อีกครั้ง หรือสอบถามที่เคาน์เตอร์ได้เลย</p></div></div>`;
 const banner=S.dev.closed?`<div class="cw-notice"><b>ตอนนี้ร้านปิดอยู่</b><p>ดูเมนูได้ตามปกติ สั่งได้อีกครั้ง ${STORE.next}</p></div>`
  :S.dev.slotsFull?`<div class="cw-notice"><b>ช่วงเวลารับวันนี้เต็มแล้ว</b><p>สั่งล่วงหน้าสำหรับ ${STORE.next} ได้ที่หน้าถัดไป</p></div>`:'';
 const groups=MENU.map(g=>`<section class="cw-group"><h3>${g.cat}</h3><div class="cw-list">${g.items.map(it=>{
  const off=it.out||!ordering();
  return `<button class="cw-item${off?' is-out':''}" ${off?'disabled':''} data-item="${it.id}">${ph()}<span class="cw-item-txt"><b>${esc(it.n)}</b><span class="note-plain">${it.out?'หมดชั่วคราว':esc(it.d)}</span></span><span class="num cw-price">${B(it.p)}</span></button>`}).join('')}</div></section>`).join('');
 return header(STORE.name)+`<div class="cw-body">
 <div class="cw-store"><div class="cw-storehead"><h2>${STORE.name}</h2><span class="st ${S.dev.closed?'st--expired':'st--making'}">${S.dev.closed?'ปิดอยู่':'เปิดอยู่'}</span></div>
 <p class="note-plain">${STORE.addr}</p><p class="note-plain">เวลาเปิด ${STORE.hours}</p></div>${banner}${groups}</div>`+cartbar()}

/* 2. OPTIONS SHEET */
function sheet(){
 if(!S.sheet)return'';
 const it=findItem(S.sheet.item);let p=it.p;
 OPTS.forEach(g=>{const c=g.ch.find(c=>c.id===S.sheet.opts[g.id]);if(c)p+=c.d});
 return `<div class="cw-scrim" data-close="1"></div><div class="cw-sheet"><div class="cw-sheet-scroll">
 <div class="cw-hero"></div><h3>${esc(it.n)}</h3><p class="note-plain">${esc(it.d)}</p><p class="num cw-base">${B(it.p)}</p>
 ${OPTS.map(g=>`<div class="cw-optg"><h4>${g.n}</h4><div class="cw-opts">${g.ch.map(c=>`<button class="cw-opt${S.sheet.opts[g.id]===c.id?' is-on':''}" data-opt="${g.id}:${c.id}">${c.n}${c.d?`<span class="num">+${c.d}</span>`:''}</button>`).join('')}</div></div>`).join('')}
 <div class="cw-optg"><h4>จำนวน</h4><div class="cw-step"><button data-q="-1" aria-label="ลด">−</button><span class="num">${S.sheet.q}</span><button data-q="1" aria-label="เพิ่ม">+</button></div></div>
 </div><div class="cw-sheet-foot"><button class="btn btn--primary btn--wet" data-add="1">ใส่ตะกร้า · ${B(p*S.sheet.q)}</button></div></div>`}

/* 3. CART */
function scCart(){
 if(!S.cart.length)return header('ตะกร้า','menu')+`<div class="cw-body"><div class="empty"><div class="cw-mark"></div><h4>ตะกร้ายังว่างอยู่</h4><p class="note-plain">เลือกเครื่องดื่มจากเมนูได้เลย</p><button class="btn btn--outline" data-go="menu">กลับไปดูเมนู</button></div></div>`;
 return header('ตะกร้า','menu')+`<div class="cw-body">${S.cart.map((l,i)=>`<div class="card cw-line"><div class="cw-line-top"><div><b>${esc(findItem(l.item).n)}</b><p class="note-plain">${optLabel(l)}</p></div><b class="num">${B(lineTotal(l))}</b></div>
 <div class="cw-line-bot"><div class="cw-step"><button data-cq="${i}:-1">−</button><span class="num">${l.q}</span><button data-cq="${i}:1">+</button></div><button class="btn btn--quiet" data-rm="${i}">ลบ</button></div></div>`).join('')}
 <button class="btn btn--outline" data-go="menu" style="width:100%">เพิ่มรายการอีก</button>
 <div class="card cw-total"><span>รวมทั้งหมด</span><b class="num">${B(cartTotal())}</b></div></div>
 <div class="cw-cartbar"><span class="cw-sum">${cartCups()} แก้ว · ${B(cartTotal())}</span><button class="btn" data-go="checkout">เลือกเวลารับ</button></div>`}

/* 4. CHECKOUT */
function scCheckout(){
 const full=S.dev.slotsFull;
 const slots=full?'':SLOTS.map(g=>{const av=g.list.filter(s=>s.left>0);if(!av.length)return'';
  return `<div class="cw-slotg"><h4>${g.h} น.</h4><div class="cw-slots">${av.map(s=>`<button class="cw-slot${S.slot===s.t?' is-on':''}" data-slot="${s.t}"><b class="num">${s.t}</b>${s.left<=2?`<span class="note-plain">เหลือ ${s.left} ที่</span>`:''}</button>`).join('')}</div></div>`}).join('');
 const taken=S.dev.slotTaken?`<div class="cw-notice"><b>ช่วงเวลา 08:15 เพิ่งเต็มพอดี</b><p>รายการเวลาด้านล่างอัปเดตให้แล้ว เลือกเวลาใหม่ได้เลย</p></div>`:'';
 return header('เลือกเวลารับ','cart')+`<div class="cw-body">${taken}
 ${full?`<div class="cw-notice"><b>วันนี้เต็มทุกช่วงเวลาแล้ว</b><p>สั่งล่วงหน้าสำหรับ ${STORE.next} ได้</p></div>`:slots}
 <div class="card"><div class="field"><label>ชื่อผู้สั่ง <span class="req">จำเป็น</span></label><input class="input" id="f-name" value="${esc(S.name)}" placeholder="ชื่อที่ใช้เรียกรับเครื่องดื่ม"></div>
 <div class="field" style="margin-top:1.6rem"><label>เบอร์โทร <span class="note-plain">ไม่ใส่ก็ได้</span></label><input class="input" id="f-phone" value="${esc(S.phone)}" placeholder="08X-XXX-XXXX" inputmode="tel"></div></div>
 <div class="card"><h4>สรุปรายการ</h4>${S.cart.map(l=>`<div class="cw-sumline"><span>${esc(findItem(l.item).n)} × ${l.q}<br><span class="note-plain">${optLabel(l)}</span></span><b class="num">${B(lineTotal(l))}</b></div>`).join('')}<hr class="hair"><div class="cw-sumline cw-total"><span>รวมทั้งหมด</span><b class="num">${B(cartTotal())}</b></div></div></div>
 <div class="cw-cartbar"><span class="cw-sum">${S.slot?'รับ '+S.slot+' น.':'ยังไม่ได้เลือกเวลา'}</span><button class="btn" data-go="pay" ${S.slot&&!full?'':'disabled'}>ไปชำระเงิน</button></div>`}

/* 5. PAY */
function scPay(){
 const code='SJ-4821';
 const m=String(Math.floor(S.secs/60)).padStart(2,'0'),s=String(S.secs%60).padStart(2,'0');
 if(S.dev.qrExpired)return header('ชำระเงิน','checkout')+`<div class="cw-body cw-pay"><div class="card cw-paycard"><div class="cw-expired"><h3>QR หมดเวลาแล้ว</h3><p class="note-plain">ยังไม่มีการตัดเงิน ขอรหัสใหม่แล้วชำระได้ตามปกติ</p></div><button class="btn btn--primary btn--wet" data-newqr="1">ขอ QR ใหม่</button></div></div>`;
 if(S.dev.paying)return header('ชำระเงิน','checkout')+`<div class="cw-body cw-pay"><div class="card cw-paycard"><div class="cw-checking"><span class="spinner"></span><h3>กำลังตรวจสอบการชำระเงิน</h3><p class="note-plain">ถ้าโอนแล้ว ไม่ต้องปิดหน้านี้ ระบบจะอัปเดตให้เองภายในไม่กี่วินาที</p></div></div></div>`;
 return header('ชำระเงิน','checkout')+`<div class="cw-body cw-pay">
 <div class="card cw-paycard"><p class="note-plain">ยอดที่ต้องชำระ</p><div class="cw-amount num">${B(cartTotal())}</div>
 <div class="cw-qr">${qrSvg()}</div>
 <p class="cw-instr">สแกนด้วยแอปธนาคารของคุณ แล้วกลับมาที่หน้านี้</p>
 <div class="cw-codeline">รหัสออเดอร์ <b class="num" style="user-select:all">${code}</b></div>
 <div class="cw-count"><span class="dot"></span>ระบบกำลังรอการชำระเงิน · หมดเวลาใน <b class="num">${m}:${s}</b></div></div></div>`}
function qrSvg(){let c='';const seed=[1,0,1,1,0,1,0,0,1,1,0,0,1,0,1,1,1,0,0,1,0,1,1,0,1];
 for(let y=0;y<21;y++)for(let x=0;x<21;x++){const on=(seed[(x*3+y*7)%25]+x*y)%3===0;if(on)c+=`<rect x="${x}" y="${y}" width="1" height="1"/>`}
 const eye=(x,y)=>`<rect x="${x}" y="${y}" width="7" height="7" fill="none" stroke="#16302b" stroke-width="1"/><rect x="${x+2}" y="${y+2}" width="3" height="3"/>`;
 return `<svg viewBox="-1 -1 23 23" width="100%" height="100%" fill="#16302b" shape-rendering="crispEdges"><rect x="-1" y="-1" width="23" height="23" fill="#fff"/>${c}<rect x="0" y="0" width="7" height="7" fill="#fff"/><rect x="14" y="0" width="7" height="7" fill="#fff"/><rect x="0" y="14" width="7" height="7" fill="#fff"/>${eye(0,0)}${eye(14,0)}${eye(0,14)}</svg>`}

/* 6. TRACK ORDER */
function scOrder(){
 const t=S.dev.track,code='SJ-4821';
 const term=(title,body,btn,go)=>header('ติดตามออเดอร์')+`<div class="cw-body"><div class="card"><p class="note-plain">รหัสออเดอร์ <b class="num">${code}</b></p><h3 style="margin-top:.8rem">${title}</h3><p class="note-plain" style="margin-top:.8rem">${body}</p>${btn?`<button class="btn btn--outline" style="margin-top:2rem" data-go="${go}">${btn}</button>`:''}</div></div>`;
 if(t==='cancelled')return term('ร้านยกเลิกออเดอร์นี้','เหตุผลจากร้าน: วัตถุดิบหมด<br>เงินจะคืนเข้าบัญชีเดิมภายใน 3–5 วันทำการ','สั่งใหม่อีกครั้ง','menu');
 if(t==='expired')return term('หมดเวลาชำระเงิน','ออเดอร์นี้ถูกยกเลิกเพราะไม่ได้ชำระเงินภายในเวลาที่กำหนด ยังไม่มีการตัดเงิน','สั่งใหม่อีกครั้ง','menu');
 if(t==='notfound')return header('ติดตามออเดอร์')+`<div class="cw-body"><div class="empty"><div class="cw-mark"></div><h4>ไม่พบออเดอร์นี้</h4><p class="note-plain">ตรวจสอบรหัสอีกครั้ง หรือค้นหาด้วยเบอร์โทรที่ใช้สั่ง</p><button class="btn btn--outline" data-go="find">ค้นหาออเดอร์</button></div></div>`;
 const steps=['รับออเดอร์','กำลังทำ','พร้อมรับ','รับแล้ว'];
 const cur=t==='collected'?3:S.trackStep;
 return header('ติดตามออเดอร์')+`<div class="cw-body">
 <div class="card"><p class="note-plain">รหัสออเดอร์</p><div class="cw-code num">${code}</div><p class="note-plain">รับเวลา <b class="num">${S.slot||'08:15'} น.</b> ที่ ${STORE.name}</p></div>
 <div class="card"><div class="cw-steps">${steps.map((s,i)=>`<div class="cw-stepitem${i<cur?' is-done':''}${i===cur?' is-now':''}"><span class="cw-dot">${i<cur?'✓':''}</span><span>${s}</span></div>`).join('')}</div></div>
 <div class="card"><h4>รายการที่สั่ง</h4>${(S.cart.length?S.cart:[{item:'ltx',q:1,opts:{temp:'ice',sweet:'s50'}},{item:'cr',q:1,opts:{}}]).map(l=>`<div class="cw-sumline"><span>${esc(findItem(l.item).n)}<br><span class="note-plain">${optLabel(l)}</span></span><b class="num">× ${l.q}</b></div>`).join('')}</div>
 ${cur===3?`<div class="card"><h4>ขอบคุณที่อุดหนุน</h4><p class="note-plain">แล้วพบกันใหม่</p><button class="btn btn--outline" style="margin-top:1.6rem" data-go="menu">กลับไปที่เมนูร้าน</button></div>`:''}</div>`}

/* 7. FIND */
function scFind(){return header('ค้นหาออเดอร์')+`<div class="cw-body">
 <div class="card"><p class="note-plain">ใส่เบอร์โทรที่ใช้ตอนสั่ง และรหัสออเดอร์ที่ได้รับ</p>
 <div class="field" style="margin-top:1.6rem"><label>เบอร์โทร <span class="req">จำเป็น</span></label><input class="input${S.dev.findErr?' is-error':''}" placeholder="08X-XXX-XXXX" inputmode="tel"></div>
 <div class="field" style="margin-top:1.6rem"><label>รหัสออเดอร์ <span class="req">จำเป็น</span></label><input class="input${S.dev.findErr?' is-error':''}" placeholder="SJ-0000"></div>
 ${S.dev.findErr?`<p class="err" style="margin-top:1.2rem">ไม่พบออเดอร์ที่ตรงกับข้อมูลนี้ ลองตรวจสอบอีกครั้ง</p>`:''}
 <button class="btn btn--primary btn--wet" style="margin-top:2rem" data-go="order">ค้นหา</button></div></div>`}

const SCREENS={menu:scMenu,cart:scCart,checkout:scCheckout,pay:scPay,order:scOrder,find:scFind};

function devPanel(){
 const d=S.dev,row=(k,l)=>`<label class="dv"><input type="checkbox" data-dev="${k}" ${d[k]?'checked':''}>${l}</label>`;
 return `<div class="dev${window.__blDev?' is-open':''}">
 <div class="dev-h">สถานะพิเศษ <span class="note-plain">กด D เพื่อซ่อน</span></div>
 ${row('closed','ร้านปิดอยู่')}${row('slotsFull','ช่วงเวลาเต็มทั้งวัน')}${row('noMenu','ร้านยังไม่มีเมนู')}${row('slotTaken','เวลาที่เลือกเต็มระหว่างกรอกชื่อ')}${row('qrExpired','QR หมดเวลา')}${row('paying','กลับจากแอปธนาคาร (กำลังตรวจสอบ)')}${row('findErr','ค้นหาไม่พบ')}
 <div class="dev-h" style="margin-top:1.2rem">หน้าติดตาม</div>
 <select data-track>${['normal','collected','cancelled','expired','notfound'].map(v=>`<option value="${v}" ${d.track===v?'selected':''}>${v}</option>`).join('')}</select>
 <div class="dev-h" style="margin-top:1.2rem">ไปที่หน้า</div>
 <div class="dev-go">${Object.keys(SCREENS).map(k=>`<button data-go="${k}">${k}</button>`).join('')}</div></div>`}

function render(){
 $('#app').innerHTML=`<div class="cw">${SCREENS[S.screen]()}${sheet()}</div>${devPanel()}`;
 if(timer)clearInterval(timer);
 if(S.screen==='pay'&&!S.dev.qrExpired&&!S.dev.paying){timer=setInterval(()=>{if(S.secs>0){S.secs--;const e=$('.cw-count b');if(e)e.textContent=String(Math.floor(S.secs/60)).padStart(2,'0')+':'+String(S.secs%60).padStart(2,'0')}},1000)}
}

document.addEventListener('input',e=>{if(e.target.id==='f-name')S.name=e.target.value;if(e.target.id==='f-phone')S.phone=e.target.value});
document.addEventListener('change',e=>{
 const k=e.target.dataset.dev;if(k){S.dev[k]=e.target.checked;render()}
 if(e.target.hasAttribute('data-track')){S.dev.track=e.target.value;S.screen='order';render()}});
document.addEventListener('click',e=>{
 const t=e.target.closest('[data-go],[data-item],[data-opt],[data-q],[data-add],[data-cq],[data-rm],[data-slot],[data-close],[data-newqr]');if(!t)return;
 const d=t.dataset;
 if(d.close!==undefined&&t.classList.contains('cw-scrim')){S.sheet=null;return render()}
 if(d.item){S.sheet={item:d.item,q:1,opts:{temp:'ice',sweet:'s100'}};return render()}
 if(d.opt){const[g,c]=d.opt.split(':');S.sheet.opts[g]=c;return render()}
 if(d.q){S.sheet.q=Math.max(1,S.sheet.q+ +d.q);return render()}
 if(d.add){S.cart.push({item:S.sheet.item,q:S.sheet.q,opts:{...S.sheet.opts}});S.sheet=null;return render()}
 if(d.cq){const[i,v]=d.cq.split(':');S.cart[i].q=Math.max(1,S.cart[i].q+ +v);return render()}
 if(d.rm!==undefined&&d.rm!==''){S.cart.splice(+d.rm,1);return render()}
 if(d.slot){S.slot=d.slot;return render()}
 if(d.newqr){S.dev.qrExpired=false;S.secs=15*60;return render()}
 if(d.go){if(t.hasAttribute('disabled'))return;S.screen=d.go;S.sheet=null;window.scrollTo(0,0);return render()}});
document.addEventListener('keydown',e=>{if(e.key==='d'||e.key==='D'){if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;window.__blDev=!window.__blDev;render()}});
render();
})();
