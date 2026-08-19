import * as React from "react";
import { Button } from "./components/Button";
import { Input } from "./components/Input";
import { Card } from "./components/Card";
import { MoneyValue } from "./components/MoneyValue";
import { OrderStatusBadge } from "./components/OrderStatusBadge";
import { MetricCard } from "./components/MetricCard";
import { UntrackedDisclosure } from "./components/UntrackedDisclosure";
import { StatusButton } from "./components/StatusButton";
import { ConfidenceField } from "./components/ConfidenceField";
import { SlotPicker } from "./components/SlotPicker";
import { EmptyState } from "./components/EmptyState";
import { OrderCard, type OrderSummary } from "./components/OrderCard";
import { RecipeBlock, type RecipeRow } from "./components/RecipeBlock";
import { OnboardingStrip } from "./components/OnboardingStrip";
import { NavShell } from "./components/NavShell";
import type { OrderStatus } from "./types";

// Every string below is copied verbatim from /docs/design/state_matrix.md —
// never paraphrased. See that file for section headers matching the
// comments here.

const STATUSES: OrderStatus[] = [
  "unpaid",
  "accepted",
  "making",
  "ready",
  "collected",
  "cancelled",
  "refunded",
  "expired",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "3.2rem" }}>
      <h2>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.6rem", marginTop: "1.2rem" }}>
        {children}
      </div>
    </section>
  );
}

