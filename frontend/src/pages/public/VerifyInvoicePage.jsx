import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LuCircleCheck, LuCircleX } from "react-icons/lu";
import { fetchInvoiceVerification } from "../../api/invoicesApi";
import { docDate, money } from "../../components/invoice/doc/invoiceFormat";
import "../../components/invoice/doc/invoiceDoc.css";

// /verify/:token – the "Scan to verify" page: company, number, date, total and status only (no personal data).
const VerifyInvoicePage = () => {
  const { token = "" } = useParams();
  const [result, setResult] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let active = true;
    fetchInvoiceVerification(token)
      .then((data) => {
        if (!active) return;
        setResult(data);
        setState("valid");
      })
      .catch((error) => active && setState(error.status === 404 ? "invalid" : "error"));
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="ivd-desk">
      <div className="ivd-message ivd-verify-card" aria-busy={state === "loading"}>
        {state === "loading" ? <p role="status">Checking…</p> : null}
        {state === "valid" ? (
          <>
            <p className="ivd-verify-ok">
              <LuCircleCheck aria-hidden="true" /> Valid {result.kind === "credit_note" ? "credit note" : "invoice"}
            </p>
            <h1>{result.company}</h1>
            <dl className="ivd-verify-list">
              <div>
                <dt>{result.kind === "credit_note" ? "Credit note" : "Invoice"} number</dt>
                <dd>{result.number}</dd>
              </div>
              <div>
                <dt>Issue date</dt>
                <dd>{docDate(result.issueDate)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>
                  {money(result.total, result.currency)} {result.currency}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{result.status}</dd>
              </div>
            </dl>
          </>
        ) : null}
        {state === "invalid" || state === "error" ? (
          <>
            <p className="ivd-verify-bad">
              <LuCircleX aria-hidden="true" /> {state === "invalid" ? "Not a valid invoice" : "We couldn't check this invoice"}
            </p>
            <p>{state === "invalid" ? "This code does not match an invoice we issued." : "Please try again in a moment."}</p>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default VerifyInvoicePage;
