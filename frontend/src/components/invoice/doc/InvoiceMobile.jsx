// The invoice on phones (mockup "InvoiceMobile"): cards instead of the A4 sheet. Same data as the sheet.
import BrandMark from "../../common/BrandMark";
import { StatusStamp } from "./InvoiceSheet";
import { amountCell, docDate, mobileItemLine, money, paymentMethodLine } from "./invoiceFormat";

const InvoiceMobile = ({ doc, actions }) => {
  const amount = amountCell(doc);
  const credit = doc.kind === "credit_note";
  const payment = doc.payments?.[0];
  return (
    <div className="ivm" aria-label={`${credit ? "Credit note" : "Invoice"} ${doc.number}`}>
      <section className="ivm-card ivm-head">
        <div className="ivm-head-top">
          <span className="ivd-logo brand-mark-slot">
            <BrandMark size="100%" title={`${doc.company?.name || ""} logo`} />
          </span>
          <span className="ivm-brand">
            <strong>{doc.company?.name}</strong>
            {doc.company?.tin ? <small>TIN: {doc.company.tin}</small> : null}
          </span>
          <StatusStamp status={doc.status} />
        </div>
        <h1>{credit ? "CREDIT NOTE" : "INVOICE"}</h1>
        <p className="ivm-number">
          {doc.number} · Issued {docDate(doc.issueDate)}
        </p>
        <dl className={`ivm-amount ${amount.due ? "is-due" : ""}`.trim()}>
          <dt>{amount.label}</dt>
          <dd>{money(credit ? doc.total : amount.due ? doc.balanceDue : doc.amountPaid, doc.currency)}</dd>
        </dl>
        <dl className="ivm-meta">
          <div>
            <dt>Booking ref</dt>
            <dd>{doc.bookingReference}</dd>
          </div>
          <div>
            <dt>{credit ? "Invoice" : "Paid on"}</dt>
            <dd>{credit ? doc.creditFor : doc.paymentDate ? docDate(doc.paymentDate) : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="ivm-card" aria-labelledby="ivm-billed">
        <h2 id="ivm-billed" className="ivd-eyebrow">Billed to</h2>
        <p className="ivm-strong">{doc.billedTo?.name || "—"}</p>
        <p className="ivm-muted">{[doc.billedTo?.email, doc.billedTo?.country].filter(Boolean).join(" · ")}</p>
      </section>

      <section className="ivm-card" aria-labelledby="ivm-items">
        <h2 id="ivm-items" className="ivd-eyebrow">Items</h2>
        <ul className="ivm-items">
          {(doc.lineItems || []).map((item, index) =>
            item.subDescription ? (
              <li key={index}>
                <div className="ivm-row">
                  <strong>{item.description}</strong>
                  <strong>{money(item.amount, doc.currency)}</strong>
                </div>
                <p className="ivm-muted">{item.subDescription.split(" · ")[0]}</p>
                <p className="ivm-muted">{credit ? docDate(item.date) : mobileItemLine(doc, item)}</p>
              </li>
            ) : (
              <li key={index} className="ivm-row ivm-plain">
                <span>{item.description}</span>
                <span>{item.included ? "Included" : money(item.amount, doc.currency)}</span>
              </li>
            )
          )}
        </ul>
        <dl className="ivm-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(doc.subtotal, doc.currency)}</dd>
          </div>
          {doc.discount ? (
            <div>
              <dt>Discount</dt>
              <dd>− {money(doc.discount, doc.currency)}</dd>
            </div>
          ) : null}
          {doc.tax ? (
            <div>
              <dt>
                {doc.tax.label} {doc.tax.rate}%
              </dt>
              <dd>{money(doc.tax.amount, doc.currency)}</dd>
            </div>
          ) : null}
          <div className="is-total">
            <dt>{credit ? "Total credited" : "Total"}</dt>
            <dd>
              {money(doc.total, doc.currency)} {doc.currency}
            </dd>
          </div>
          {!credit ? (
            <div className={`is-balance ${doc.balanceDue > 0 ? "is-due" : ""}`.trim()}>
              <dt>Balance due</dt>
              <dd>{money(doc.balanceDue, doc.currency)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {!credit ? (
        <section className="ivm-card" aria-labelledby="ivm-payment">
          <h2 id="ivm-payment" className="ivd-eyebrow">Payment</h2>
          {payment ? (
            <>
              <p>{paymentMethodLine(payment)}</p>
              {payment.transactionId ? <p className="ivm-muted">Transaction ID: {payment.transactionId}</p> : null}
            </>
          ) : (
            <p className="ivm-muted">No payment received yet.</p>
          )}
        </section>
      ) : null}

      {actions}

      <p className="ivm-note">
        Computer-generated {credit ? "credit note" : "invoice"} · No signature required
        <br />
        Questions? WhatsApp {doc.company?.phone}
      </p>
    </div>
  );
};

export default InvoiceMobile;
