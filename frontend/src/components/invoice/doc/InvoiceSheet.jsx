// The A4 invoice / credit note sheet (mockup "Invoice"): 794 px wide = A4 at 96 dpi, the same layout as the PDF.
import { amountCell, companyLines, docDate, docDateTime, money, paymentMethodLine, tripWhen } from "./invoiceFormat";

export const StatusStamp = ({ status }) =>
  status?.label ? (
    <p className={`ivd-stamp is-${status.tone}${status.label.length > 5 ? " is-long" : ""}`}>
      <span className="ivd-visually-hidden">Status: </span>
      {status.label}
    </p>
  ) : null;

const InvoiceHeader = ({ doc }) => (
  <header className="ivd-head">
    <div>
      <div className="ivd-brand">
        <span className="ivd-logo" role="img" aria-label={`${doc.company?.name || ""} logo`}>
          {(doc.company?.name || "R").charAt(0)}
        </span>
        <span>
          <strong>{doc.company?.name}</strong>
          <small>{doc.company?.tagline}</small>
        </span>
      </div>
      <address className="ivd-company">
        {companyLines(doc.company).map((line) => (
          <span key={line}>{line}</span>
        ))}
      </address>
    </div>
    <div className="ivd-title">
      <h1>{doc.kind === "credit_note" ? "CREDIT NOTE" : "INVOICE"}</h1>
      <p>{doc.number}</p>
      {doc.creditFor ? <p>for invoice {doc.creditFor}</p> : null}
      <StatusStamp status={doc.status} />
    </div>
  </header>
);

