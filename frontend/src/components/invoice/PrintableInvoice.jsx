import Table from "react-bootstrap/Table";
import { formatCurrency, formatDate } from "../../utils/formatters";

const DetailBlock = ({ title, children }) => (
  <div className="invoice-detail-block">
    <small>{title}</small>
    {children}
  </div>
);

const InvoiceMeta = ({ label, value }) => (
  <div>
    <span>{label}</span>
    <strong>{value || "-"}</strong>
  </div>
);

const InvoiceStatusBadge = ({ status = "" }) => {
  const normalized = String(status || "").toLowerCase();
  const label = normalized === "paid" ? "Paid" : normalized === "failed" ? "Failed" : "Payment Pending";
  const className = normalized === "paid" ? "is-paid" : normalized === "failed" ? "is-failed" : "is-pending";

  return <span className={`invoice-status-badge ${className}`}>{label}</span>;
};

const PrintableInvoice = ({ invoice }) => {
  if (!invoice) {
    return null;
  }

  const currency = invoice.currency || "USD";
  const itemQuantity = Math.max(1, Number(invoice.totalPax || invoice.adults || 1));
  const itemTotal = Number(invoice.subtotal || invoice.total || 0);
  const items = [
    {
      label: invoice.tourName || "Tour package",
      description: invoice.bookedOption || "",
      quantity: itemQuantity,
      unitPrice: itemQuantity > 0 ? itemTotal / itemQuantity : itemTotal,
      total: itemTotal
    }
  ];

  return (
    <article className="invoice-paper">
      <header className="invoice-modern-header">
        <div className="invoice-brand-block">
          <div className="invoice-brand-mark">R</div>
          <div>
            <h1>Riser Tours & Safaris</h1>
            <p>Stone Town, Zanzibar</p>
          </div>
        </div>

        <div className="invoice-title-block">
          <span>Invoice</span>
          <strong>{invoice.invoiceNumber}</strong>
          <InvoiceStatusBadge status={invoice.paymentStatus} />
        </div>
      </header>

      <section className="invoice-meta-grid">
        <InvoiceMeta label="Booking Reference" value={invoice.bookingReference} />
        <InvoiceMeta label="Issue Date" value={formatDate(invoice.issueDate)} />
        <InvoiceMeta label="Payment Status" value={invoice.paymentStatus} />
        <InvoiceMeta label="Booking Status" value={invoice.bookingStatus} />
      </section>

      <section className="invoice-details-grid">
        <DetailBlock title="Bill To">
          <strong>{invoice.clientName || "-"}</strong>
          <span>{invoice.clientEmail || "-"}</span>
          <span>{invoice.clientPhone || "-"}</span>
          <span>{invoice.clientCountry || "-"}</span>
        </DetailBlock>

        <DetailBlock title="Trip">
          <strong>{invoice.tourName || "-"}</strong>
          <span>{invoice.bookedOption || "-"}</span>
          <span>{formatDate(invoice.tourDate)} {invoice.pickupTime ? `at ${invoice.pickupTime}` : ""}</span>
          <span>{invoice.pickupLocation || invoice.hotelName || "-"}</span>
        </DetailBlock>
      </section>

      <section className="invoice-items-section">
        <div className="invoice-section-title">
          <h2>Invoice Items</h2>
          <p>{invoice.totalPax || 0} traveler{Number(invoice.totalPax || 0) === 1 ? "" : "s"}</p>
        </div>

        <Table responsive className="invoice-modern-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th className="text-end">Unit</th>
              <th className="text-end">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.label || "item"}-${index}`}>
                <td>
                  <strong>{item.label || "Tour package"}</strong>
                  {item.description ? <small>{item.description}</small> : null}
                </td>
                <td>{item.quantity}</td>
                <td className="text-end">{formatCurrency(item.unitPrice, currency)}</td>
                <td className="text-end">{formatCurrency(item.total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="invoice-bottom-grid">
        <div className="invoice-notes-card">
          <h2>Notes</h2>
          <p>{invoice.notes || "Thank you for booking with Riser Tours & Safaris."}</p>
          <small>
            {String(invoice.paymentStatus || "").toLowerCase() === "paid"
              ? "Payment has been confirmed by the payment gateway."
              : invoice.paymentTerms || "Payment is pending. This invoice is not marked paid until the gateway confirms payment."}
          </small>
          <small>{invoice.cancellationPolicy || ""}</small>
        </div>

        <div className="invoice-totals-wrap">
          <div>
            <span>Subtotal</span>
            <strong>{formatCurrency(invoice.subtotal || 0, currency)}</strong>
          </div>
          <div>
            <span>Discount</span>
            <strong>-{formatCurrency(invoice.discount || 0, currency)}</strong>
          </div>
          <div>
            <span>Tax</span>
            <strong>{formatCurrency(invoice.tax || 0, currency)}</strong>
          </div>
          <div className="invoice-total-line">
            <span>Total</span>
            <strong>{formatCurrency(invoice.total || 0, currency)}</strong>
          </div>
          <div className="invoice-paid-line">
            <span>Amount Paid</span>
            <strong>{formatCurrency(invoice.amountPaid || 0, currency)}</strong>
          </div>
          <div className="invoice-balance-line">
            <span>Balance Due</span>
            <strong>{formatCurrency(invoice.balanceDue || 0, currency)}</strong>
          </div>
        </div>
      </section>

      <footer className="invoice-footer-note">
        <span>info@risertoursandsafaris.co.tz</span>
        <span>+255 778 775 044</span>
      </footer>
    </article>
  );
};

export default PrintableInvoice;
