# BrewLedger — Agent Workflow

ลำดับการเรียก subagent สำหรับแต่ละประเภทงาน อ่านคู่กับ `README.md` ที่บอกว่า WBS ไหนใช้ agent ตัวไหน

---

## หลักการที่อยู่เบื้องหลังทุก flow

**คนออกแบบ คนทำ คนตรวจ ต้องไม่ใช่คนเดียวกัน** — agent ที่เพิ่งเขียนโค้ดเสร็จมีบริบทของสิ่งที่*ตั้งใจ*จะทำอยู่เต็มหัว จนอ่านโค้ดเป็นสิ่งที่ตั้งใจ แทนที่จะเป็นสิ่งที่เขียนออกมาจริง นี่คือเหตุผลเดียวที่ต้องแยก agent ตั้งแต่แรก

**Reviewer ไม่มีสิทธิ์เขียนไฟล์** — ไม่ใช่เพราะไม่ไว้ใจ แต่เพราะ agent ที่แก้ได้จะมีแรงจูงใจ "แก้ให้ผ่าน" แทนที่จะรายงานตามจริง

---

## 3 Pattern หลัก

### Pattern A — งาน schema และโครงสร้าง

ใช้กับ **WBS 3.5, 3.6, 3.7, 3.8, 5.7, 7.8**

```
1. architect          ออกแบบ DDL / policy / interface  →  ได้ spec
2. engineer           implement ตาม spec นั้น
3. qa_engineer        เขียน + รันเทสต์
4. redline_reviewer   ตรวจ (ควรเป็น session ใหม่)
```

ทำไมต้องมี architect นำ: schema, RLS และ serializer เกี่ยวพันกันหมด การให้ engineer ออกแบบไปเขียนไปทำให้ตัดสินใจทีละชิ้นโดยไม่เห็นภาพรวม แล้วต้องมาแก้ย้อนหลังซึ่งเป็นสิ่งที่แพงที่สุดในโปรเจกต์นี้

---

### Pattern B — งาน backend

ใช้กับ **WBS 5.3, 5.5, 5.6, 5.11, 6.2, 6.3, 6.6, 6.8, 6.9, 7.3, 7.4, 7.5**

```
1. engineer           implement จาก Claude Code Prompt ใน WBS ตรงๆ
2. qa_engineer        เขียน + รันเทสต์ตาม Testing block ของ entry นั้น
3. redline_reviewer   ตรวจ
```

ไม่ต้องผ่าน architect เพราะ WBS prompt ระบุรายละเอียดครบแล้ว — ยกเว้นถ้า entry นั้นต้องเพิ่มคอลัมน์ ให้กลับไปใช้ Pattern A

---

### Pattern C — งานหน้าจอ

ใช้กับ **WBS 4.3, 4.4, 4.6, 5.1, 5.2, 5.4, 5.8, 5.9, 5.10, 5.12, 6.1, 6.4, 6.5, 6.7, 7.1, 7.2, 7.6, 7.7**

```
1. engineer           implement จาก state matrix + prototype
2. redline_reviewer   ตรวจ Thai copy + tap target + RL-3 (ถ้าเป็น Customer Web)
```

ข้าม qa_engineer ได้เพราะเทสต์หน้าจออยู่รวมที่ **8.2 E2E** ทีเดียว การเขียน unit test ต่อหน้าจอไม่คุ้มค่าใช้จ่ายในโปรเจกต์ขนาดนี้

---

## ตัวอย่างจริง — WBS 5.5 (PromptPay QR)

```
> Use the architect agent to review the PromptPay payload design in WBS 5.5

> Use the engineer agent to implement WBS 5.5

> Use the qa_engineer agent to write the tests listed in the WBS 5.5 Testing block

> Use the redline_reviewer agent to audit WBS 5.5 against RL-1
```

⚠️ **ขั้นที่ 4 ควรเปิด session ใหม่** ถ้า engineer เพิ่งเขียนใน session เดียวกัน ตัว `redline_reviewer` มีคำสั่งให้แจ้งความขัดแย้งเองอยู่แล้ว แต่การเปิด session ใหม่ให้ผลตรวจที่ดีกว่า