const MetaStrip = ({ doc }) => {
  const last = amountCell(doc);
  const cells =
    doc.kind === "credit_note"
      ? [["Issue date", docDate(doc.issueDate)], ["Booking reference", doc.bookingReference], ["Original invoice", doc.creditFor || "—"]]
      : [["Issue date", docDate(doc.issueDate)], ["Booking reference", doc.bookingReference], ["Payment date", doc.paymentDate ? docDate(doc.paymentDate) : "—"]];
  return (
    <dl className="ivd-meta">
      {cells.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <div className={`is-amount ${last.due ? "is-due" : ""}`.trim()}>
        <dt>{last.label}</dt>
        <dd>{last.value}</dd>
      </div>
    </dl>
  );
};

const PartyBlocks = ({ doc }) => (
  <div className="ivd-parties">
    <section aria-labelledby="ivd-billed">
      <h2 id="ivd-billed" className="ivd-eyebrow">Billed to</h2>
      <p className="ivd-party-name">{doc.billedTo?.name || "—"}</p>
      {[doc.billedTo?.email, doc.billedTo?.phone, doc.billedTo?.country, doc.billedTo?.company, doc.billedTo?.taxId ? `VAT/TIN: ${doc.billedTo.taxId}` : ""]
        .filter(Boolean)
        .map((line) => (
          <p key={line}>{line}</p>
        ))}
    </section>
    <section aria-labelledby="ivd-trip">
      <h2 id="ivd-trip" className="ivd-eyebrow">Trip</h2>
      <p className="ivd-party-name">{doc.trip?.tour || "—"}</p>
      {doc.trip?.option ? <p>{doc.trip.option}</p> : null}
      {tripWhen(doc.trip) ? <p>{tripWhen(doc.trip)}</p> : null}
      {doc.trip?.pickup ? <p>Pickup: {doc.trip.pickup}</p> : null}
    </section>
  </div>
);

const LineItemsTable = ({ doc }) => (
  <table className="ivd-table">
    <caption className="ivd-visually-hidden">{doc.kind === "credit_note" ? "Credited items" : "Invoice items"}</caption>
    <thead>
      <tr>
        <th scope="col">Description</th>
        <th scope="col">Date</th>
        <th scope="col" className="is-center">Qty</th>
        <th scope="col" className="is-right">Unit price</th>
        <th scope="col" className="is-right">Amount</th>
      </tr>
    </thead>
    <tbody>
      {(doc.lineItems || []).map((item, index) => (
        <tr key={`${item.description}-${index}`} className={item.subDescription ? "" : "is-plain"}>
          <th scope="row">
            <span className="ivd-item-title">{item.description}</span>
            {item.subDescription ? <span className="ivd-item-sub">{item.subDescription}</span> : null}
          </th>
          <td>{item.date ? docDate(item.date) : "—"}</td>
          <td className="is-center">{item.qty}</td>
          <td className="is-right">{item.included ? "Included" : money(item.unitPrice, doc.currency)}</td>
          <td className="is-right">{money(item.amount, doc.currency)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const VerifyQr = ({ doc }) =>
  doc.verificationUrl ? (
    <div className="ivd-verify">
      {doc.verificationQr ? <img src={doc.verificationQr} alt={`QR code to verify ${doc.number}`} width="80" height="80" /> : null}
      <p>
        Scan to verify this {doc.kind === "credit_note" ? "credit note" : "invoice"}
        <br />
        or visit <a href={doc.verificationUrl}>{doc.verificationUrl.replace(/^https?:\/\//, "")}</a>
      </p>
    </div>
  ) : (
    <div />
  );

const TotalsBlock = ({ doc }) => {
  const credit = doc.kind === "credit_note";
  return (
    <dl className="ivd-totals">
      <div>
        <dt>Subtotal</dt>
        <dd>{money(doc.subtotal, doc.currency)}</dd>
      </div>
      <div>
        <dt>Discount</dt>
        <dd>{doc.discount ? `− ${money(doc.discount, doc.currency)}` : money(0, doc.currency)}</dd>
      </div>
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
        <>
          <div>
            <dt>Amount paid</dt>
            <dd>− {money(doc.amountPaid, doc.currency)}</dd>
          </div>
          {doc.amountRefunded > 0 ? (
            <div>
              <dt>Refunded</dt>
              <dd>+ {money(doc.amountRefunded, doc.currency)}</dd>
            </div>
          ) : null}
          <div className={`is-balance ${doc.balanceDue > 0 ? "is-due" : ""}`.trim()}>
            <dt>Balance due</dt>
            <dd>{money(doc.balanceDue, doc.currency)}</dd>
          </div>
        </>
      ) : null}
    </dl>
  );
};

const InfoBoxes = ({ doc }) => {
  const payment = doc.payments?.[0];
  return (
    <div className="ivd-info">
      <section aria-labelledby="ivd-payment">
        <h2 id="ivd-payment" className="ivd-eyebrow">{doc.kind === "credit_note" ? "Refund" : "Payment"}</h2>
        {doc.kind === "credit_note" ? (
          <>
            <p>Refund to the original payment method</p>
            <p>Booking {doc.bookingReference}</p>
          </>
        ) : payment ? (
          <>
            <p>{paymentMethodLine(payment)}</p>
            {payment.transactionId ? <p>Transaction ID: {payment.transactionId}</p> : null}
            {payment.paidAt ? <p>Paid on {docDateTime(payment.paidAt)}</p> : null}
          </>
        ) : (
          <p>No payment received yet.</p>
        )}
      </section>
      <section aria-labelledby="ivd-policy">
        <h2 id="ivd-policy" className="ivd-eyebrow">Cancellation policy</h2>
        <p>{doc.cancellationPolicyText}</p>
      </section>
    </div>
  );
};

const InvoiceFooter = ({ doc }) => (
  <footer className="ivd-foot">
    <div>
      <strong>Asante sana – thank you for booking with us!</strong>
      <span>
        Questions? WhatsApp {doc.company?.phone} · {doc.company?.email}
      </span>
    </div>
    <div className="is-right">
      <span>Computer-generated {doc.kind === "credit_note" ? "credit note" : "invoice"}</span>
      <span>No signature required · Page 1 of 1</span>
    </div>
  </footer>
);

const InvoiceSheet = ({ doc }) => (
  <article className="ivd-sheet" aria-label={`${doc.kind === "credit_note" ? "Credit note" : "Invoice"} ${doc.number}`}>
    <InvoiceHeader doc={doc} />
    <MetaStrip doc={doc} />
    <PartyBlocks doc={doc} />
    <LineItemsTable doc={doc} />
    <div className="ivd-bottom">
      <VerifyQr doc={doc} />
      <TotalsBlock doc={doc} />
    </div>
    <InfoBoxes doc={doc} />
    <InvoiceFooter doc={doc} />
  </article>
);

export default InvoiceSheet;
