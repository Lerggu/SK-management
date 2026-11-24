import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { SK_INFRA_LOGO } from "./sk-infra-logo";

/**
 * Order confirmation, invoice and credit note PDF in the SK Infra style
 * (docs/adr/0033-sales-documents.md). The layout follows the order
 * confirmation model the owner supplied on 2026-11-24: number and date top
 * right, billing and delivery address left, delivery and reference fields
 * right, positioned lines, a VAT breakdown table, the chosen terms and a
 * four-column footer. Server-side only; the caller passes validated data and
 * amounts as decimal strings.
 */
export type SalesPdfKind = "ORDER_CONFIRMATION" | "INVOICE" | "CREDIT_NOTE";

export interface SalesPdfLine {
  productCode: string | null;
  name: string;
  description: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  vatRate: string;
  deliveryTime: string | null;
  amount: string;
}

export interface SalesPdfInput {
  language: "fi" | "en";
  kind: SalesPdfKind;
  /** Drafts carry a watermark and no number. */
  draft: boolean;
  number: string | null;
  issueDate: Date;
  dueDate: Date | null;
  deliveryDate: Date | null;
  seller: {
    legalName: string;
    businessId: string;
    vatNumber: string | null;
    streetAddress: string;
    postalCode: string;
    city: string;
    country: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    iban: string;
    bic: string | null;
    bankName: string | null;
    penaltyInterest: string;
    footerNote: string | null;
    domicile: string | null;
    einvoiceAddress: string | null;
    einvoiceOperator: string | null;
    logo: "NONE" | "SK_INFRA";
  };
  buyer: {
    customerNumber: string | null;
    name: string;
    businessId: string | null;
    vatNumber: string | null;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    contact: string | null;
    email: string | null;
  };
  title: string | null;
  buyerReference: string | null;
  buyerOrderNumber: string | null;
  orderMark: string | null;
  ourReference: string | null;
  salesperson: string | null;
  deliveryTerms: string | null;
  deliveryMethod: string | null;
  deliveryAddress: string | null;
  deliveryInfo: string | null;
  deliveryText: string | null;
  paymentTerms: string | null;
  notes: string | null;
  termsTitle: string | null;
  terms: string | null;
  /** Formatted reference number (invoices and credit notes). */
  referenceNumber: string | null;
  /** The order confirmation an invoice was made from, or the invoice a credit note credits. */
  sourceNumber: string | null;
  currency: string;
  vatMode: "STANDARD" | "REVERSE_CHARGE";
  lines: SalesPdfLine[];
  totals: { net: string; vat: string; gross: string; groups: { rate: string; net: string; vat: string }[] };
  virtualBarcode: string | null;
}

const NAVY = rgb(0x0b / 255, 0x25 / 255, 0x45 / 255);
const TURQUOISE = rgb(0x1e / 255, 0x88 / 255, 0xa8 / 255);
const GREY = rgb(0xe8 / 255, 0xec / 255, 0xef / 255);
const RULE = rgb(0.78, 0.81, 0.84);
const MUTED = rgb(0.38, 0.42, 0.47);
const WHITE = rgb(1, 1, 1);

const A4 = { w: 595.28, h: 841.89 };
const M = { left: 40, right: 40, top: 36, bottom: 84 };
const CONTENT_W = A4.w - M.left - M.right;

