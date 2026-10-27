import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LuChevronLeft, LuDownload, LuPrinter } from "react-icons/lu";
import { fetchInvoiceDocument, fetchInvoicePdfBlob } from "../../api/invoicesApi";
import { BRAND } from "../../config/brand";
import InvoiceSheet from "../../components/invoice/doc/InvoiceSheet";
import { documentTitle } from "../../components/invoice/doc/invoiceFormat";
import { InvoiceSkeleton } from "../public/InvoiceDetailsPage";
import "../../components/invoice/doc/invoiceDoc.css";

// Staff: any invoice or credit note exactly as the guest sees it, with its PDF (role-checked on the server).
const AdminInvoiceDocumentPage = () => {
  const { invoiceNumber = "" } = useParams();
  const [views, setViews] = useState(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchInvoiceDocument(invoiceNumber)
      .then((data) => {
        if (!active) return;
        setViews(data);
        if (/^CN-/i.test(invoiceNumber)) setSelected(invoiceNumber.toUpperCase());
      })
      .catch((err) => active && setError(err.message || "Invoice not found"));
    return () => {
      active = false;
    };
  }, [invoiceNumber]);

  if (error) {
    return (
      <div className="ivd-desk">
        <div className="ivd-message" role="alert">
          <h1>Invoice not available</h1>
          <p>{error}</p>
          <Link className="ivd-btn ivd-btn-primary" to="/admin/booking-accounting/invoices">Back to invoices</Link>
        </div>
      </div>
    );
  }
  if (!views) return <InvoiceSkeleton />;

  const doc = (selected && views.creditNotes.find((note) => note.number === selected)) || views.invoice;
  const download = async () => {
    setBusy(true);
    try {
      const blob = await fetchInvoicePdfBlob(views.invoice.number, doc.kind === "credit_note" ? doc.number : "");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${BRAND.filePrefix}-${doc.kind === "credit_note" ? "CreditNote" : "Invoice"}-${doc.number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err.message || "The PDF could not be made");
    } finally {
      setBusy(false);
    }
  };
  const others = [views.invoice, ...views.creditNotes].filter((item) => item.number !== doc.number);

  return (
    <div className="ivd-desk">
      <div className="ivd-toolbar-wrap">
        <div className="ivd-toolbar">
          <Link to="/admin/booking-accounting/invoices" className="ivd-back">
            <LuChevronLeft aria-hidden="true" /> Back to invoices
          </Link>
          <p className="ivd-toolbar-title">
            {documentTitle(doc)} <strong>{doc.number}</strong>
          </p>
          <div className="ivd-toolbar-actions">
            <button type="button" className="ivd-btn ivd-btn-outline" onClick={() => window.print()}>
              <LuPrinter aria-hidden="true" /> Print
            </button>
            <button type="button" className="ivd-btn ivd-btn-primary" onClick={download} disabled={busy}>
              <LuDownload aria-hidden="true" /> {busy ? "Preparing…" : "Download PDF"}
            </button>
          </div>
        </div>
      </div>
      <InvoiceSheet doc={doc} />
      {others.length ? (
        <nav className="ivd-docs" aria-label="Related documents">
          <span>Also on this booking:</span>
          {others.map((item) => (
            <button key={item.number} type="button" onClick={() => setSelected(item.kind === "credit_note" ? item.number : "")}>
              {documentTitle(item)} {item.number}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
};

export default AdminInvoiceDocumentPage;
