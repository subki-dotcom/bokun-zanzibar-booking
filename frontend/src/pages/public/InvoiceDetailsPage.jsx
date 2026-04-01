import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Container, Button } from "react-bootstrap";
import { fetchInvoiceByBookingReference } from "../../api/invoicesApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import PrintableInvoice from "../../components/invoice/PrintableInvoice";

const InvoiceDetailsPage = () => {
  const { bookingReference } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchInvoiceByBookingReference(bookingReference);
        setInvoice(data);
      } catch (err) {
        setError(err.message || "Failed to fetch invoice");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bookingReference]);

  return (
    <Container className="py-4">
      {loading ? <Loader message="Loading invoice..." /> : null}
      <ErrorAlert error={error} />
      {invoice ? (
        <>
          <div className="d-flex justify-content-end mb-3">
            <Button variant="outline-info" onClick={() => window.print()}>
              Print Invoice
            </Button>
          </div>
          <PrintableInvoice invoice={invoice} />
        </>
      ) : null}
    </Container>
  );
};

export default InvoiceDetailsPage;