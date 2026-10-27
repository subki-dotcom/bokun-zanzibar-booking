// The e-ticket PDF: tour, date, pickup, masked lead traveler, travelers, reference and its QR code.
const PDFDocument = require("pdfkit");
const path = require("path");
const { drawBrandMark } = require("../invoiceDocuments/brandMark");

const FONT_DIR = path.join(__dirname, "../../../assets/fonts");

const PLAIN = { liga: false, clig: false, dlig: false };
const BRAND = "#0E6B57";
const INK = "#14211F";
const MUTED = "#55625F";
const BORDER = "#E3E7E5";

const longDate = (date = "") => {
  const ms = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : "—";
};

const drawQr = (doc, qr, x, y, size) => {
  const count = qr.modules.size;
  const cell = size / count;
  doc.save().fillColor(INK);
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.modules.get(row, col)) doc.rect(x + col * cell, y + row * cell, cell + 0.2, cell + 0.2).fill();
    }
  }
  doc.restore();
};

const field = (doc, label, value, x, y, width) => {
  doc.font("regular").fontSize(8).fillColor(MUTED).text(label, x, y, { width });
  doc.font("bold").fontSize(11).fillColor(INK).text(value || "—", x, y + 11, { width });
};

const buildTicketPdf = ({ data, qr, brand = "", phone = "", email = "", site = "" }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `E-ticket ${data.reference}`, Author: brand } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("regular", path.join(FONT_DIR, "Outfit-400.ttf"));
    doc.registerFont("bold", path.join(FONT_DIR, "Outfit-700.ttf"));
    // No ligatures ("fi", "tt" as one glyph), so copied text reads exactly as written.
    const plainText = doc.text.bind(doc);
    doc.text = (value, x, y, options) =>
      typeof x === "object" ? plainText(value, { features: PLAIN, ...x }) : plainText(value, x, y, { features: PLAIN, ...(options || {}) });

    const left = 48;
    const width = doc.page.width - 96;
    doc.roundedRect(left, 48, width, 56, 12).fill(BRAND);
    drawBrandMark(doc, left + 16, 60, 32, "light");
    doc.font("bold").fontSize(16).fillColor("#FFFFFF").text("E-ticket", left + 58, 68);
    doc.font("regular").fontSize(10).fillColor("#FFFFFF").text(`${brand} · Show at pickup`, left + 20, 70, { width: width - 40, align: "right" });

    let y = 128;
    doc.font("regular").fontSize(9).fillColor(MUTED).text("Experience", left, y);
    doc.font("bold").fontSize(18).fillColor(INK).text(data.tour.title || "—", left, y + 12, { width });
    y = doc.y + 2;
    if (data.tour.option) doc.font("regular").fontSize(11).fillColor(MUTED).text(data.tour.option, left, y, { width });
    y = doc.y + 18;

    const col = width / 2;
    field(doc, "Date", longDate(data.date), left, y, col - 12);
    field(doc, data.pickup?.type === "meeting" ? "Start time (Zanzibar time)" : "Pickup (Zanzibar time)", data.startTime || "To be confirmed", left + col, y, col);
    y += 40;
    field(doc, "Lead traveler", data.lead.name, left, y, col - 12);
    field(doc, "Travelers", data.travelersLabel, left + col, y, col);
    y += 40;
    if (data.pickup) {
      field(doc, data.pickup.type === "meeting" ? "Meeting point" : "Pickup point", `${data.pickup.name}${data.pickup.address ? ` – ${data.pickup.address}` : ""}`, left, y, width);
      y = doc.y + 16;
    }

    doc.moveTo(left, y).lineTo(left + width, y).dash(4, { space: 4 }).strokeColor(BORDER).stroke().undash();
    y += 22;
    drawQr(doc, qr, left, y, 120);
    doc.font("regular").fontSize(9).fillColor(MUTED).text("Booking reference", left + 144, y + 24);
    doc.font("Courier-Bold").fontSize(20).fillColor(INK).text(data.reference, left + 144, y + 38);
    doc.font("regular").fontSize(9).fillColor(MUTED).text(`Status: ${data.status.label}`, left + 144, y + 66);
    y += 150;

    doc.font("regular").fontSize(9).fillColor(MUTED).text(
      `All times are Zanzibar time (EAT, UTC+3). The day before your trip our team confirms the exact pickup time on WhatsApp. Questions: ${[phone, email].filter(Boolean).join(" · ")}${site ? ` · ${site}` : ""}`,
      left,
      y,
      { width }
    );
    doc.end();
  });

module.exports = { buildTicketPdf };
