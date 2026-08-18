# Repo Migration — GCP stack → Supabase stack

แผนย้าย repo ที่ scaffold ไว้บนสถาปัตยกรรมเดิม มาให้ตรงกับ WBS ปัจจุบัน

**ทำก่อนเริ่ม WBS entry ใดๆ** ไม่งั้น agent ทั้ง 4 ตัวจะอ้างอิงไฟล์ที่ไม่มีจริง

---

## สิ่งที่ทำไปแล้วและไม่เสียเปล่า

| ของเดิม | ใช้ต่อได้ไหม |
|---|---|
| pnpm workspace + `tsconfig.base.json` | ✅ ใช้ต่อได้เลย |
| `eslint.config.mjs` boundary rule | ✅ ใช้ต่อได้ เพิ่มแค่ `packages/costing` เข้าไปใน rule |
| `apps/console` (Next.js) | ✅ เก็บโครง เปลี่ยนแค่ data layer |
| `packages/shared` | ✅ เก็บ เพิ่ม PromptPay builder เข้าไป |
| **Prisma schema design** | ✅ **ตัวแบบข้อมูลใช้ต่อได้ทั้งหมด** เปลี่ยนแค่รูปแบบไฟล์ |
| `docs/data_dictionary.md` | ✅ ใช้ต่อได้ เป็น input ของ allow-list serializer |
| `apps/api` (NestJS) | ❌ ลบ — logic ย้ายไป Edge Functions กับ worker |
| Prisma client + migrations | ❌ แทนด้วย SQL migrations เพราะ RLS เขียนใน Prisma ไม่ได้ |

**จุดสำคัญ:** งานที่หนักที่สุดใน 3.3/3.4 เดิมคือ *การออกแบบตัวแบบข้อมูล* ไม่ใช่การพิมพ์ Prisma syntax — ส่วนนั้นเก็บไว้ได้ทั้งหมด

---

## ทำไม Prisma ไปต่อไม่ได้

Supabase คือ Postgres ธรรมดา และ Prisma ยิงเข้าไปได้จริง แต่ติดสามอย่าง:

1. **RLS policy เขียนใน `schema.prisma` ไม่ได้** ต้องเป็น raw SQL อยู่ดี — พอมี migration สองระบบซ้อนกัน ลำดับการ apply จะเดายาก
2. **Edge Functions รันบน Deno** ซึ่ง Prisma client รองรับได้ไม่ดี — ทาง Supabase ใช้ `supabase-js` กับ `postgres.js`
3. **RLS ทำงานตาม role ของ connection** Prisma ต่อด้วย role เดียวและ bypass RLS ทั้งหมด ซึ่งลบด่านแรกของ RL-3 ทิ้ง

ข้อ 3 คือข้อที่ตัดสิน — ไม่ใช่เรื่องความสะดวก แต่เป็นด่านความปลอดภัยหลัก

---

## ลำดับการย้าย

### ขั้นที่ 0 — ตั้งฐานให้ agent ทำงานได้ (ทำเองด้วยมือ)

```bash
# 1. แทนที่ CLAUDE.md ด้วยฉบับใหม่
cp CLAUDE.md <repo>/CLAUDE.md

# 2. วาง WBS ให้ตรงชื่อที่ CLAUDE.md อ้างถึง
cp brew_wbs_dictionary.md <repo>/BrewLedger_WBS_Dictionary.md

# 3. วาง subagent
mkdir -p <repo>/.claude/agents
cp claude-agents/*.md <repo>/.claude/agents/

# 4. วาง design package  ← ขั้นนี้ blocking ทุก entry ฝั่ง frontend
mkdir -p <repo>/design
cp -r BrewDesign2/* <repo>/design/

git add -A && git commit -m "chore: align repo docs and agents with Supabase architecture"
```

จากนั้น **รีสตาร์ท Claude Code หนึ่งครั้ง** — watcher ไม่เห็นโฟลเดอร์ `.claude/agents/` ที่เพิ่งสร้าง

---

### ขั้นที่ 1 — WBS 2.1 Design intake

```
Use the engineer agent on WBS 2.1
```

แตก `design/P5 Handoff.md` ออกเป็น `docs/design/` 5 ไฟล์ที่ทุก agent อ้างถึง

**ต้องทำก่อน entry ฝั่ง frontend ทุกอัน** เพราะ `engineer` กับ `redline_reviewer` อ่าน state matrix เป็นแหล่งอ้างอิงหลัก

