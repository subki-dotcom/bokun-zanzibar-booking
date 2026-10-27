// The invoice / credit note PDF: the same A4 sheet as the web page (mockup "Invoice"), drawn with the mockup's
// pixel values (A4 = 794 × 1123 px at 96 dpi; 1 px = 0.75 pt). Outfit is embedded, text stays selectable and
// the QR code is vector. Long tables continue on the next page with the header repeated; the totals block is
// kept together; every page has "Page X of Y".
const path = require("path");
const PDFDocument = require("pdfkit");
const { drawBrandMark, filePrefix } = require("./brandMark");
const QRCode = require("qrcode");

const PX = 0.75;
const W = 794;
const H = 1123;
const PAD = 56;
const CONTENT = W - PAD * 2;
const BOTTOM = H - 72;
const C = {
  brand: "#0E6B57",
  brandSoft: "#E7F3EF",
  ink: "#14211F",
  muted: "#55625F",
  border: "#E3E7E5",
  borderStrong: "#C9D1CE",
  pageAlt: "#F6F7F6",
  warning: "#8A4205",
  danger: "#9A3412"
};
const FONT_DIR = path.join(__dirname, "../../../assets/fonts");
const FONTS = { regular: "Outfit-400.ttf", medium: "Outfit-500.ttf", semibold: "Outfit-600.ttf", bold: "Outfit-700.ttf" };

