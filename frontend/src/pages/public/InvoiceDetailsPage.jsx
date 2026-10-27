import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LuChevronLeft, LuDownload, LuPrinter, LuShare } from "react-icons/lu";
import { emailInvoiceCopy, fetchMyBookingInvoice, openWithPaymentKey, requestInvoicePdfLink } from "../../api/myBookingApi";
import { refreshBookingSession } from "../../components/myBooking/useBookingSession";
import InvoiceSheet from "../../components/invoice/doc/InvoiceSheet";
import InvoiceMobile from "../../components/invoice/doc/InvoiceMobile";
import { documentTitle } from "../../components/invoice/doc/invoiceFormat";
import useMediaQuery from "../../hooks/useMediaQuery";
import Toast from "../../components/myBooking/Toast";
import "../../components/myBooking/myBooking.css";
import "../../components/invoice/doc/invoiceDoc.css";

const lookupHref = (reference) => `/my-booking?ref=${encodeURIComponent(reference)}`;

// A PDF from the 10-minute signed link (same origin, with this session's cookie).
const downloadFrom = (url, filename) => {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const InvoiceSkeleton = () => (
  <div className="ivd-desk" aria-busy="true">
    <p className="ivd-visually-hidden" role="status">Loading your invoice…</p>
    <div className="ivd-sheet ivd-sheet-skeleton" aria-hidden="true">
      {[70, 40, 100, 60, 100, 80].map((width, index) => (
        <span key={index} className="ivd-skel" style={{ width: `${width}%`, height: index === 2 || index === 4 ? 56 : 18 }} />
      ))}
    </div>
  </div>
);

// /invoice/:reference (mockups "Invoice" and "InvoiceMobile"): only with the My booking session of this booking
// (or the payment link key, which signs this device in first). Otherwise: the lookup form.
const InvoiceDetailsPage = () => {
  const { bookingReference = "" } = useParams();
  const reference = bookingReference.toUpperCase();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const key = String(params.get("key") || "").trim();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const [views, setViews] = useState(null);
  const [selected, setSelected] = useState("");
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef(0);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (key) {
          await openWithPaymentKey(reference, key).catch(() => null);
          await refreshBookingSession();
          navigate(`/invoice/${encodeURIComponent(reference)}`, { replace: true });
          return;
        }
        const data = await fetchMyBookingInvoice(reference);
        if (!active) return;
        setViews(data);
        setState("ready");
      } catch (error) {
        if (active) setState(error.status === 404 && error.code !== "INVOICE_NOT_FOUND" ? "denied" : error.code === "INVOICE_NOT_FOUND" ? "missing" : "error");
      }
    })();
    return () => {
      active = false;
    };
  }, [reference, key, navigate]);

  if (state === "denied") return <Navigate to={lookupHref(reference)} replace />;
  if (state === "loading" || key) return <InvoiceSkeleton />;
  if (state !== "ready") {
    return (
      <div className="ivd-desk">
        <div className="ivd-message" role="alert">
          <h1>{state === "missing" ? "Your invoice is not ready yet" : "We couldn't load your invoice"}</h1>
          <p>{state === "missing" ? "It is issued once your payment is confirmed." : "Please try again in a moment."}</p>
          <Link className="ivd-btn ivd-btn-primary" to={`/my-booking/${encodeURIComponent(reference)}`}>Back to my booking</Link>
        </div>
      </div>
    );
  }

  const doc = (selected && views.creditNotes.find((note) => note.number === selected)) || views.invoice;
  const backHref = `/my-booking/${encodeURIComponent(reference)}`;

  const download = async () => {
    setBusy("download");
    try {
      const link = await requestInvoicePdfLink(reference, doc.number);
      downloadFrom(link.url, link.filename);
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy("");
    }
  };

  const emailCopy = async () => {
    setBusy("email");
    try {
      const result = await emailInvoiceCopy(reference);
      showToast(result.message);
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy("");
    }
  };

  // Shares the PDF file where the browser can; otherwise downloads it.
  const share = async () => {
    try {
      const link = await requestInvoicePdfLink(reference, doc.number);
      const blob = await (await fetch(link.url, { credentials: "same-origin" })).blob();
      const file = new File([blob], link.filename, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${documentTitle(doc)} ${doc.number}` });
      else downloadFrom(link.url, link.filename);
    } catch (error) {
      if (error?.name !== "AbortError" && error?.message) showToast(error.message);
    }
  };

  const others = [views.invoice, ...views.creditNotes].filter((item) => item.number !== doc.number);
  const documentSwitch = others.length ? (
    <nav className="ivd-docs" aria-label="Related documents">
      <span>Also on this booking:</span>
      {others.map((item) => (
        <button key={item.number} type="button" onClick={() => setSelected(item.kind === "credit_note" ? item.number : "")}>
          {documentTitle(item)} {item.number}
        </button>
      ))}
    </nav>
  ) : null;

  if (isPhone) {
    return (
      <div className="ivd-phone">
        <header className="ivm-bar">
          <Link to={backHref} aria-label="Back to my booking" className="ivm-icon">
            <LuChevronLeft aria-hidden="true" />
          </Link>
          <strong>{documentTitle(doc)}</strong>
          <button type="button" className="ivm-icon" aria-label="Share PDF" onClick={share}>
            <LuShare aria-hidden="true" />
          </button>
        </header>
        <InvoiceMobile
          doc={doc}
          actions={
            <div className="ivm-actions">
              {documentSwitch}
              <button type="button" className="ivd-btn ivd-btn-primary" onClick={download} disabled={busy === "download"}>
                {busy === "download" ? "Preparing…" : "Download PDF"}
              </button>
              {doc.kind !== "credit_note" ? (
                <button type="button" className="ivd-btn ivd-btn-outline" onClick={emailCopy} disabled={busy === "email"}>
                  {busy === "email" ? "Sending…" : "Email me a copy"}
                </button>
              ) : null}
            </div>
          }
        />
        <Toast message={toast} />
      </div>
    );
  }

  return (
    <div className="ivd-desk">
      <div className="ivd-toolbar-wrap">
        <div className="ivd-toolbar">
          <Link to={backHref} className="ivd-back">
            <LuChevronLeft aria-hidden="true" /> Back to my booking
          </Link>
          <p className="ivd-toolbar-title">
            {documentTitle(doc)} <strong>{doc.number}</strong>
          </p>
          <div className="ivd-toolbar-actions">
            <button type="button" className="ivd-btn ivd-btn-outline" onClick={() => window.print()}>
              <LuPrinter aria-hidden="true" /> Print
            </button>
            {doc.kind !== "credit_note" ? (
              <button type="button" className="ivd-btn ivd-btn-outline" onClick={emailCopy} disabled={busy === "email"}>
                {busy === "email" ? "Sending…" : "Email me a copy"}
              </button>
            ) : null}
            <button type="button" className="ivd-btn ivd-btn-primary" onClick={download} disabled={busy === "download"}>
              <LuDownload aria-hidden="true" /> {busy === "download" ? "Preparing…" : "Download PDF"}
            </button>
          </div>
        </div>
      </div>
      <InvoiceSheet doc={doc} />
      {documentSwitch}
      <Toast message={toast} />
    </div>
  );
};

export default InvoiceDetailsPage;
