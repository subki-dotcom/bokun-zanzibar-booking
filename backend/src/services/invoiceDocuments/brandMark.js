// The brand mark (dhow on the green square, frontend/public/brand/icon.svg) drawn as vectors in a PDF, and the
// file-name prefix of the brand ("ZanzibarTours-Invoice-INV-2026-00001.pdf").
const { env } = require("../../config/env");

// x, y and size in PDF points. variant "light": white square with a green dhow (for green backgrounds).
const drawBrandMark = (doc, x, y, size, variant = "brand") => {
  const ground = variant === "light" ? "#FFFFFF" : "#0E6B57";
  const sail = variant === "light" ? "#0E6B57" : "#FFFFFF";
  doc.save();
  doc.translate(x, y).scale(size / 64);
  doc.roundedRect(0, 0, 64, 64, 16).fill(ground);
  doc.circle(48, 16, 5).fill("#F2B544");
  doc.path("M31 11 L31 44").lineWidth(2.5).lineCap("round").stroke(sail);
  doc.path("M33 13 C42 21 46 32 45 43 L33 43 Z").fill(sail);
  doc.path("M29 18 C23 26 20 35 20 43 L29 43 Z").fillOpacity(0.8).fill(sail);
  doc.fillOpacity(1);
  doc.path("M14 46 H50 C48 51 44 54 39 54 H25 C20 54 16 51 14 46 Z").fill(sail);
  doc.restore();
};

const filePrefix = () => String(env.BRAND_NAME || "").split("&")[0].replace(/[^A-Za-z0-9]/g, "") || "Documents";

module.exports = { drawBrandMark, filePrefix };
