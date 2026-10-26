import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { Container, Button } from "react-bootstrap";
import { BsPrinter } from "react-icons/bs";
import { fetchInvoiceByBookingReference } from "../../api/invoicesApi";
import { fetchMyBookingInvoice } from "../../api/myBookingApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import PrintableInvoice from "../../components/invoice/PrintableInvoice";

const InvoiceDetailsPage = () => {
  const { bookingReference } = useParams();
  const key = String(useSearchParams()[0].get("key") || "").trim();
  const [denied, setDenied] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        // The payment link key, or the guest's "My booking" session (same-origin cookie).
        const data = key ? await fetchInvoiceByBookingReference(bookingReference, { key }) : await fetchMyBookingInvoice(bookingReference);
        setInvoice(data);
      } catch (err) {
        if (err.status === 404 && err.code !== "INVOICE_NOT_FOUND") setDenied(true);
        else setError(err.message || "Failed to fetch invoice");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bookingReference, key]);

  if (denied) return <Navigate to={`/my-booking?ref=${encodeURIComponent(bookingReference)}`} replace />;

  return (
    <main className="invoice-page">
      <Container className="invoice-shell">
        {loading ? <Loader message="Loading invoice..." /> : null}
        <ErrorAlert error={error} />
        {invoice ? (
          <>
            <div className="invoice-toolbar">
              <div>
                <span>Invoice</span>
                <strong>{invoice.invoiceNumber}</strong>
              </div>
              <Button variant="outline-info" onClick={() => window.print()}>
                <BsPrinter /> Print Invoice
              </Button>
            </div>
            <PrintableInvoice invoice={invoice} />
          </>
        ) : null}
      </Container>
    </main>
  );
};

export default InvoiceDetailsPage;
