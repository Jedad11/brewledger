/* BrewLedger — Owner Console P3 (setup & onboarding). Vanilla. */
(function(){
const $=(s,r=document)=>r.querySelector(s);
const B=n=>n==null?'—':'฿'+n.toLocaleString('th-TH',{maximumFractionDigits:2});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=(v,cls='')=>`<span class="money ${v==null?'money--unknown':cls}">${B(v)}</span>`;

const RECIPES={'ลาเต้':[['เมล็ดกาแฟ',18,'ก.',0.9],['นมสด',200,'มล.',0.045],['แก้ว 16 ออนซ์',1,'ใบ',2.2]],
'อเมริกาโน่':[['เมล็ดกาแฟ',18,'ก.',0.9],['แก้ว 16 ออนซ์',1,'ใบ',2.2]],
'ชาไทย':[['ผงชาไทย',12,'ก.',0.35],['นมข้นหวาน',30,'ก.',0.08],['แก้ว 16 ออนซ์',1,'ใบ',2.2]]};
const guessRecipe=n=>{for(const k in RECIPES)if(n.includes(k))return RECIPES[k].map(r=>({n:r[0],q:r[1],u:r[2],c:r[3]}));return null};

const S={screen:'store',
store:{name:'ร้านสมใจ คอฟฟี่',addr:'ซอยอารีย์ 4 พหลโยธิน กรุงเทพฯ',open:'07:00',close:'16:00',slug:'somjai-coffee',published:true},
menu:[{id:1,n:'อเมริกาโน่',p:55,on:true},{id:2,n:'ลาเต้',p:60,on:true},{id:3,n:'ลาเต้เย็นหวานน้อยพิเศษเพิ่มช็อต',p:75,on:true},{id:4,n:'ชาไทย',p:50,on:true},{id:5,n:'มัทฉะลาเต้',p:70,on:false}],
edit:null,recipeOpen:false,recipe:null,
pay:{state:'linked',mid:'BLM-882301',tested:false},
plan:'starter',
dev:{noMenu:false,unpublished:false,payState:'linked',newItem:false,perm:'denied'}};

/* ---- shell (shared nav) ---- */
const NAV=[['dash','หน้าหลัก'],['orders','ออเดอร์'],['quick','ขายหน้าร้าน'],['reports','รายงาน'],['setup','ตั้งค่า']];
const SETUP=[['store','ข้อมูลร้าน'],['menu','เมนู'],['payments','การรับเงิน'],['link','ลิงก์และ QR'],['notify','การแจ้งเตือน'],['plan','แพ็กเกจ']];
function subnav(){const cur=S.screen==='item'?'menu':S.screen;
 return `<div class="oc-subnav">${SETUP.map(([k,l])=>`<button data-go="${k}" class="${cur===k?'is-active':''}">${l}</button>`).join('')}</div>`}
const top=(t,sub)=>`<header class="oc-top"><div><h1>${t}</h1>${sub?`<p class="note-plain">${sub}</p>`:''}</div></header>`;

/* onboarding strip — exactly 3 steps, never recipes */
function strip(){
 const done=[!!S.store.name&&!!S.store.addr,(S.dev.noMenu?0:S.menu.length)>0,S.dev.payState==='linked'];
 if(done.every(Boolean))return'';
 const steps=['ข้อมูลร้าน','เมนูอย่างน้อย 1 รายการ','เชื่อมช่องทางรับเงิน'];
 return `<div class="oc-strip">${steps.map((s,i)=>`<div class="oc-step${done[i]?' is-done':''}"><span class="oc-stepdot">${done[i]?'✓':i+1}</span>${s}</div>`).join('')}</div>`}

/* ---- 1. store profile ---- */
function scStore(){
 const url=`brewledger.app/s/${S.store.slug}`;
 return top('ข้อมูลร้าน')+`<div class="oc-body">${strip()}
 <div class="card oc-form">
 <div class="field"><label>ชื่อร้าน</label><input class="input" data-s="name" value="${esc(S.store.name)}"></div>
 <div class="field"><label>ที่อยู่สำหรับรับสินค้า</label><input class="input" data-s="addr" value="${esc(S.store.addr)}"></div>
 <div class="oc-two"><div class="field"><label>เวลาเปิด</label><input class="input" type="time" data-s="open" value="${S.store.open}"></div>
 <div class="field"><label>เวลาปิด</label><input class="input" type="time" data-s="close" value="${S.store.close}"></div></div>
 <div class="field"><label>ลิงก์ร้าน</label><input class="input" data-s="slug" value="${esc(S.store.slug)}"><p class="note-plain">ลูกค้าจะเข้าที่ <b>${url}</b> · ตั้งจากชื่อร้านให้อัตโนมัติ แก้ได้ตามต้องการ</p></div>
 <hr class="hair">
 <div class="oc-toggle"><div><b>เปิดให้ลูกค้าสั่งผ่านลิงก์</b><p class="note-plain">เมื่อเปิด ใครก็ตามที่มีลิงก์หรือสแกน QR จะเห็นเมนูและสั่งล่วงหน้าได้ · เมื่อปิด ลิงก์จะแจ้งว่ายังไม่เปิดรับออเดอร์ และคุณยังขายหน้าร้านได้ตามปกติ</p></div>
 <button class="oc-sw${S.store.published?' is-on':''}" data-pub="1" role="switch" aria-checked="${S.store.published}"><span></span></button></div>
 <button class="btn btn--primary btn--wet">บันทึก</button></div></div>`}

/* ---- 2. menu list ---- */
function scMenu(){
 if(S.dev.noMenu)return top('เมนู')+`<div class="oc-body">${strip()}<div class="empty"><div class="oc-mark"></div><h4>ยังไม่มีรายการในเมนู</h4><p class="note-plain">ใส่ชื่อกับราคาก็ขายได้แล้ว ใช้เวลาไม่ถึงหนึ่งนาที</p><button class="btn btn--primary btn--wet" style="max-width:320px" data-new="1">เพิ่มรายการแรก</button></div></div>`;
 return top('เมนู',`${S.menu.length} รายการ`)+`<div class="oc-body">${strip()}
 <div class="card oc-rows">${S.menu.map(m=>`<div class="oc-row"><span class="oc-drag" aria-hidden="true">⠿</span><div class="oc-photo"></div>
 <button class="oc-rowmain" data-edit="${m.id}"><b>${esc(m.n)}</b><span class="note-plain num">${B(m.p)}</span></button>
 <button class="oc-sw${m.on?' is-on':''}" data-on="${m.id}" role="switch" aria-checked="${m.on}" aria-label="พร้อมขาย"><span></span></button></div>`).join('')}</div>
 <button class="btn btn--primary btn--wet" data-new="1">เพิ่มรายการ</button></div>`}

/* ---- 3. item editor ---- */
function scItem(){
 const it=S.edit||{n:'',p:'',d:'',id:null};
 const cost=S.recipe?S.recipe.reduce((a,r)=>a+r.q*r.c,0):null;
 return `<header class="oc-top"><button class="btn btn--quiet" style="padding-left:0" data-go="menu">ย้อนกลับ</button><div><h1>${it.id?'แก้ไขรายการ':'รายการใหม่'}</h1></div></header>
 <div class="oc-body"><div class="card oc-form">
 <div class="field"><label>ชื่อรายการ</label><input class="input" data-e="n" value="${esc(it.n)}" placeholder="เช่น ลาเต้เย็น"></div>
 <div class="field"><label>ราคา</label><input class="input" inputmode="numeric" data-e="p" value="${it.p}" placeholder="60"></div>
 <button class="btn btn--primary btn--wet" data-save="1">บันทึก</button>
 <hr class="hair">
 <div class="field"><label>รูปภาพ</label><div class="oc-drop"><div class="oc-photo" style="width:72px;height:72px"></div><span class="note-plain">แตะเพื่อถ่ายหรือเลือกรูป</span></div></div>
 <div class="field"><label>คำอธิบาย</label><textarea class="input" rows="2" data-e="d" placeholder="นมสดกับเอสเพรสโซ่สองช็อต">${esc(it.d||'')}</textarea></div>
 <div class="field"><label>ตัวเลือก</label><div class="oc-optlist"><div class="oc-optrow"><b>ร้อน / เย็น / ปั่น</b><span class="note-plain">+0 / +5 / +10</span></div><div class="oc-optrow"><b>ระดับความหวาน</b><span class="note-plain">หวานปกติ / หวานน้อย / ไม่หวาน</span></div></div><button class="btn btn--outline" style="margin-top:1.2rem">เพิ่มกลุ่มตัวเลือก</button></div>
 </div>
 <div class="card oc-recipe">
 <button class="oc-rechead" data-rec="1" aria-expanded="${S.recipeOpen}"><span><b>สูตร (ใส่ทีหลังได้)</b></span><span class="oc-chev${S.recipeOpen?' is-open':''}">›</span></button>
 ${S.recipeOpen?recipeBody(it,cost):''}</div></div>`}
function recipeBody(it,cost){
 if(!S.recipe){const g=guessRecipe(it.n||'');
  return `<div class="oc-recbody"><p class="note-plain">${g?'มีสูตรมาตรฐานสำหรับรายการนี้อยู่แล้ว ใช้แล้วปรับตัวเลขให้ตรงกับร้านคุณได้เลย':'เริ่มจากบรรทัดว่างแล้วใส่วัตถุดิบทีละอย่าง'}</p>
  ${g?`<div class="oc-rectable">${g.map(r=>`<div class="oc-recrow"><span>${r.n}</span><span class="num">${r.q} ${r.u}</span><span class="num">${money(r.q*r.c)}</span></div>`).join('')}</div>
  <button class="btn btn--primary btn--wet" data-usrec="1">ใช้สูตรนี้แล้วแก้ได้</button>`:`<button class="btn btn--outline" data-usrec="1">เริ่มใส่สูตรเอง</button>`}</div>`}
 return `<div class="oc-recbody">
 <div class="oc-rectable is-edit">${S.recipe.map((r,i)=>`<div class="oc-recrow"><input class="input" value="${esc(r.n)}" data-r="${i}:n"><input class="input num" value="${r.q}" inputmode="decimal" data-r="${i}:q"><span class="note-plain">${r.u}</span><span class="num">${money(r.q*r.c)}</span></div>`).join('')}</div>
 <button class="btn btn--quiet" data-addrow="1">เพิ่มวัตถุดิบ</button>
 <div class="oc-costline"><span>ต้นทุนต่อแก้ว</span><div class="oc-big">${money(cost,'money--cost')}</div></div>
 ${it.p?`<p class="note-plain">ราคาขาย ${B(+it.p)} · กำไรต่อแก้ว ${B(+it.p-cost)}</p>`:''}</div>`}

/* ---- 4. payments ---- */
function scPayments(){
 const st=S.dev.payState;
 const chip={linked:['st--making','เชื่อมแล้ว'],pending:['st--unpaid','รอตรวจสอบเอกสาร'],none:['st--expired','ยังไม่ได้เชื่อม']}[st];
 return top('การรับเงิน')+`<div class="oc-body">${strip()}
 <div class="card oc-form"><div class="oc-orderhead"><h3>ช่องทางรับเงินออนไลน์</h3><span class="st ${chip[0]}">${chip[1]}</span></div>
 ${st==='pending'?`<div class="oc-note"><b>ระหว่างรอตรวจสอบเอกสาร</b><p>ขายหน้าร้านด้วยเงินสดได้เต็มรูปแบบตามปกติ มีเพียงการสั่งล่วงหน้าผ่านลิงก์ที่ยังปิดอยู่ ผู้ให้บริการชำระเงินมักใช้เวลา 1–2 วันทำการ</p></div>`:''}
 <div class="field"><label>รหัสร้านค้าจากผู้ให้บริการชำระเงิน</label><input class="input${st==='linked'?' is-valid':''}" data-p="mid" value="${esc(S.pay.mid)}" placeholder="BLM-000000"></div>
 <button class="btn btn--outline" data-test="1">ทดสอบการเชื่อมต่อ</button>
 ${S.pay.tested?`<div class="oc-note is-ok"><b>เชื่อมต่อสำเร็จ</b><p>เงินจะเข้าบัญชีชื่อ <b>ส. สมใจ พาณิชย์</b> ธนาคารกสิกรไทย ลงท้าย 4821</p></div>`:''}
 <p class="note-plain">เลขบัญชีธนาคารของคุณอยู่กับผู้ให้บริการชำระเงินเท่านั้น BrewLedger ไม่เก็บและไม่เห็นเลขบัญชีของคุณ</p>
 </div></div>`}

/* ---- 5. link & QR ---- */
function qrSvg(dim){let c='';const seed=[1,0,1,1,0,1,0,0,1,1,0,0,1,0,1,1,1,0,0,1,0,1,1,0,1];
 for(let y=0;y<21;y++)for(let x=0;x<21;x++)if((seed[(x*3+y*7)%25]+x*y)%3===0)c+=`<rect x="${x}" y="${y}" width="1" height="1"/>`;
 const eye=(x,y)=>`<rect x="${x}" y="${y}" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><rect x="${x+2}" y="${y+2}" width="3" height="3"/>`;
 return `<svg viewBox="-1 -1 23 23" width="100%" height="100%" fill="currentColor" shape-rendering="crispEdges" style="color:${dim?'#b9b9b4':'#16302b'}"><rect x="-1" y="-1" width="23" height="23" fill="#fff"/>${c}<rect x="0" y="0" width="7" height="7" fill="#fff"/><rect x="14" y="0" width="7" height="7" fill="#fff"/><rect x="0" y="14" width="7" height="7" fill="#fff"/>${eye(0,0)}${eye(14,0)}${eye(0,14)}</svg>`}
function scLink(){
 const pub=!S.dev.unpublished&&S.store.published,url=`brewledger.app/s/${S.store.slug}`;
 return top('ลิงก์และ QR')+`<div class="oc-body">${strip()}
 <div class="card oc-qrcard"><div class="oc-qr${pub?'':' is-dim'}">${qrSvg(!pub)}</div>
 <p class="oc-url" style="user-select:all">${url}</p>
 ${pub?`<div class="oc-qracts"><button class="btn btn--primary">คัดลอกลิงก์</button><button class="btn btn--outline">ดาวน์โหลด PNG</button><button class="btn btn--outline">พิมพ์ A5</button><button class="btn btn--outline">พิมพ์ A6</button></div>`
 :`<div class="oc-note"><b>ยังไม่เปิดให้ลูกค้าสั่ง</b><p>QR นี้จะใช้งานได้เมื่อเปิดสวิตช์ “เปิดให้ลูกค้าสั่งผ่านลิงก์” ในหน้าข้อมูลร้าน</p></div><button class="btn btn--primary btn--wet" data-go="store">ไปเปิดใช้งาน</button>`}</div>
 <div class="card"><h3>ตัวอย่างใบพิมพ์ A5</h3>
 <div class="oc-sheetprev"><b class="oc-sheetname">${esc(S.store.name)}</b><div class="oc-sheetqr">${qrSvg(false)}</div><p class="oc-sheetcta">สแกนสั่งล่วงหน้า รับได้เลยไม่ต้องรอคิว</p><p class="oc-sheeturl">${url}</p><span class="oc-sheetmark">BrewLedger</span></div></div></div>`}

/* ---- 6. plan ---- */
const PLANS=[['free','ทดลองใช้','฿0','ออเดอร์ 50 รายการ/เดือน · เมนูไม่จำกัด'],['starter','เริ่มต้น','฿199/เดือน','ออเดอร์ไม่จำกัด · รายงานกำไรรายวัน'],['pro','ร้านประจำ','฿449/เดือน','สแกนบิลอัตโนมัติ · กำไรต่อเมนู · คลังวัตถุดิบ'],['multi','หลายสาขา','฿990/เดือน','จัดการหลายสาขา · รายงานรวม · ผู้ใช้หลายคน']];
function scPlan(){
 return top('แพ็กเกจ')+`<div class="oc-body">
 <div class="card"><p class="note-plain">แพ็กเกจปัจจุบัน</p><h3>เริ่มต้น · ฿199/เดือน</h3><p class="note-plain">ต่ออายุอัตโนมัติ 1 ก.ย. 2569</p>
 <div class="oc-feeline">ค่าธรรมเนียมช่วงทดลอง: BrewLedger ออกให้</div></div>
 <div class="oc-plans">${PLANS.map(([k,n,pr,d])=>`<div class="card oc-plan${S.plan===k?' is-cur':''}"><b>${n}</b><div class="oc-planprice">${pr}</div><p class="note-plain">${d}</p>${S.plan===k?`<span class="st st--making">ใช้อยู่</span>`:`<button class="btn btn--outline" data-plan="${k}">เลือกแพ็กเกจนี้</button>`}</div>`).join('')}</div>
 <div class="card"><h3>อัปเกรดแล้วได้อะไรเพิ่ม</h3><div class="oc-rows">${['สแกนบิลผู้ขายแล้วเก็บต้นทุนอัตโนมัติ','รายงานกำไรต่อเมนู เรียงตามกำไรรวม','คลังวัตถุดิบและวันที่ของจะหมด','ผู้ใช้หลายคนต่อร้าน'].map(x=>`<div class="oc-row" style="grid-template-columns:auto 1fr"><span class="oc-tick">✓</span><span>${x}</span></div>`).join('')}</div></div></div>`}

/* ---- notifications (was P2) ---- */
function scNotify(){
 const p=S.dev.perm;
 return top('การแจ้งเตือน')+`<div class="oc-body">
 <div class="card oc-form"><h3>การแจ้งเตือนออเดอร์ใหม่</h3>
 ${p==='ask'?`<p class="note-plain">เปิดการแจ้งเตือนเพื่อให้รู้ทันทีที่มีออเดอร์เข้า</p><button class="btn btn--primary btn--wet" data-perm="granted">เปิดการแจ้งเตือน</button>`:''}
 ${p==='granted'?`<p class="note-plain">เปิดอยู่ · อุปกรณ์นี้จะแจ้งเตือนเมื่อมีออเดอร์ใหม่</p><span class="st st--making" style="justify-self:start">เปิดใช้งานแล้ว</span>`:''}
 ${p==='denied'?`<p class="note-plain">อุปกรณ์นี้ปิดการแจ้งเตือนไว้ ระบบจึงตรวจหาออเดอร์ใหม่ให้ทุก 10 วินาทีขณะเปิดหน้านี้อยู่</p>
 <div class="oc-poll"><span class="dot"></span>กำลังตรวจหาออเดอร์ใหม่ · อัปเดตล่าสุด <b class="num">08:22:41</b></div>
 <p class="note-plain">บน iPhone ต้องเพิ่มเว็บนี้ลงหน้าจอโฮมก่อน การแจ้งเตือนจึงจะทำงานได้ — เปิดเมนูแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”</p>`:''}</div>
 <div class="card"><h3>รูปแบบการแจ้งเตือนในระบบ</h3>
 <div class="oc-patrow"><span>ตัวเลขบนแท็บออเดอร์</span><span class="oc-badgeflat num">3</span></div>
 <div class="oc-patrow"><span>แถบออเดอร์ใหม่ ค้างจนกดรับทราบ</span><span class="st st--ready">ค้างไว้</span></div>
 <div class="oc-patrow"><span>ขอบซ้ายหนาบนออเดอร์ที่ยังไม่ได้เปิด</span><span class="oc-newmark"></span></div></div>
 <div class="card"><h3>สถานะสิทธิ์การแจ้งเตือน</h3><div class="oc-perms">${[['ask','ยังไม่ได้ถาม'],['granted','อนุญาตแล้ว'],['denied','ถูกปฏิเสธ']].map(([k,l])=>`<button class="oc-chip${p===k?' is-on':''}" data-perm="${k}">${l}</button>`).join('')}</div></div></div>`}

const SCREENS={store:scStore,menu:scMenu,item:scItem,payments:scPayments,link:scLink,notify:scNotify,plan:scPlan};
function devPanel(){
 const d=S.dev,row=(k,l)=>`<label class="dv"><input type="checkbox" data-dev="${k}" ${d[k]?'checked':''}>${l}</label>`;
 return `<div class="dev${window.__blDev?' is-open':''}"><div class="dev-h">สถานะพิเศษ <span class="note-plain">กด D เพื่อซ่อน</span></div>
 ${row('noMenu','ร้านที่ยังไม่มีเมนู')}${row('unpublished','ยังไม่เปิดให้สั่ง')}
 <div class="dev-h" style="margin-top:1.2rem">สถานะการรับเงิน</div>
 <select data-pay>${[['linked','เชื่อมแล้ว'],['pending','รอตรวจสอบ'],['none','ยังไม่ได้เชื่อม']].map(([v,l])=>`<option value="${v}" ${d.payState===v?'selected':''}>${l}</option>`).join('')}</select>
 <div class="dev-h" style="margin-top:1.2rem">ไปที่หน้า</div>
 <div class="dev-go">${Object.keys(SCREENS).map(k=>`<button data-go="${k}">${k}</button>`).join('')}</div></div>`}
function render(){
 $('#app').innerHTML=`<div class="oc"><aside class="oc-side"><div class="wordmark">BrewLedger</div>${NAV.map(([k,l])=>`<button class="${k==='setup'?'is-active':''}" ${k==='setup'?'':`data-ext="${k}"`}>${l}</button>`).join('')}</aside>
 <main class="oc-main">${subnav()}${SCREENS[S.screen]()}</main>
 <nav class="oc-nav">${NAV.map(([k,l])=>`<button ${k==='setup'?'class="is-active"':`data-ext="${k}"`}><span class="glyph"></span>${l}</button>`).join('')}</nav></div>${devPanel()}`}

document.addEventListener('click',e=>{
 const t=e.target.closest('[data-go],[data-pub],[data-on],[data-edit],[data-new],[data-save],[data-rec],[data-usrec],[data-addrow],[data-test],[data-plan],[data-ext],[data-perm]');
 if(!t||t.classList.contains('is-disabled'))return;const d=t.dataset;
 if(d.perm){S.dev.perm=d.perm;return render()}
 if(d.ext){location.href=d.ext==='reports'?'Console Reports.html':'Owner Console.html';return}
 if(d.go){S.screen=d.go;window.scrollTo(0,0);return render()}
 if(d.pub){S.store.published=!S.store.published;S.dev.unpublished=!S.store.published;return render()}
 if(d.on){const m=S.menu.find(x=>x.id==d.on);m.on=!m.on;return render()}
 if(d.edit){S.edit={...S.menu.find(x=>x.id==d.edit)};S.recipe=null;S.recipeOpen=false;S.screen='item';return render()}
 if(d.new){S.edit={n:'',p:'',d:'',id:null};S.recipe=null;S.recipeOpen=false;S.screen='item';return render()}
 if(d.save){const it=S.edit;if(!it.n||!it.p)return;
  if(it.id){Object.assign(S.menu.find(x=>x.id===it.id),{n:it.n,p:+it.p})}else{S.menu.push({id:Date.now(),n:it.n,p:+it.p,on:true});S.dev.noMenu=false}
  S.screen='menu';return render()}
 if(d.rec){S.recipeOpen=!S.recipeOpen;return render()}
 if(d.usrec){S.recipe=guessRecipe(S.edit.n||'')||[{n:'',q:0,u:'ก.',c:0}];return render()}
 if(d.addrow){S.recipe.push({n:'',q:0,u:'ก.',c:0});return render()}
 if(d.test){S.pay.tested=true;return render()}
 if(d.plan){S.plan=d.plan;return render()}});
document.addEventListener('input',e=>{const t=e.target,d=t.dataset;
 if(d.s){S.store[d.s]=t.value;if(d.s==='name'){const sl=t.value.trim().replace(/\s+/g,'-').toLowerCase()||'my-shop';S.store.slug=/[ก-๙]/.test(t.value)?'somjai-coffee':sl;const p=document.querySelector('[data-s="slug"]');if(p)p.value=S.store.slug;const u=document.querySelector('[data-s="slug"]').closest('.field').querySelector('b');if(u)u.textContent='brewledger.app/s/'+S.store.slug}}
 if(d.e)S.edit[d.e]=t.value;
 if(d.p)S.pay[d.p]=t.value;
 if(d.r){const[i,k]=d.r.split(':');S.recipe[i][k]=k==='q'?+t.value||0:t.value;const c=S.recipe.reduce((a,r)=>a+r.q*r.c,0);const el=document.querySelector('.oc-costline .money');if(el){el.textContent=B(c);el.className='money money--cost'}}});
document.addEventListener('change',e=>{const k=e.target.dataset.dev;if(k){S.dev[k]=e.target.checked;render()}
 if(e.target.hasAttribute('data-pay')){S.dev.payState=e.target.value;S.pay.tested=false;S.screen='payments';render()}});
document.addEventListener('keydown',e=>{if((e.key==='d'||e.key==='D')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){window.__blDev=!window.__blDev;render()}});
render();
})();