const money = (amount, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
};
const ZANZIBAR_OFFSET_MS = 3 * 60 * 60 * 1000;
const day = (value) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00Z`) : new Date(Date.parse(value) + ZANZIBAR_OFFSET_MS);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const dayTime = (iso) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return `${day(iso)}, ${new Date(ms + ZANZIBAR_OFFSET_MS).toISOString().slice(11, 16)} (Zanzibar time)`;
};
const weekdayDate = (date) => {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return "";
  return `${value.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}, ${day(date)}`;
};
// No ligatures ("ff", "tt" as one glyph), so copied and searched text reads exactly as written.
const PLAIN = { liga: false, clig: false, dlig: false };
const STAMP = { brand: C.brand, warning: C.warning, danger: C.danger };

const renderDocumentPdf = (view) =>
  new Promise((resolve, reject) => {
    const isCredit = view.kind === "credit_note";
    const title = `${isCredit ? "Credit note" : "Invoice"} ${view.number}`;
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
      info: { Title: title, Author: view.company?.name || "", Subject: `Booking ${view.bookingReference}`, Creator: view.company?.name || "" }
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    Object.entries(FONTS).forEach(([name, file]) => doc.registerFont(name, path.join(FONT_DIR, file)));

    // Everything below is in CSS px.
    const p = (value) => value * PX;
    const font = (name, size, color = C.ink) => doc.font(name).fontSize(p(size)).fillColor(color);
    const textAt = (value, x, y, options = {}) => doc.text(String(value ?? ""), p(x), p(y), { lineBreak: false, features: PLAIN, ...options, width: options.width ? p(options.width) : undefined });
    const rect = (x, y, w, h, color, radius = 0) => (radius ? doc.roundedRect(p(x), p(y), p(w), p(h), p(radius)) : doc.rect(p(x), p(y), p(w), p(h))).fill(color);
    const line = (x1, y1, x2, y2, color, width = 1) => doc.save().moveTo(p(x1), p(y1)).lineTo(p(x2), p(y2)).lineWidth(p(width)).strokeColor(color).stroke().restore();
    const heightOf = (value, width, size, name = "regular") => doc.font(name).fontSize(p(size)).heightOfString(String(value || ""), { width: p(width), lineGap: p(size * 0.5), features: PLAIN }) / PX;
    const eyebrow = (value, x, y) => {
      font("bold", 11, C.muted);
      textAt(value.toUpperCase(), x, y, { characterSpacing: p(1) });
    };
    const currency = view.currency || "USD";

    const pageTop = () => rect(0, 0, W, 8, C.brand);

    // Header
    pageTop();
    drawBrandMark(doc, p(PAD), p(48), p(44));
    font("bold", 18);
    textAt(view.company?.name || "", PAD + 56, 51);
    font("regular", 11, C.muted);
    textAt(view.company?.tagline || "", PAD + 56, 73);
    const companyLines = [
      // The registered name, when it differs from the brand name above.
      view.company?.legalName && view.company.legalName !== view.company.name ? view.company.legalName : "",
      view.company?.address ? `${view.company.address}` : "",
      [view.company?.phone, view.company?.email].filter(Boolean).join(" · "),
      view.company?.website || "",
      [view.company?.tin ? `TIN: ${view.company.tin}` : "", view.company?.licence ? `Licence: ${view.company.licence}` : ""].filter(Boolean).join(" · ")
    ].filter(Boolean);
    font("regular", 12, C.muted);
    companyLines.forEach((value, index) => textAt(value, PAD, 108 + index * 19.5));

    font("bold", 34);
    textAt(isCredit ? "CREDIT NOTE" : "INVOICE", W - PAD - 340, 46, { width: 340, align: "right" });
    font("regular", 13, C.muted);
    textAt(view.number, W - PAD - 340, 92, { width: 340, align: "right" });
    if (isCredit && view.creditFor) textAt(`for invoice ${view.creditFor}`, W - PAD - 340, 110, { width: 340, align: "right" });

    // Status stamp
    if (view.status?.label) {
      const color = STAMP[view.status.tone] || C.brand;
      // Longer words (UNPAID, REFUNDED) a little smaller so the stamp stays clear of the meta strip.
      const stampSize = view.status.label.length > 5 ? 22 : 26;
      font("bold", stampSize, color);
      const stampWidth = doc.widthOfString(view.status.label, { characterSpacing: p(4), features: PLAIN }) / PX + 32;
      const cx = W - PAD - 58;
      const cy = 164;
      doc.save().rotate(-12, { origin: [p(cx), p(cy)] });
      doc.roundedRect(p(cx - stampWidth / 2), p(cy - (stampSize + 16) / 2), p(stampWidth), p(stampSize + 16), p(8)).lineWidth(p(3)).strokeColor(color).stroke();
      textAt(view.status.label, cx - stampWidth / 2, cy - stampSize * 0.58, { width: stampWidth, align: "center", characterSpacing: p(4) });
      doc.restore();
    }

    // Meta strip
    let y = 208;
    const cells = isCredit
      ? [["Issue date", day(view.issueDate)], ["Booking reference", view.bookingReference], ["Original invoice", view.creditFor || "—"], ["Amount credited", `${money(view.total, currency)} ${currency}`]]
      : [
          ["Issue date", day(view.issueDate)],
          ["Booking reference", view.bookingReference],
          ["Payment date", view.paymentDate ? day(view.paymentDate) : "—"],
          view.balanceDue > 0 ? ["Amount due", `${money(view.balanceDue, currency)} ${currency}`] : ["Amount paid", `${money(view.amountPaid, currency)} ${currency}`]
        ];
    const cellWidth = CONTENT / 4;
    const amountDue = !isCredit && view.balanceDue > 0;
    rect(PAD + cellWidth * 3, y, cellWidth, 57, amountDue ? "#FDF1E3" : C.brandSoft, 0);
    doc.roundedRect(p(PAD), p(y), p(CONTENT), p(57), p(10)).lineWidth(p(1)).strokeColor(C.border).stroke();
    cells.forEach(([label, value], index) => {
      const x = PAD + cellWidth * index;
      if (index) line(x, y, x, y + 57, C.border);
      const highlight = index === 3;
      const highlightColor = amountDue ? C.warning : C.brand;
      font("regular", 11, highlight ? highlightColor : C.muted);
      textAt(label, x + 15, y + 13);
      font("bold", 13, highlight ? highlightColor : C.ink);
      textAt(value, x + 15, y + 29, { width: cellWidth - 24, ellipsis: true });
    });
    // The rounded corner of the highlighted cell.
    doc.roundedRect(p(PAD), p(y), p(CONTENT), p(57), p(10)).lineWidth(p(1)).strokeColor(C.border).stroke();

    // Billed to / Trip
    y = 302;
    const colX = PAD + 356;
    eyebrow("Billed to", PAD, y);
    eyebrow("Trip", colX, y);
    font("bold", 15);
    textAt(view.billedTo?.name || "—", PAD, y + 22, { width: 330 });
    textAt(view.trip?.tour || "—", colX, y + 22, { width: CONTENT - 356 });
    const billed = [view.billedTo?.email, view.billedTo?.phone, view.billedTo?.country, view.billedTo?.company, view.billedTo?.taxId ? `VAT/TIN: ${view.billedTo.taxId}` : ""].filter(Boolean);
    const trip = [
      view.trip?.option,
      [weekdayDate(view.trip?.date), view.trip?.startTime ? `${view.trip.startTime} (Zanzibar time)` : ""].filter(Boolean).join(" · "),
      view.trip?.pickup ? `Pickup: ${view.trip.pickup}` : ""
    ].filter(Boolean);
    font("regular", 13, C.ink);
    billed.forEach((value, index) => textAt(value, PAD, y + 48 + index * 20.5, { width: 330, ellipsis: true }));
    trip.forEach((value, index) => textAt(value, colX, y + 48 + index * 20.5, { width: CONTENT - 356, ellipsis: true }));
    y += 48 + Math.max(billed.length, trip.length) * 20.5 + 28;

    // Line items
    const cols = { desc: PAD + 12, date: 368, qtyCenter: 512, unitRight: 634, amountRight: W - PAD - 12 };
    const tableHeader = () => {
      rect(PAD, y, CONTENT, 36, C.ink, 6);
      font("semibold", 12, "#FFFFFF");
      textAt("Description", cols.desc, y + 11);
      textAt("Date", cols.date, y + 11);
      textAt("Qty", cols.qtyCenter - 30, y + 11, { width: 60, align: "center" });
      textAt("Unit price", cols.unitRight - 100, y + 11, { width: 100, align: "right" });
      textAt("Amount", cols.amountRight - 100, y + 11, { width: 100, align: "right" });
      y += 36;
    };
    const newPage = () => {
      doc.addPage({ size: "A4", margin: 0 });
      pageTop();
      y = 48;
    };
    tableHeader();
    (view.lineItems || []).forEach((item) => {
      const descWidth = cols.date - cols.desc - 16;
      const subHeight = item.subDescription ? heightOf(item.subDescription, descWidth, 12) : 0;
      const rowHeight = item.subDescription ? Math.max(62, 36 + subHeight + 10) : 44;
      if (y + rowHeight > BOTTOM) {
        newPage();
        tableHeader();
      }
      const mid = y + (item.subDescription ? 22 : 15);
      font(item.subDescription ? "bold" : "regular", 13, item.subDescription ? C.ink : C.muted);
      textAt(item.description, cols.desc, item.subDescription ? y + 14 : y + 14, { width: descWidth });
      if (item.subDescription) {
        font("regular", 12, C.muted);
        doc.text(item.subDescription, p(cols.desc), p(y + 33), { width: p(descWidth), lineGap: p(6), features: PLAIN });
      }
      font("regular", 13, item.included ? C.muted : C.ink);
      textAt(item.date ? day(item.date) : "—", cols.date, mid);
      textAt(String(item.qty ?? ""), cols.qtyCenter - 30, mid, { width: 60, align: "center" });
      textAt(item.included ? "Included" : money(item.unitPrice, currency), cols.unitRight - 120, mid, { width: 120, align: "right" });
      textAt(money(item.amount, currency), cols.amountRight - 120, mid, { width: 120, align: "right" });
      y += rowHeight;
      line(PAD, y, W - PAD, y, C.border);
    });

    // Totals and verification QR, kept together.
    const totalRows = [["Subtotal", money(view.subtotal, currency)], ["Discount", view.discount ? `− ${money(view.discount, currency)}` : money(0, currency)]];
    if (view.tax) totalRows.push([`${view.tax.label} ${view.tax.rate}%`, money(view.tax.amount, currency)]);
    const totalsHeight = 20 + totalRows.length * 25 + 20 + 30 + (isCredit ? 0 : 27 + 45);
    if (y + totalsHeight > BOTTOM) newPage();
    y += 20;
    const totalsX = W - PAD - 300;
    if (view.verificationUrl) {
      const qr = QRCode.create(view.verificationUrl, { errorCorrectionLevel: "M" });
      const size = qr.modules.size;
      const box = 92;
      doc.roundedRect(p(PAD), p(y), p(box), p(box), p(6)).lineWidth(p(1)).strokeColor(C.border).stroke();
      const cell = (box - 12) / size;
      doc.save().fillColor(C.ink);
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          if (qr.modules.get(row, col)) doc.rect(p(PAD + 6 + col * cell), p(y + 6 + row * cell), p(cell) + 0.15, p(cell) + 0.15).fill();
        }
      }
      doc.restore();
      font("regular", 11.5, C.muted);
      textAt(`Scan to verify this ${isCredit ? "credit note" : "invoice"}`, PAD + 108, y + 4);
      textAt("or visit", PAD + 108, y + 21);
      font("regular", 10, C.brand);
      doc.text(view.verificationUrl, p(PAD + 108), p(y + 38), { width: p(totalsX - PAD - 140), link: view.verificationUrl, features: PLAIN });
    }
    let ty = y;
    totalRows.forEach(([label, value]) => {
      font("regular", 13, C.muted);
      textAt(label, totalsX, ty);
      font("regular", 13, C.ink);
      textAt(value, totalsX, ty, { width: 300, align: "right" });
      ty += 25;
    });
    line(totalsX, ty, W - PAD, ty, C.ink, 2);
    ty += 12;
    font("bold", 16);
    textAt(isCredit ? "Total credited" : "Total", totalsX, ty);
    textAt(`${money(view.total, currency)} ${currency}`, totalsX, ty, { width: 300, align: "right" });
    ty += 30;
    if (!isCredit) {
      font("regular", 13, C.muted);
      textAt("Amount paid", totalsX, ty);
      font("regular", 13, C.ink);
      textAt(`− ${money(view.amountPaid, currency)}`, totalsX, ty, { width: 300, align: "right" });
      ty += 22;
      if (view.amountRefunded > 0) {
        font("regular", 13, C.muted);
        textAt("Refunded", totalsX, ty);
        font("regular", 13, C.ink);
        textAt(`+ ${money(view.amountRefunded, currency)}`, totalsX, ty, { width: 300, align: "right" });
        ty += 22;
      }
      const due = view.balanceDue > 0;
      rect(totalsX, ty, 300, 35, due ? "#FDF1E3" : C.brandSoft, 8);
      font("bold", 13, due ? C.warning : C.brand);
      textAt("Balance due", totalsX + 14, ty + 10);
      font("bold", 14, due ? C.warning : C.brand);
      textAt(money(view.balanceDue, currency), totalsX, ty + 9, { width: 286, align: "right" });
      ty += 35;
    }
    y = Math.max(ty, y + 92) + 24;

    // Payment and cancellation policy
    const payment = view.payments?.[0];
    const leftLines = isCredit
      ? [`Refund to the original payment method`, `Booking ${view.bookingReference}`]
      : payment
        ? [
            [payment.method, payment.brand && payment.last4 ? `${payment.brand} •••• ${payment.last4}` : payment.brand].filter(Boolean).join(" · "),
            payment.transactionId ? `Transaction ID: ${payment.transactionId}` : "",
            payment.paidAt ? `Paid on ${dayTime(payment.paidAt)}` : ""
          ].filter(Boolean)
        : ["No payment received yet."];
    const boxWidth = (CONTENT - 23) / 2;
    const policyHeight = heightOf(view.cancellationPolicyText, boxWidth - 32, 12);
    const boxHeight = Math.max(109, 44 + Math.max(leftLines.length * 19.5, policyHeight) + 16);
    if (y + boxHeight + 90 > H - 24) newPage();
    rect(PAD, y, boxWidth, boxHeight, C.pageAlt, 10);
    rect(PAD + boxWidth + 23, y, boxWidth, boxHeight, C.pageAlt, 10);
    eyebrow(isCredit ? "Refund" : "Payment", PAD + 16, y + 18);
    eyebrow("Cancellation policy", PAD + boxWidth + 39, y + 18);
    font("regular", 12, C.ink);
    leftLines.forEach((value, index) => textAt(value, PAD + 16, y + 42 + index * 19.5, { width: boxWidth - 32, ellipsis: true }));
    doc.text(view.cancellationPolicyText || "", p(PAD + boxWidth + 39), p(y + 42), { width: p(boxWidth - 32), lineGap: p(6), features: PLAIN });
    y += boxHeight + 24;

    // Footer on every page.
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      const fy = index === range.count - 1 ? Math.max(y, 0) : H - 80;
      line(PAD, fy, W - PAD, fy, C.border);
      font("bold", 13);
      textAt("Asante sana – thank you for booking with us!", PAD, fy + 18);
      font("regular", 11.5, C.muted);
      textAt(`Questions? WhatsApp ${view.company?.phone || ""} · ${view.company?.email || ""}`, PAD, fy + 37);
      textAt(`Computer-generated ${isCredit ? "credit note" : "invoice"}`, W - PAD - 260, fy + 18, { width: 260, align: "right" });
      textAt(`No signature required · Page ${index + 1} of ${range.count}`, W - PAD - 260, fy + 37, { width: 260, align: "right" });
    }
    doc.end();
  });

// "ZanzibarTours-Invoice-INV-2026-00001.pdf"
const pdfFileName = (view) => `${filePrefix()}-${view.kind === "credit_note" ? "CreditNote" : "Invoice"}-${String(view.number).replace(/[^A-Za-z0-9-]/g, "")}.pdf`;

module.exports = { renderDocumentPdf, pdfFileName };
