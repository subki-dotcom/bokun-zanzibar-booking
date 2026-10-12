import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Container, Button } from "react-bootstrap";
import { BsPrinter } from "react-icons/bs";
import { fetchInvoiceByBookingReference } from "../../api/invoicesApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import BookingAccessForm, { isBookingAccessError } from "../../components/booking/BookingAccessForm";
import PrintableInvoice from "../../components/invoice/PrintableInvoice";

const InvoiceDetailsPage = () => {
  const { bookingReference } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsAccess, setNeedsAccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      setNeedsAccess(false);
      try {
        const data = await fetchInvoiceByBookingReference(bookingReference);
        setInvoice(data);
      } catch (err) {
        if (isBookingAccessError(err)) setNeedsAccess(true);
        else setError(err.message || "Failed to fetch invoice");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bookingReference]);

  return (
    <main className="invoice-page">
      <Container className="invoice-shell">
        {loading ? <Loader message="Loading invoice..." /> : null}
        <ErrorAlert error={error} />
        {needsAccess ? <BookingAccessForm reference={bookingReference} title="Verify to view your invoice" /> : null}
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
