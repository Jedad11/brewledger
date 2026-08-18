# BrewLedger — Claude Code Subagents

วางที่ **`.claude/agents/`** ใน repo แล้ว commit ลง git

```
brewledger/
└── .claude/agents/
    ├── architect.md          ออกแบบ schema / RLS / ขอบเขต
    ├── engineer.md           ลงมือเขียนโค้ดทุกอย่าง
    ├── qa_engineer.md        เขียนและรันเทสต์
    └── redline_reviewer.md   ตรวจงาน (read-only)
```

> **ครั้งแรกต้องรีสตาร์ท Claude Code** หนึ่งครั้ง เพราะ watcher ไม่เห็นโฟลเดอร์ `agents/` ที่เพิ่งสร้างหลัง session เริ่มแล้ว หลังจากนั้นแก้ไฟล์ได้เลยไม่ต้องรีสตาร์ท

---

## ขอบเขตงาน — ไม่ทับซ้อนกัน

| Agent | ทำอะไร | **ไม่ทำ** |
|---|---|---|
| **architect** | ออกแบบ DDL, RLS policy, interface, โครงสร้างโมดูล · รีวิวการละเมิด layer | ไม่เขียน implementation, ไม่เขียนเทสต์ |
| **engineer** | เขียนโค้ดทุกอย่าง — migration, Edge Function, worker, หน้าจอ | ไม่ออกแบบ schema เอง, ไม่เขียนเทสต์ |
| **qa_engineer** | เขียนเทสต์ + รันเทสต์ + รายงานผล | ไม่เขียน production code, ไม่แก้เทสต์ให้ผ่าน |
| **redline_reviewer** | ตรวจ RL-1/2/3 + ความถูกต้องตัวเลข + Thai copy | **ไม่แก้ไขไฟล์ใดๆ เลย** |

เส้นแบ่งที่สำคัญที่สุด: **reviewer ไม่มีสิทธิ์เขียนไฟล์** — agent ที่แก้โค้ดได้จะมีแรงจูงใจ "แก้ให้ผ่าน" แทนรายงานตามจริง

---

## WBS ไหนใช้ agent ตัวไหน

| WBS | Phase | architect | engineer | qa_engineer | redline_reviewer |
|---|---|:---:|:---:|:---:|:---:|
| 1.1–1.7 | Project management | | ✓ (เอกสาร) | | ✓ (1.4 gate) |
| 2.1–2.3 | Design intake & port | | ✓ | ✓ | ✓ |
| 3.1, 3.3, 3.9–3.11 | Platform setup | | ✓ | | |
| **3.5** | Schema & migrations | **✓ ออกแบบ** | ✓ implement | ✓ introspection | ✓ |
| **3.6** | RLS policies | **✓ ออกแบบ** | ✓ implement | ✓ adversarial | ✓ |
| 3.7, 3.8 | API surface, storage | ✓ | ✓ | ✓ | ✓ |
| 4.1, 4.2, 4.7 | Auth & tiers | | ✓ | ✓ | |
| **4.5, 4.8** | PromptPay, fee model | | ✓ | ✓ | **✓ RL-1** |
| 4.3, 4.4, 4.6 | Setup screens | | ✓ | | ✓ copy |
| 5.1, 5.2, 5.4, 5.10 | Customer Web | | ✓ | ✓ | **✓ RL-3** |
| **5.3** | Slot engine | ✓ | ✓ | **✓ concurrency** | |
| **5.5, 5.6** | QR & confirmation | | ✓ | **✓ payee + idempotency** | **✓ RL-1** |
| **5.7** | Order lifecycle | **✓ ออกแบบ** | ✓ | ✓ | |
| 5.8, 5.9, 5.11, 5.12 | Inbox, status, refund | | ✓ | ✓ | ✓ |
| 6.1–6.4, 6.7 | OCR & recipe | | ✓ | ✓ | ✓ copy |
| **6.5, 6.6, 6.8, 6.9** | Costing & stock | ✓ (unit rules) | ✓ | **✓ null + conversion** | **✓ RL-2** |
| 7.1–7.4, 7.7 | Dashboard & alerts | | ✓ | ✓ | ✓ |
| **7.5, 7.6** | P&L, profit per dish | | ✓ | **✓ reconciliation** | **✓ RL-2** |
| **7.8** | Query performance | **✓ index design** | ✓ | ✓ | |
| **8.1–8.4** | Test suites | | | **✓ ทั้งหมด** | |
| **8.5** | Red line audit | | | | **✓ ทั้งหมด** |
| 8.6–8.10 | QA, deploy, handover | | ✓ | ✓ | ✓ |

**ตัวหนา** = agent นั้นเป็นเจ้าของหลักของ entry นั้น

---

## ลำดับการทำงาน

**งาน schema (3.5, 3.6, 5.7)**
```
architect (ออกแบบ) → engineer (implement) → qa_engineer (เทสต์) → redline_reviewer
```

**งาน backend / payment (5.5, 5.6, 6.6, 6.9)**
```
engineer → qa_engineer → redline_reviewer
```

**งานหน้าจอ**
```
engineer → redline_reviewer (Thai copy + RL-3 ถ้าเป็น Customer Web)
```

**ก่อนปิด Phase (WBS 1.4 gate)**
```
qa_engineer + redline_reviewer รันขนานกัน
```

---

## วิธีเรียก

```
Use the architect agent to design the schema for WBS 3.5
Use the engineer agent to implement WBS 5.5
Use the qa_engineer agent to write the concurrency tests for WBS 5.3
Use the redline_reviewer agent on the changes I just made
```

บังคับให้ตรงตัว:
```
@"redline_reviewer (agent)" ตรวจ diff ล่าสุด
```

รันขนานกันตอน gate:
```
Run qa_engineer and redline_reviewer in parallel on this branch
```

---

## Writer/Reviewer Separation

`redline_reviewer` มีคำสั่งไว้ว่า **ห้ามรีวิวโค้ดที่ตัวเองเขียน** และถ้าโค้ดที่กำลังตรวจถูกเขียนโดย `engineer` ใน session เดียวกัน ให้แจ้งความขัดแย้งแล้วขอ session ใหม่

เหตุผล: agent ที่เพิ่งเขียนโค้ดเสร็จมีบริบทของสิ่งที่*ตั้งใจ*จะทำอยู่เต็มหัว จนอ่านโค้ดเป็นสิ่งที่ตั้งใจ แทนที่จะเป็นสิ่งที่เขียนออกมาจริง การรีวิวใน context ใหม่ที่ไม่เคยเห็นเหตุผลของโค้ดนั้นเลย คือสิ่งที่ทำให้จับ regression ได้

---

## สิ่งที่ agent ทุกตัวรู้ร่วมกัน

**Red Lines** — RL-1 เงินเข้าพร้อมเพย์ร้านโดยตรง · RL-2 ขายได้โดยไม่ต้องใส่สูตร · RL-3 ลูกค้าไม่เห็นต้นทุน

**Precedence เมื่อขัดแย้ง** — red line > state matrix > interaction spec > component inventory > prototype > WBS entry

**`/design/` เป็น read-only** — เป็น delivered artefact ถ้า spec ผิดต้องแก้ที่ `/docs/design/` แล้วรายงาน ไม่ใช่แก้เงียบๆ