const LABELS = {
  fi: {
    ORDER_CONFIRMATION: "TILAUSVAHVISTUS",
    INVOICE: "LASKU",
    CREDIT_NOTE: "HYVITYSLASKU",
    draft: "LUONNOS",
    number: "Numero",
    date: "Päiväys",
    billing: "Laskutus",
    delivery: "Toimitus",
    fields: {
      deliveryMethod: "Toimitustapa",
      deliveryInfo: "Toimitustieto",
      paymentTerms: "Maksuehto",
      deliveryTerms: "Toimitusehto",
      deliveryTime: "Toimitusaika",
      deliveryDate: "Toimituspäivä",
      deliveryText: "Toimitusteksti",
      salesperson: "Myyjä",
      ourReference: "Viitteemme",
      buyerOrderNumber: "Tilausnumeronne",
      buyerReference: "Viitteenne",
      orderMark: "Tilausmerkki",
      contact: "Yhteyshenkilö",
      dueDate: "Eräpäivä",
      referenceNumber: "Viitenumero",
      penaltyInterest: "Viivästyskorko",
      orderConfirmation: "Tilausvahvistus",
      creditedInvoice: "Hyvitettävä lasku",
    },
    businessId: "Y-tunnus",
    vatNumber: "ALV-tunniste",
    cols: { pos: "Pos", code: "Koodi", name: "Nimike", qty: "Määrä", unit: "Yks", price: "a-hinta", vat: "Alv%", discount: "Ale%", amount: "Summa" },
    net: "Veroton yhteensä",
    vatBreakdown: "VEROERITTELY",
    vatCols: { rate: "Verokanta", net: "Veroton", vat: "Vero", gross: "Verollinen" },
    total: "Yhteensä",
    payable: { ORDER_CONFIRMATION: "Yhteensä", INVOICE: "Maksettava yhteensä", CREDIT_NOTE: "Hyvitys yhteensä" },
    reverseCharge: "Käännetty verovelvollisuus (AVL 8 c §). Ostaja on verovelvollinen arvonlisäverosta.",
    payment: "Maksutiedot",
    recipient: "Saaja",
    account: "Tilinumero",
    amount: "Summa",
    barcode: "Virtuaaliviivakoodi",
    notes: "Lisätiedot",
    footer: { visiting: "Käyntiosoite:", einvoice: "Verkkolaskuosoite:", operator: "Välittäjän tunnus:", bank: "Pankkiyhteys:", vatReg: "Alv.rek.", domicile: "Kotipaikka" },
    creditInfo: "Hyvitys vähennetään maksettavasta. Hyvitystä ei makseta erikseen, ellei toisin sovita.",
  },
  en: {
    ORDER_CONFIRMATION: "ORDER CONFIRMATION",
    INVOICE: "INVOICE",
    CREDIT_NOTE: "CREDIT NOTE",
    draft: "DRAFT",
    number: "Number",
    date: "Date",
    billing: "Billing",
    delivery: "Delivery",
    fields: {
      deliveryMethod: "Delivery method",
      deliveryInfo: "Delivery info",
      paymentTerms: "Payment terms",
      deliveryTerms: "Delivery terms",
      deliveryTime: "Delivery time",
      deliveryDate: "Delivery date",
      deliveryText: "Delivery note",
      salesperson: "Salesperson",
      ourReference: "Our reference",
      buyerOrderNumber: "Your order no.",
      buyerReference: "Your reference",
      orderMark: "Order mark",
      contact: "Contact person",
      dueDate: "Due date",
      referenceNumber: "Reference number",
      penaltyInterest: "Late payment interest",
      orderConfirmation: "Order confirmation",
      creditedInvoice: "Credited invoice",
    },
    businessId: "Business ID",
    vatNumber: "VAT number",
    cols: { pos: "Pos", code: "Code", name: "Item", qty: "Qty", unit: "Unit", price: "Unit price", vat: "VAT%", discount: "Disc%", amount: "Total" },
    net: "Total excl. VAT",
    vatBreakdown: "VAT BREAKDOWN",
    vatCols: { rate: "VAT rate", net: "Excl. VAT", vat: "VAT", gross: "Incl. VAT" },
    total: "Total",
    payable: { ORDER_CONFIRMATION: "Total", INVOICE: "Amount due", CREDIT_NOTE: "Credit total" },
    reverseCharge: "Reverse charge (VAT Act 8 c §). The buyer is liable for VAT.",
    payment: "Payment details",
    recipient: "Payee",
    account: "Account (IBAN)",
    amount: "Amount",
    barcode: "Virtual barcode",
    notes: "Notes",
    footer: { visiting: "Address:", einvoice: "E-invoice address:", operator: "Operator ID:", bank: "Bank:", vatReg: "VAT reg.", domicile: "Domicile" },
    creditInfo: "The credit is deducted from the amount due unless agreed otherwise.",
  },
} as const;