---

## เมื่อ reviewer เจอปัญหา

```
redline_reviewer รายงาน CRITICAL / HIGH
        ↓
engineer แก้  (ส่ง finding block ให้ดูทั้งก้อน)
        ↓
qa_engineer รันเทสต์ซ้ำ
        ↓
redline_reviewer ตรวจซ้ำเฉพาะจุดที่แก้
```

**อย่าสั่ง engineer ว่า "แก้ตามที่ reviewer บอก" โดยไม่อ่านเอง** — ข้อเสนอของ reviewer ไม่ได้ถูกที่สุดเสมอ บางครั้งมันเสนอทางแก้ที่ทำให้ผ่านการตรวจแต่ผิดเจตนาของ WBS entry คุณเป็นคนตัดสิน

---

## Phase Gate — WBS 1.4

ปิด **Phase 3.0, 5.0, 7.0**

```
> Run qa_engineer and redline_reviewer in parallel on this branch
```

รันขนานกันได้เพราะไม่แตะไฟล์เดียวกัน — qa รันเทสต์ reviewer อ่านโค้ด

**เกณฑ์ผ่าน gate**

| Gate | ต้องยืนยันอะไรเพิ่ม |
|---|---|
| Phase 3.0 | RLS เปิดครบทุกตาราง · anon อ่านคอลัมน์ merchant ไม่ได้ · backup รันสำเร็จอย่างน้อย 1 ครั้ง · keep-alive ทำงาน |
| Phase 5.0 | ออเดอร์จ่ายเงินจบครบ 1 รอบ เงินเข้าพร้อมเพย์ร้าน · double-confirm ได้ผลครั้งเดียว |
| Phase 7.0 | ร้านที่ไม่มีสูตรเลยใช้งานครบวงจร ต้นทุนขึ้น `—` ไม่ใช่ 0 |

---

## Flow ทั้ง Phase — ตัวอย่าง Phase 3.0

```
architect      3.5 schema → 3.6 RLS → 3.7 API boundary → 3.8 storage
                   (ออกแบบรวดเดียว ก่อนเริ่ม implement)
     ↓
engineer       3.1 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9 → 3.10 → 3.11
     ↓
qa_engineer    schema introspection + RLS adversarial suite
     ↓
GATE           qa_engineer + redline_reviewer ขนานกัน
     ↓
              ผ่าน → เข้า Phase 4.0
```

ให้ architect ออกแบบทั้งกลุ่มก่อน ดีกว่าสลับไปมาทีละ entry

---

## กฎที่จำได้ใน 5 บรรทัด

| สถานการณ์ | เรียกใคร |
|---|---|
| แตะฐานข้อมูล / เพิ่มคอลัมน์ | **architect** ก่อนเสมอ |
| เขียนโค้ดอะไรก็ตาม | **engineer** |
| WBS entry มี Testing block | **qa_engineer** |
| แตะเงิน / ต้นทุน / หน้าลูกค้า | **redline_reviewer** ปิดท้าย |
| จะปิด Phase | **qa + reviewer ขนานกัน** |

---

## สิ่งที่ไม่ควรทำ

**อย่าเรียก redline_reviewer ทุก commit** — subagent ใช้โทเคนมากกว่า single-thread หลายเท่าเพราะแต่ละตัวมี context แยก เรียกเมื่อแตะ schema, payment, หรือ Customer Web เท่านั้น

**อย่าให้ engineer เขียนเทสต์เอง** — มันจะเขียนเทสต์ที่ผ่านโค้ดที่มันเพิ่งเขียน ไม่ใช่เทสต์ที่พิสูจน์ว่าโค้ดถูก

**อย่าข้าม architect ตอนแตะ schema** — migration ที่ผิดแก้ยากที่สุดในโปรเจกต์นี้ เพราะต้องเขียน migration ใหม่มาแก้ ไม่ใช่แก้ไฟล์เดิม

**อย่ารัน Pattern A ทีละ entry** — ให้ architect ออกแบบทั้งกลุ่มที่เกี่ยวข้องกันก่อน