---

### ขั้นที่ 2 — ย้าย schema (WBS 3.5)

```
Use the architect agent to port packages/db/prisma/schema.prisma to SQL
migrations for Supabase, following WBS 3.5. Keep the data model; change the
format. Add the columns the new payment model requires.
```

architect ต้องจัดการ 4 อย่างนี้:

| ประเด็น | ต้องทำ |
|---|---|
| รูปแบบไฟล์ | Prisma DSL → SQL migrations ใน `packages/db/migrations/` |
| Payment columns | ลบทุกอย่างที่เป็น gateway → ใส่ `promptpay_id`, `promptpay_type`, `promptpay_verified_at` บน `stores` และ `payee_alias` บน `payments` |
| Fee columns | ลบ `gateway_fee_satang`, `fee_borne_by`, `absorb_gateway_fee` — ไม่มีค่าธรรมเนียมแล้ว |
| Webhook tables | ลบ `webhook_events`, `dead_letter_webhooks` — ไม่มี webhook แล้ว เพิ่ม `payment_confirmed_by`, `payment_confirmed_at`, `refund_status` บน `orders` แทน |

ตามด้วย:
```
Use the engineer agent to implement the migrations the architect designed
Use the qa_engineer agent to write the WBS 3.5 introspection tests
```

---

### ขั้นที่ 3 — RLS (WBS 3.6)

```
Use the architect agent to design the RLS policies for WBS 3.6
Use the engineer agent to implement them
Use the qa_engineer agent to write the adversarial anon-key suite
Use the redline_reviewer agent to audit RL-3 coverage
```

⚠️ ขั้นนี้คือที่ที่ **ด่านแรกของ RL-3 เกิดขึ้นจริง** — ก่อนหน้านี้มีแค่ eslint boundary ซึ่งกัน import ได้ แต่กัน `curl` ตรงเข้า PostgREST ไม่ได้

---

### ขั้นที่ 4 — ถอด NestJS (WBS 3.7)

```
Use the architect agent to map the apps/api module tree onto the
public-* / console-* Edge Function split in WBS 3.7
Use the engineer agent to implement the split and delete apps/api
```

ตอนนี้ `apps/api` มีแค่ health check ตาม CLAUDE.md เดิม — ถอดตอนนี้ถูกจังหวะที่สุด ยิ่งช้ายิ่งเจ็บ

---

### ขั้นที่ 5 — ต่อจากนี้เดินตาม WBS ปกติ

3.2 Supabase provisioning (manual) → 3.3 Render → 3.4 Vercel → 3.8 storage → 3.9 secrets → 3.10 survival kit → 3.11 observability → เข้า Phase 4

---

## Manual action ที่ต้องทำคู่ขนานไปเลย

ทำได้ทันที ไม่ต้องรอโค้ด และไม่มีอันไหนต้องใช้บัตร:

| WBS | ทำอะไร | ใช้เวลา |
|---|---|---|
| 3.2 | สมัคร Supabase + สร้าง 2 projects | ~15 นาที |
| 3.4 | สมัคร Vercel + สร้าง 2 projects | ~10 นาที |
| 3.3 | สมัคร Render + สร้าง worker service | ~10 นาที |
| 4.1 | สมัคร SMS provider สำหรับ phone OTP | ~20 นาที |
| 6.2 | สมัคร Float16 + ทดสอบ OCR กับบิลจริง 3-5 ใบ | ~30 นาที |

**gateway KYC ไม่มีแล้ว** — เดิมเป็น critical path 15-20 วันทำการ ตอนนี้เหลือแค่ให้ร้านกรอกเบอร์พร้อมเพย์ตัวเอง

---

## เช็คว่าย้ายสำเร็จ

```bash
# ไม่มี Prisma หลงเหลือ
grep -rn "prisma\|@prisma" --include=*.ts --include=*.json . | grep -v node_modules

# ไม่มี gateway หลงเหลือ
grep -rniE "2c2p|omise|gateway_merchant|webhook_events|absorb_gateway" . | grep -v node_modules

# RLS ครบทุกตาราง
grep -c "create table" packages/db/migrations/*.sql
grep -c "enable row level security" packages/db/migrations/*.sql   # ต้อง >= ตัวบน

# boundary rule ยังทำงาน
pnpm lint:boundary
```

สั่งตรวจรวบยอด:
```
Use the redline_reviewer agent to verify the migration is complete
```