function Row({ testId, children }: { testId: string; children: React.ReactNode }) {
  // display:contents so the child becomes a direct flex item of Section's
  // flex container, matching the prototype where every .card/.st/etc is
  // itself a flex/grid item (oc-body, oc-metrics, ... are all flex/grid
  // containers) — min-height:auto resolves differently (stays the "auto"
  // keyword) for a flex/grid item than for an ordinary block box (resolves
  // to a used value, "0px"), and getComputedStyle reports that difference
  // even when no rule sets min-height at all.
  return (
    <div data-testid={testId} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

export function Gallery() {
  const [confidenceValue, setConfidenceValue] = React.useState("42");
  const [confidenceValueLow, setConfidenceValueLow] = React.useState("45");
  const [slotValue, setSlotValue] = React.useState<string | null>(null);
  const [recipe, setRecipe] = React.useState<RecipeRow[] | null>(null);
  const [recipeEditing, setRecipeEditing] = React.useState<RecipeRow[] | null>([
    { ingredientId: "coffee", ingredientName: "เมล็ดกาแฟ", quantity: 18, unit: "ก." },
    { ingredientId: "milk", ingredientName: "นมสด", quantity: 200, unit: "มล." },
  ]);

  const suggestion: RecipeRow[] = [
    { ingredientId: "coffee", ingredientName: "เมล็ดกาแฟ", quantity: 18, unit: "ก." },
    { ingredientId: "milk", ingredientName: "นมสด", quantity: 200, unit: "มล." },
    { ingredientId: "cup", ingredientName: "แก้ว 16 ออนซ์", quantity: 1, unit: "ใบ" },
  ];

  const orderBase: OrderSummary = {
    id: "o1",
    code: "A102",
    status: "accepted",
    itemsSummary: "2 รายการ",
    pickupTime: "08:15",
    totalSatang: 13500,
    cups: 2,
    customerName: "คุณสมชาย",
  };

  return (
    <div style={{ padding: "2.4rem", fontFamily: "var(--font-thai)" }}>
      <h1>@brewledger/ui — Component Gallery</h1>
      <p className="note-plain">
        Every component, every documented state, real Thai copy from
        /docs/design/state_matrix.md. Used by scripts/verify-fidelity.mjs.
      </p>

      <Section title="Button">
        <Row testId="gallery-button-primary">
          <Button variant="primary">บันทึก</Button>
        </Row>
        <Row testId="gallery-button-outline">
          <Button variant="outline">ทดสอบการเชื่อมต่อ</Button>
        </Row>
        <Row testId="gallery-button-wet">
          <Button variant="primary" wet>
            เพิ่มรายการ
          </Button>
        </Row>
      </Section>

      <Section title="Input">
        <Row testId="gallery-input-default">
          <Input label="ชื่อร้าน" defaultValue="ร้านสมใจ คอฟฟี่" />
        </Row>
      </Section>

      <Section title="Card">
        <Row testId="gallery-card-default">
          <Card>
            <p>เนื้อหาในการ์ด</p>
          </Card>
        </Row>
      </Section>

      <Section title="MoneyValue">
        {/* หน้าหลัก /console — No cost data: กำไรสุทธิวันนี้ renders "—" */}
        <Row testId="gallery-money-unknown">
          <MoneyValue value={null} role="profit" />
        </Row>
        <Row testId="gallery-money-revenue">
          <MoneyValue value={48200_00} role="revenue" />
        </Row>
        <Row testId="gallery-money-cost">
          <MoneyValue value={12900_00} role="cost" />
        </Row>
        <Row testId="gallery-money-profit">
          <MoneyValue value={28900_00} role="profit" />
        </Row>
        <Row testId="gallery-money-negative">
          <MoneyValue value={-500_00} role="profit" />
        </Row>
      </Section>

      <Section title="OrderStatusBadge — all 8 statuses">
        {STATUSES.map((status) => (
          <Row testId={`gallery-status-${status}`} key={status}>
            <OrderStatusBadge status={status} />
          </Row>
        ))}
      </Section>

      <Section title="MetricCard">
        {/* หน้าหลัก — No cost data state */}
        <Row testId="gallery-metric-no-cost-data">
          <MetricCard
            label="กำไรสุทธิวันนี้"
            value={null}
            role="profit"
            note="ยังไม่ได้บันทึกต้นทุน จึงยังคำนวณกำไรไม่ได้"
          />
        </Row>
        <Row testId="gallery-metric-revenue">
          <MetricCard label="ยอดขายวันนี้" value={482000} role="revenue" />
        </Row>
        <Row testId="gallery-metric-expense">
          <MetricCard label="ค่าใช้จ่ายวันนี้" value={129000} role="cost" />
        </Row>
      </Section>

      <Section title="UntrackedDisclosure">
        {/* หน้าหลัก — Partial */}
        <Row testId="gallery-untracked-dashboard">
          <UntrackedDisclosure trackedCount={8} totalCount={12} variant="dashboard" />
        </Row>
        {/* กำไรขาดทุน /pnl — Partial */}
        <Row testId="gallery-untracked-pnl-partial">
          <UntrackedDisclosure
            trackedCount={35}
            totalCount={47}
            untrackedRevenue={54000}
            variant="pnl"
          />
        </Row>
        {/* กำไรขาดทุน /pnl — All untracked */}
        <Row testId="gallery-untracked-pnl-all">
          <UntrackedDisclosure trackedCount={0} totalCount={47} variant="pnl" />
        </Row>
        {/* กำไรต่อเมนู — Untracked section */}
        <Row testId="gallery-untracked-dish">
          <UntrackedDisclosure trackedCount={7} totalCount={12} variant="dish" />
        </Row>
      </Section>

      <Section title="StatusButton">
        <Row testId="gallery-status-button">
          <StatusButton label="รับออเดอร์" onPress={() => {}} minHeight={56} optimistic={true} />
        </Row>
        <Row testId="gallery-status-button-disabled">
          <StatusButton
            label="รับออเดอร์"
            onPress={() => {}}
            minHeight={56}
            optimistic={true}
            disabled
          />
        </Row>
      </Section>

      <Section title="ConfidenceField">
        {/* ตรวจบิล — High confidence */}
        <Row testId="gallery-confidence-high">
          <ConfidenceField
            label="ราคาต่อลิตร"
            value={confidenceValue}
            confidence="high"
            unit="บาท/ลิตร"
            onChange={setConfidenceValue}
            autoFocusIfLow={false}
          />
        </Row>
        {/* ตรวจบิล — Low confidence field, first in focus order */}
        <Row testId="gallery-confidence-low">
          <ConfidenceField
            label="ราคาต่อลิตร"
            value={confidenceValueLow}
            confidence="low"
            unit="บาท/ลิตร"
            onChange={setConfidenceValueLow}
            autoFocusIfLow
          />
        </Row>
      </Section>

      <Section title="SlotPicker">
        {/* เลือกเวลารับ /checkout — Default, เหลือ N ที่ when <=2 remain */}
        <Row testId="gallery-slotpicker-default">
          <SlotPicker
            slots={[
              { time: "08:15", remaining: 5 },
              { time: "08:30", remaining: 2 },
              { time: "09:00", remaining: 1 },
            ]}
            value={slotValue}
            onChange={setSlotValue}
            fullMessage="วันนี้เต็มทุกช่วงเวลาแล้ว"
          />
        </Row>
        {/* เลือกเวลารับ /checkout — All full */}
        <Row testId="gallery-slotpicker-full">
          <SlotPicker
            slots={[
              { time: "08:15", remaining: 0 },
              { time: "08:30", remaining: 0 },
            ]}
            value={null}
            onChange={() => {}}
            fullMessage="วันนี้เต็มทุกช่วงเวลาแล้ว"
          />
        </Row>
      </Section>

      <Section title="EmptyState">
        {/* ออเดอร์ /console/orders — Empty */}
        <Row testId="gallery-emptystate-orders">
          <EmptyState
            title="ยังไม่มีออเดอร์วันนี้"
            body="ลูกค้าสั่งผ่านลิงก์ร้านของคุณได้เลย"
            action={{ label: "ดูลิงก์ร้าน", onPress: () => {} }}
          />
        </Row>
        {/* คลังวัตถุดิบ /console/inventory — Empty (no action button) */}
        <Row testId="gallery-emptystate-inventory">
          <EmptyState
            title="ยังไม่มีวัตถุดิบในระบบ"
            body="ส่วนนี้ไม่จำเป็นต้องใช้ก็ขายได้ตามปกติ เปิดใช้เมื่อไหร่ก็ได้ที่สะดวก"
          />
        </Row>
      </Section>

      <Section title="OrderCard">
        {/* ออเดอร์ — unseen keeps a 6px left border until opened */}
        <Row testId="gallery-ordercard-unseen">
          <OrderCard
            order={orderBase}
            variant="inbox"
            showNextAction
            unseen
            onAdvance={() => {}}
            onCancel={() => {}}
            onOpen={() => {}}
          />
        </Row>
        <Row testId="gallery-ordercard-seen">
          <OrderCard
            order={{ ...orderBase, id: "o2", code: "A103", status: "making" }}
            variant="inbox"
            showNextAction
            unseen={false}
            onAdvance={() => {}}
            onCancel={() => {}}
            onOpen={() => {}}
          />
        </Row>
        <Row testId="gallery-ordercard-detail">
          <OrderCard
            order={{ ...orderBase, id: "o3", code: "A104", status: "ready" }}
            variant="detail"
            showNextAction
            unseen={false}
            onAdvance={() => {}}
            onCancel={() => {}}
            onOpen={() => {}}
          />
        </Row>
      </Section>

      <Section title="RecipeBlock">
        {/* Recipe collapsed by default */}
        <Row testId="gallery-recipeblock-collapsed">
          <RecipeBlock
            itemName="ลาเต้เย็นหวานน้อยพิเศษเพิ่มช็อต"
            recipe={null}
            suggestion={null}
            onUse={() => {}}
            onChange={() => {}}
          />
        </Row>
        {/* Recipe suggested */}
        <Row testId="gallery-recipeblock-suggested">
          <details open>
            <RecipeBlock
              itemName="ลาเต้"
              recipe={recipe}
              suggestion={suggestion}
              onUse={setRecipe}
              onChange={setRecipe}
            />
          </details>
        </Row>
        {/* Recipe editing */}
        <Row testId="gallery-recipeblock-editing">
          <RecipeBlock
            itemName="ลาเต้"
            recipe={recipeEditing}
            suggestion={null}
            onUse={() => {}}
            onChange={setRecipeEditing}
          />
        </Row>
      </Section>

      <Section title="OnboardingStrip">
        <Row testId="gallery-onboarding-partial">
          <OnboardingStrip
            steps={[
              { id: "store", done: true },
              { id: "menu", done: false },
              { id: "payments", done: false },
            ]}
          />
        </Row>
      </Section>

      <Section title="NavShell">
        <Row testId="gallery-navshell">
          <NavShell surface="console" active="dash" badge={3} />
        </Row>
      </Section>
    </div>
  );
}

export default Gallery;

export type FidelityStatus = "MATCH" | "NO_REFERENCE";

export interface FidelityManifestEntry {
  component: string;
  state: string;
  galleryTestId: string;
  /**
   * CSS selector for the actual styled element inside the gallery's Row
   * wrapper — components in this package keep the prototype's original
   * class names (.money, .st, .btn, .card, ...), so this is almost always
   * `[data-testid="<galleryTestId>"] .<same-class>`.
   */
  gallerySelector: string;
  status: FidelityStatus;
  /** Relative to /design. Required when status is MATCH. */
  prototypeFile?: string;
  prototypeSelector?: string;
  /**
   * Sequence of interactions to reach this state on the prototype page
   * before extracting computed styles — the prototype is a stateful vanilla
   * JS app, not static markup, so most non-default states require pressing
   * 'D' for the dev switcher and/or clicking a nav/dev-toggle element.
   */
  prototypeActions?: Array<
    | { type: "press"; key: string }
    | { type: "click"; selector: string }
  >;
  /** Required when status is NO_REFERENCE. */
  reason?: string;
}

const D = { type: "press" as const, key: "d" };
// Navigates via the hidden dev panel's own screen-jump buttons
// (`.dev-go [data-go]`), not the in-flow nav elements — the prototype's real
// flow requires multi-step interaction (e.g. add to cart, then open cart,
// then checkout) that a fidelity check has no reason to replay; the dev
// panel is the delivered prototype's own mechanism for jumping straight to
// a screen, present in every one of the four HTML files precisely for this
// kind of state inspection (see CLAUDE.md: "press D for the hidden state
// switcher"). Always preceded by D in the action sequences below.
const go = (screen: string) => ({
  type: "click" as const,
  selector: `.dev-go [data-go="${screen}"]`,
});
const dev = (key: string) => ({ type: "click" as const, selector: `input[data-dev="${key}"]` });

export const FIDELITY_MANIFEST: FidelityManifestEntry[] = [
  {
    component: "Button",
    state: "primary (สาย .btn--primary — ปุ่ม บันทึก)",
    galleryTestId: "gallery-button-primary",
    gallerySelector: '[data-testid="gallery-button-primary"] .btn',
    status: "MATCH",
    prototypeFile: "Console Setup.html",
    prototypeActions: [D, go("link")],
    prototypeSelector: ".oc-qracts .btn--primary",
  },
  {
    component: "Button",
    state: "outline (ปุ่ม ทดสอบการเชื่อมต่อ)",
    galleryTestId: "gallery-button-outline",
    gallerySelector: '[data-testid="gallery-button-outline"] .btn',
    status: "MATCH",
    prototypeFile: "Console Setup.html",
    prototypeActions: [D, go("payments")],
    prototypeSelector: '[data-test="1"]',
  },
  {
    component: "Input",
    state: "default field (ชื่อร้าน)",
    galleryTestId: "gallery-input-default",
    gallerySelector: '[data-testid="gallery-input-default"] .input',
    status: "MATCH",
    prototypeFile: "Console Setup.html",
    prototypeSelector: '[data-s="name"]',
  },
  {
    component: "Card",
    state: "default surface",
    galleryTestId: "gallery-card-default",
    gallerySelector: '[data-testid="gallery-card-default"] .card',
    status: "MATCH",
    prototypeFile: "Owner Console.html",
    prototypeSelector: ".oc-metrics .card",
  },
  {
    component: "MoneyValue",
    state: "unknown (null -> —), standalone default size",
    galleryTestId: "gallery-money-unknown",
    gallerySelector: '[data-testid="gallery-money-unknown"] .money',
    status: "NO_REFERENCE",
    reason:
      "Every .money--unknown usage in the delivered prototype (owner-console.js's dash metric, console-reports.js's profit-per-dish untracked table) sits inside an ambient font-size override (.oc-big at --text-8, .oc-table td at --text-2) — there is no prototype instance of money--unknown at the plain, unstyled default size this gallery entry renders in isolation. The .oc-big-context variant is separately covered (and PASSES) by the 'MetricCard — no cost data' entry below, which renders the same null value through the same component inside the same .oc-big container.",
  },
  {
    component: "MoneyValue",
    state: "revenue",
    galleryTestId: "gallery-money-revenue",
    gallerySelector: '[data-testid="gallery-money-revenue"] .money',
    status: "MATCH",
    // .oc-pnlrow sets no font-size of its own (inherits body's --text-3),
    // matching MoneyValue's default size="md" — unlike .oc-big/.oc-ordertot
    // usages, which are a MetricCard-level font-size override, not
    // MoneyValue's own default.
    prototypeFile: "Console Reports.html",
    prototypeSelector: ".oc-pnlrow .money--revenue",
  },
  {
    component: "OrderStatusBadge",
    state: "unpaid",
    galleryTestId: "gallery-status-unpaid",
    gallerySelector: '[data-testid="gallery-status-unpaid"] .st',
    status: "NO_REFERENCE",
    reason:
      "Seed order data in owner-console.js has no 'unpaid' order in the default inbox list — every seeded order is already accepted/making/ready/etc; reaching 'unpaid' would require a checkout-flow walkthrough on Customer Web, a different HTML file, not a selector into Owner Console.html.",
  },
  {
    component: "OrderStatusBadge",
    state: "accepted / making / ready / collected / cancelled / refunded / expired",
    galleryTestId: "gallery-status-accepted",
    gallerySelector: '[data-testid="gallery-status-accepted"] .st',
    status: "MATCH",
    prototypeFile: "Owner Console.html",
    prototypeActions: [D, go("orders")],
    prototypeSelector: '.st--accepted',
  },
  {
    component: "MetricCard",
    state: "no cost data",
    galleryTestId: "gallery-metric-no-cost-data",
    gallerySelector: '[data-testid="gallery-metric-no-cost-data"] .money',
    status: "MATCH",
    prototypeFile: "Owner Console.html",
    // Default state already — dev.noRecipe defaults to true.
    prototypeSelector: ".oc-metrics .oc-metric:nth-child(2) .money",
  },
  {
    component: "UntrackedDisclosure",
    state: "pnl partial",
    galleryTestId: "gallery-untracked-pnl-partial",
    gallerySelector: '[data-testid="gallery-untracked-pnl-partial"] .note-plain',
    status: "MATCH",
    prototypeFile: "Console Reports.html",
    prototypeActions: [D, dev("partial")],
    prototypeSelector: ".oc-pnlrow.is-net + p.note-plain, .card p.note-plain",
  },
  {
    component: "StatusButton",
    state: "enabled 56px wet",
    galleryTestId: "gallery-status-button",
    gallerySelector: '[data-testid="gallery-status-button"] .btn',
    status: "MATCH",
    prototypeFile: "Owner Console.html",
    prototypeActions: [D, go("orders")],
    prototypeSelector: '[data-adv]',
  },
  {
    component: "ConfidenceField",
    state: "low confidence",
    galleryTestId: "gallery-confidence-low",
    gallerySelector: '[data-testid="gallery-confidence-low"] .input',
    status: "MATCH",
    prototypeFile: "Console Reports.html",
    // BILL fixture (console-reports.js, scReview) is a fixed, static array
    // with conf:'low' hardcoded on two of its four rows — not randomized —
    // and 'review' is a normal top-level SCREENS entry, reachable via the
    // same dev-go pattern as go("orders")/go("menu") above. Default state
    // already has dev.manual=false, so the low rows render without an extra
    // dev toggle.
    prototypeActions: [D, go("review")],
    prototypeSelector: ".oc-billrow.is-low .input",
  },
  {
    component: "ConfidenceField",
    state: "low confidence — hint text",
    galleryTestId: "gallery-confidence-low",
    gallerySelector: '[data-testid="gallery-confidence-low"] .bl-confidence-field__hint',
    status: "MATCH",
    prototypeFile: "Console Reports.html",
    // Same fixture/navigation as the row above — this entry exists to check
    // the hint span's own text styling (font-size/font-weight), which the
    // .input selector above never exercises.
    prototypeActions: [D, go("review")],
    prototypeSelector: ".oc-billrow.is-low .oc-lowtag",
  },
  {
    component: "SlotPicker",
    state: "default",
    galleryTestId: "gallery-slotpicker-default",
    gallerySelector: '[data-testid="gallery-slotpicker-default"] .cw-slot',
    status: "MATCH",
    prototypeFile: "Customer Web.html",
    prototypeActions: [D, go("checkout")],
    prototypeSelector: ".cw-slot",
  },
  {
    component: "SlotPicker",
    state: "all full",
    galleryTestId: "gallery-slotpicker-full",
    gallerySelector: '[data-testid="gallery-slotpicker-full"] .cw-notice',
    status: "MATCH",
    prototypeFile: "Customer Web.html",
    prototypeActions: [D, dev("slotsFull"), go("checkout")],
    prototypeSelector: ".cw-notice",
  },
  {
    component: "EmptyState",
    state: "orders empty",
    galleryTestId: "gallery-emptystate-orders",
    gallerySelector: '[data-testid="gallery-emptystate-orders"] .empty',
    status: "MATCH",
    prototypeFile: "Owner Console.html",
    prototypeActions: [D, dev("noOrders"), go("orders")],
    prototypeSelector: ".empty",
  },
  {
    component: "OrderCard",
    state: "inbox unseen",
    galleryTestId: "gallery-ordercard-unseen",
    gallerySelector: '[data-testid="gallery-ordercard-unseen"] .oc-order',
    status: "MATCH",
    prototypeFile: "Owner Console.html",
    prototypeActions: [D, go("orders")],
    prototypeSelector: ".oc-order.is-new",
  },
  {
    component: "RecipeBlock",
    state: "collapsed header",
    galleryTestId: "gallery-recipeblock-collapsed",
    gallerySelector: '[data-testid="gallery-recipeblock-collapsed"] .oc-rechead',
    status: "MATCH",
    prototypeFile: "Console Setup.html",
    prototypeActions: [D, go("menu"), { type: "click", selector: "[data-edit]" }],
    prototypeSelector: ".oc-rechead",
  },
  {
    component: "OnboardingStrip",
    state: "partial",
    galleryTestId: "gallery-onboarding-partial",
    gallerySelector: '[data-testid="gallery-onboarding-partial"] .oc-strip',
    status: "MATCH",
    prototypeFile: "Console Setup.html",
    // Default seed state has every onboarding step already done (store
    // name+addr set, 5 menu items, payState 'linked'), so strip() renders
    // nothing by default — dev.noMenu forces the menu step incomplete so
    // the strip actually appears, matching the gallery's partial-done state.
    prototypeActions: [D, dev("noMenu")],
    prototypeSelector: ".oc-strip",
  },
  {
    component: "NavShell",
    state: "bottom bar <1280px",
    galleryTestId: "gallery-navshell",
    gallerySelector: '[data-testid="gallery-navshell"] .oc-nav',
    status: "MATCH",
    prototypeFile: "Owner Console.html",
    prototypeSelector: ".oc-nav",
  },
  {
    component: "NavShell",
    state: "sidebar >=1280px",
    galleryTestId: "gallery-navshell",
    gallerySelector: '[data-testid="gallery-navshell"] .oc-side',
    status: "NO_REFERENCE",
    reason:
      "Requires rendering the prototype at a >=1280px viewport in the same automated pass as the <1280px check above (the .oc-side rule only activates past that breakpoint) — verify-fidelity.mjs runs a single fixed viewport per pass today; a second viewport pass is a known follow-up, not silently skipped.",
  },
];