/** Characters the standard PDF fonts (WinAnsi) cannot encode are replaced. */
function safe(text: string): string {
  return text
    .replace(/[−‐‑]/g, "-")
    .replace(/ /g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e -ÿ€–—‘’“”•…]/g, "?");
}

/** Word-wraps text (newlines kept as breaks) to lines that fit `max`. */
function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of safe(para).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= max) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A single word wider than the column is cut.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > max && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > max) cut--;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

const nonEmpty = (lines: (string | null | undefined)[]) => lines.map((l) => (l ?? "").trim()).filter(Boolean);
const splitLines = (text: string | null) => (text ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export async function renderSalesDocumentPdf(input: SalesPdfInput): Promise<Uint8Array> {
  const L = LABELS[input.language];
  const locale = input.language === "fi" ? "fi-FI" : "en-GB";
  const doc = await PDFDocument.create();
  const heading = L[input.kind];
  doc.setTitle(safe(`${heading}${input.number ? ` ${input.number}` : ""} – ${input.seller.legalName}`));
  doc.setAuthor(safe(input.seller.legalName));
  doc.setCreator("SK Management");
  doc.setProducer("SK Management");
  doc.setLanguage(locale);
  // Fixed dates keep the bytes of an issued document reproducible.
  doc.setCreationDate(input.issueDate);
  doc.setModificationDate(input.issueDate);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const fmt = (v: string, digits: number) => safe(new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(v)));
  const money = (v: string) => fmt(v, 2);
  const qty = (v: string) => (Number.isInteger(Math.round(Number(v) * 1000) / 10) ? fmt(v, 2) : fmt(v, 3));
  const date = (d: Date) => safe(new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "numeric", year: "numeric" }).format(d));
  const cur = input.currency === "EUR" ? "€" : input.currency;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const text = (p: PDFPage, s: string, x: number, yy: number, size: number, opts: { font?: PDFFont; color?: RGB; align?: "left" | "right" | "center"; width?: number } = {}) => {
    const f = opts.font ?? font;
    const t = safe(s);
    const w = f.widthOfTextAtSize(t, size);
    const dx = opts.align === "right" ? (opts.width ?? 0) - w : opts.align === "center" ? ((opts.width ?? 0) - w) / 2 : 0;
    p.drawText(t, { x: x + dx, y: yy, size, font: f, color: opts.color ?? NAVY });
  };
  const hline = (p: PDFPage, x: number, yy: number, w: number, color: RGB = RULE, thickness = 0.6) => p.drawRectangle({ x, y: yy, width: w, height: thickness, color });

  const drawLogo = (p: PDFPage, x: number, top: number, width: number) => {
    const scale = width / SK_INFRA_LOGO.width;
    for (const path of SK_INFRA_LOGO.paths) {
      const c = path.fill;
      p.drawSvgPath(path.d, { x, y: top, scale, color: rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255) });
    }
    return SK_INFRA_LOGO.height * scale;
  };

  // ── page header on every page: logo left; title, number and date right ──
  const headerX = M.left + CONTENT_W * 0.5;
  const pageHeader = (p: PDFPage) => {
    const top = A4.h - M.top;
    let logoH: number;
    if (input.seller.logo === "SK_INFRA") logoH = drawLogo(p, M.left, top, 150);
    else {
      text(p, input.seller.legalName, M.left, top - 18, 16, { font: bold });
      logoH = 22;
    }
    text(p, heading, headerX, top - 12, 14, { font: bold });
    text(p, L.number, headerX, top - 34, 8.5, { font: bold });
    text(p, L.date, headerX + 120, top - 34, 8.5, { font: bold });
    text(p, input.number ?? "–", headerX, top - 49, 10);
    text(p, date(input.issueDate), headerX + 120, top - 49, 10);
    hline(p, headerX, top - 56, CONTENT_W * 0.5, TURQUOISE, 1.2);
    return top - Math.max(logoH, 58) - 16;
  };

  // ── line table ──
  const cols: { key: string; label: string; width: number; align: "left" | "right" }[] = [
    { key: "pos", label: L.cols.pos, width: 26, align: "left" },
    { key: "code", label: L.cols.code, width: 66, align: "left" },
    { key: "name", label: L.cols.name, width: 0, align: "left" },
    { key: "qty", label: L.cols.qty, width: 48, align: "right" },
    { key: "unit", label: L.cols.unit, width: 28, align: "left" },
    { key: "price", label: L.cols.price, width: 56, align: "right" },
    { key: "vat", label: L.cols.vat, width: 38, align: "right" },
    { key: "discount", label: L.cols.discount, width: 36, align: "right" },
    { key: "amount", label: L.cols.amount, width: 64, align: "right" },
  ];
  const fixedW = cols.reduce((sum, c) => sum + c.width, 0);
  for (const c of cols) if (c.key === "name") c.width = CONTENT_W - fixedW;
  const colX: Record<string, { x: number; w: number }> = {};
  {
    let x = M.left;
    for (const c of cols) {
      colX[c.key] = { x, w: c.width };
      x += c.width;
    }
  }
  const PAD = 3;

  const tableHeader = () => {
    const h = 17;
    page.drawRectangle({ x: M.left, y: y - h, width: CONTENT_W, height: h, color: NAVY });
    for (const c of cols) text(page, c.label, colX[c.key].x + PAD, y - 11.5, 7.5, { font: bold, color: WHITE, align: c.align, width: colX[c.key].w - 2 * PAD });
    y -= h + 2;
  };

  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    y = pageHeader(page);
  };

  const ensure = (needed: number, withTableHeader = false) => {
    if (y - needed >= M.bottom) return;
    newPage();
    if (withTableHeader) tableHeader();
  };

  newPage();

  // ── addresses (left) and fields (right) ──
  const b = input.buyer;
  const leftW = headerX - M.left - 16;
  const billing = nonEmpty([b.name, ...splitLines(b.address), [b.postalCode, b.city].filter(Boolean).join(" "), b.country]);
  const delivery = input.deliveryAddress ? splitLines(input.deliveryAddress) : billing;
  let ly = y;
  const addressBlock = (label: string, lines: string[]) => {
    text(page, label, M.left, ly, 8.5, { font: bold });
    if (b.customerNumber) text(page, b.customerNumber, M.left + 120, ly, 8.5, { font: bold });
    ly -= 13;
    for (const l of lines) {
      for (const part of wrap(l, font, 9, leftW)) {
        text(page, part, M.left, ly, 9);
        ly -= 11.5;
      }
    }
    ly -= 6;
  };
  addressBlock(L.billing, billing);
  addressBlock(L.delivery, delivery);
  for (const l of nonEmpty([b.businessId ? `${L.businessId} ${b.businessId}` : null, b.vatNumber ? `${L.vatNumber} ${b.vatNumber}` : null])) {
    text(page, l, M.left, ly, 8, { color: MUTED });
    ly -= 10.5;
  }

  const F = L.fields;
  const fields: [string, string | null][] =
    input.kind === "ORDER_CONFIRMATION"
      ? [
          [F.deliveryMethod, input.deliveryMethod],
          [F.deliveryInfo, input.deliveryInfo],
          [F.paymentTerms, input.paymentTerms],
          [F.deliveryTerms, input.deliveryTerms],
          [F.deliveryTime, input.deliveryDate ? date(input.deliveryDate) : null],
          [F.deliveryText, input.deliveryText],
          [F.salesperson, input.salesperson],
          [F.ourReference, input.ourReference],
          [F.buyerOrderNumber, input.buyerOrderNumber],
          [F.buyerReference, input.buyerReference],
          [F.orderMark, input.orderMark],
          [F.contact, b.contact],
        ]
      : [
          [F.dueDate, input.dueDate ? date(input.dueDate) : null],
          [F.referenceNumber, input.referenceNumber],
          [F.paymentTerms, input.paymentTerms],
          ...(input.kind === "INVOICE" ? [[F.penaltyInterest, input.seller.penaltyInterest] as [string, string]] : []),
          [F.deliveryDate, input.deliveryDate ? date(input.deliveryDate) : null],
          [F.deliveryMethod, input.deliveryMethod],
          [input.kind === "INVOICE" ? F.orderConfirmation : F.creditedInvoice, input.sourceNumber],
          [F.salesperson, input.salesperson],
          [F.ourReference, input.ourReference],
          [F.buyerOrderNumber, input.buyerOrderNumber],
          [F.buyerReference, input.buyerReference],
          [F.contact, b.contact],
        ];
  const labelW = 92;
  const valueW = CONTENT_W * 0.5 - labelW;
  let ry = y;
  for (const [label, value] of fields) {
    // Order confirmations list every field like the model; invoices only the filled ones.
    if (input.kind !== "ORDER_CONFIRMATION" && !value) continue;
    text(page, label, headerX, ry, 8.5, { font: bold });
    const parts = value ? wrap(value, font, 9, valueW) : [""];
    parts.forEach((part, k) => text(page, part, headerX + labelW, ry - k * 11, 9));
    ry -= 11 * parts.length + 2.5;
  }

  y = Math.min(ly, ry) - 10;
  if (input.title) {
    for (const l of wrap(input.title, bold, 11, CONTENT_W)) {
      text(page, l, M.left, y, 11, { font: bold });
      y -= 14;
    }
    y -= 2;
  }

  // ── lines ──
  tableHeader();
  const nameW = colX.name.w - 2 * PAD;
  for (const [i, l] of input.lines.entries()) {
    const nameLines = wrap(l.name, font, 8.5, nameW);
    const descLines = [...(l.deliveryTime ? [`${F.deliveryTime}: ${l.deliveryTime}`] : []), ...(l.description ? [l.description] : [])].flatMap((d) => wrap(d, font, 8, nameW));
    const codeLines = l.productCode ? wrap(l.productCode, font, 8, colX.code.w - 2 * PAD) : ["-"];
    // The row itself stays together; long descriptions may continue on the next page.
    ensure(Math.max(nameLines.length * 10.5, codeLines.length * 10) + Math.min(descLines.length, 3) * 10 + 6, true);
    const base = y - 9;
    const cell = (key: string, value: string) => {
      const c = cols.find((x) => x.key === key)!;
      text(page, value, colX[key].x + PAD, base, 8.5, { align: c.align, width: colX[key].w - 2 * PAD });
    };
    cell("pos", String(i + 1));
    codeLines.forEach((part, k) => text(page, part, colX.code.x + PAD, base - k * 10, 8));
    nameLines.forEach((part, k) => text(page, part, colX.name.x + PAD, base - k * 10.5, 8.5));
    cell("qty", qty(l.quantity));
    cell("unit", l.unit);
    cell("price", money(l.unitPrice));
    cell("vat", input.vatMode === "REVERSE_CHARGE" ? fmt("0", 2) : fmt(l.vatRate, 2));
    cell("discount", fmt(l.discountPct, 2));
    cell("amount", money(l.amount));
    y = Math.min(base - nameLines.length * 10.5, base - codeLines.length * 10) + 1;
    for (const d of descLines) {
      ensure(10, true);
      text(page, d, colX.name.x + PAD, y, 8, { color: MUTED });
      y -= 10;
    }
    y -= 6;
  }
  hline(page, M.left, y + 2, CONTENT_W, NAVY, 0.8);
  y -= 12;

  // ── totals and VAT breakdown ──
  ensure(18);
  text(page, L.net, M.left, y, 9, { font: bold, align: "right", width: CONTENT_W - 80 });
  text(page, money(input.totals.net), M.left, y, 9, { font: bold, align: "right", width: CONTENT_W });
  y -= 20;

  const groups = input.vatMode === "REVERSE_CHARGE" ? [{ rate: "0", net: input.totals.net, vat: "0" }] : input.totals.groups;
  const vx = M.left + CONTENT_W * 0.4;
  const vw = CONTENT_W - (vx - M.left);
  // Column right edges: rate, net, vat, (currency), gross.
  const edges = [vx + vw * 0.2, vx + vw * 0.46, vx + vw * 0.68, vx + vw];
  const vcell = (s: string, edge: number, f: PDFFont = font) => text(page, s, edge - 90, y, 8.5, { font: f, align: "right", width: 90 });
  ensure(40 + groups.length * 12);
  text(page, L.vatBreakdown, vx, y, 8.5, { font: bold, color: TURQUOISE });
  y -= 14;
  vcell(L.vatCols.rate, edges[0], bold);
  vcell(L.vatCols.net, edges[1], bold);
  vcell(L.vatCols.vat, edges[2], bold);
  vcell(L.vatCols.gross, edges[3], bold);
  y -= 5;
  hline(page, vx, y, vw);
  y -= 11;
  for (const g of groups) {
    vcell(`${fmt(g.rate, 2)} %`, edges[0]);
    vcell(money(g.net), edges[1]);
    vcell(money(g.vat), edges[2]);
    vcell(money((Number(g.net) + Number(g.vat)).toFixed(2)), edges[3]);
    y -= 12;
  }
  hline(page, vx, y + 8, vw);
  vcell(L.total, edges[0], bold);
  vcell(money(input.totals.net), edges[1], bold);
  vcell(money(input.totals.vat), edges[2], bold);
  text(page, input.currency, edges[2] + 10, y, 8.5, { font: bold });
  vcell(money(input.totals.gross), edges[3], bold);
  y -= 20;

  if (input.kind !== "ORDER_CONFIRMATION") {
    ensure(28);
    page.drawRectangle({ x: vx, y: y - 8, width: vw, height: 22, color: NAVY });
    text(page, L.payable[input.kind], vx + 8, y - 1, 10, { font: bold, color: WHITE });
    text(page, `${money(input.totals.gross)} ${cur}`, vx, y - 1, 11, { font: bold, color: WHITE, align: "right", width: vw - 8 });
    y -= 30;
  }

  const paragraph = (s: string, f: PDFFont, size: number, color: RGB = NAVY, gap = 0) => {
    for (const l of wrap(s, f, size, CONTENT_W)) {
      ensure(size + 3);
      text(page, l, M.left, y, size, { font: f, color });
      y -= size + 2.5;
    }
    y -= gap;
  };

  if (input.vatMode === "REVERSE_CHARGE") paragraph(L.reverseCharge, bold, 8.5, NAVY, 6);
  if (input.kind === "CREDIT_NOTE") paragraph(L.creditInfo, font, 8.5, MUTED, 6);

  // ── payment details (invoices) ──
  if (input.kind === "INVOICE") {
    const rows: [string, string][] = [
      [L.recipient, input.seller.legalName],
      [L.account, input.seller.iban],
      ...(input.seller.bic ? [["BIC", `${input.seller.bic}${input.seller.bankName ? ` (${input.seller.bankName})` : ""}`] as [string, string]] : []),
      ...(input.referenceNumber ? [[F.referenceNumber, input.referenceNumber] as [string, string]] : []),
      ...(input.dueDate ? [[F.dueDate, date(input.dueDate)] as [string, string]] : []),
      [L.amount, `${money(input.totals.gross)} ${cur}`],
    ];
    const h = 22 + rows.length * 12.5 + (input.virtualBarcode ? 14 : 0);
    ensure(h + 6);
    page.drawRectangle({ x: M.left, y: y - h + 10, width: CONTENT_W, height: h, color: GREY });
    page.drawRectangle({ x: M.left, y: y - h + 10, width: 3, height: h, color: TURQUOISE });
    let py = y - 4;
    text(page, L.payment.toUpperCase(), M.left + 12, py, 7.5, { font: bold, color: TURQUOISE });
    py -= 14;
    for (const [label, value] of rows) {
      text(page, label, M.left + 12, py, 8.5, { color: MUTED });
      text(page, value, M.left + 120, py, 9, { font: bold });
      py -= 12.5;
    }
    if (input.virtualBarcode) {
      text(page, L.barcode, M.left + 12, py - 2, 7.5, { color: MUTED });
      text(page, input.virtualBarcode, M.left + 120, py - 2, 8);
    }
    y -= h + 8;
  }

  if (input.notes) {
    ensure(26);
    text(page, L.notes.toUpperCase(), M.left, y, 8.5, { font: bold, color: TURQUOISE });
    y -= 13;
    paragraph(input.notes, font, 9, NAVY, 8);
  }

  // ── terms: numbered headings such as "1. VUOKRA-AIKA" in bold ──
  if (input.terms) {
    ensure(40);
    hline(page, M.left, y + 6, CONTENT_W, TURQUOISE, 1);
    y -= 8;
    if (input.termsTitle) {
      text(page, input.termsTitle.toUpperCase(), M.left, y, 9.5, { font: bold });
      y -= 16;
    }
    for (const para of input.terms.replace(/\r\n?/g, "\n").split("\n")) {
      const t = para.trim();
      if (!t) {
        y -= 4;
        continue;
      }
      const isHeading = /^\d+\s*\.?\s*\S/.test(t) && t === t.toUpperCase() && t.length <= 80;
      if (isHeading) {
        ensure(30);
        y -= 3;
      }
      paragraph(t, isHeading ? bold : font, 8, NAVY, isHeading ? 1 : 0);
    }
  }

  // ── footer (four columns), page number and watermark on every page ──
  const s = input.seller;
  const footer: string[][] = [
    nonEmpty([L.footer.visiting, s.legalName, s.streetAddress, `${s.postalCode} ${s.city}`]),
    s.einvoiceAddress
      ? nonEmpty([L.footer.einvoice, s.einvoiceAddress, s.einvoiceOperator ? L.footer.operator : null, s.einvoiceOperator])
      : nonEmpty([L.footer.bank, s.bankName, `IBAN ${s.iban}`, s.bic ? `BIC ${s.bic}` : null]),
    nonEmpty([s.phone, s.email, s.website]),
    nonEmpty([s.vatNumber ? `${L.footer.vatReg} ${s.vatNumber}` : null, s.domicile ? `${L.footer.domicile} ${s.domicile}` : null, `${L.businessId} ${s.businessId}`, s.einvoiceAddress ? `IBAN ${s.iban}` : null]),
  ];
  const footW = CONTENT_W / footer.length;
  for (const [i, p] of pages.entries()) {
    const top = A4.h - M.top;
    text(p, `${i + 1}/${pages.length}`, M.left, top - 12, 9, { align: "right", width: CONTENT_W });
    hline(p, M.left, 66, CONTENT_W, TURQUOISE, 1);
    footer.forEach((col, c) => {
      col.slice(0, 4).forEach((l, k) => {
        const fitted = wrap(l, font, 7, footW - 6)[0] ?? "";
        const strong = k === 0 && (c === 0 || c === 1);
        text(p, fitted, M.left + c * footW, 55 - k * 9.5, 7, { font: strong ? bold : font, color: strong ? NAVY : MUTED });
      });
    });
    if (s.footerNote) text(p, wrap(s.footerNote, font, 6.5, CONTENT_W - 40)[0] ?? "", M.left, 12, 6.5, { color: MUTED });
    if (input.draft) {
      const size = 96;
      const w = bold.widthOfTextAtSize(L.draft, size);
      p.drawText(L.draft, { x: A4.w / 2 - (w / 2) * Math.cos(Math.PI / 6), y: A4.h / 2 - (w / 2) * Math.sin(Math.PI / 6), size, font: bold, color: TURQUOISE, opacity: 0.12, rotate: degrees(30) });
    }
  }

  return doc.save();
}
