// "Free cancellation up to 24 hours before" from a policy summary such as "Free cancellation is available until
// 24 hours before departure."; empty when the policy offers no free cancellation.
export const freeCancellationLabel = (summary = "") => {
  const match = String(summary || "").match(/free cancellation is available until\s+(.+?)\s+before\b/i);
  return match ? `Free cancellation up to ${match[1].trim()} before` : "";
};

// WhatsApp link with the tour name already in the message.
export const tourQuestionWhatsappHref = (whatsappHref = "", tourTitle = "") => {
  if (!whatsappHref) return "";
  const text = tourTitle ? `Hello, I have a question about "${tourTitle}".` : "Hello, I have a question about a tour.";
  return `${whatsappHref}${whatsappHref.includes("?") ? "&" : "?"}text=${encodeURIComponent(text)}`;
};
