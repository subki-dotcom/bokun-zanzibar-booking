import Table from "react-bootstrap/Table";
import { formatCurrency, formatDate } from "../../utils/formatters";

const PrintableInvoice = ({ invoice }) => {
  if (!invoice) {
    return null;
  }

  return (
    <div className="invoice-paper">
      <div className="d-flex justify-content-between align-items-start mb-4">
        <div>
          <h3 className="mb-1">Invoice</h3>
          <div className="text-muted">{invoice.invoiceNumber}</div>
        </div>
        <div className="text-end">
          <div className="fw-semibold">Zanzibar Premium Experiences</div>
          <small className="text-muted">Stone Town, Zanzibar</small>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-md-6">
          <small className="text-muted d-block">Client</small>
          <div>{invoice.clientName}</div>
          <div>{invoice.clientEmail}</div>
          <div>{invoice.clientPhone}</div>
        </div>
        <div className="col-md-6 text-md-end">
          <small className="text-muted d-block">Issue Date</small>
          <div>{formatDate(invoice.issueDate)}</div>
          <small className="text-muted d-block mt-2">Booking Ref</small>
          <div>{invoice.bookingReference}</div>
        </div>
      </div>

      <Table responsive>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th className="text-end">Unit</th>
            <th className="text-end">Total</th>
          </tr>
        </thead>
        <tbody>
          {(invoice.items || []).map((item, index) => (
            <tr key={item.label + index}>
              <td>{item.label}</td>
              <td>{item.quantity}</td>
              <td className="text-end">{formatCurrency(item.unitPrice, "USD")}</td>
              <td className="text-end">{formatCurrency(item.total, "USD")}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <div className="d-flex justify-content-end">
        <div style={{ width: 320 }}>
          <div className="d-flex justify-content-between mb-1">
            <span>Subtotal</span>
            <span>{formatCurrency(invoice.subtotal, "USD")}</span>
          </div>
          <div className="d-flex justify-content-between mb-1">
            <span>Discount</span>
            <span>-{formatCurrency(invoice.discount, "USD")}</span>
          </div>
          <div className="d-flex justify-content-between mb-1">
            <span>Tax</span>
            <span>{formatCurrency(invoice.tax, "USD")}</span>
          </div>
          <div className="d-flex justify-content-between fw-semibold fs-5">
            <span>Total</span>
            <span>{formatCurrency(invoice.total, "USD")}</span>
          </div>
          <div className="d-flex justify-content-between text-success mt-1">
            <span>Amount Paid</span>
            <span>{formatCurrency(invoice.amountPaid, "USD")}</span>
          </div>
          <div className="d-flex justify-content-between text-danger">
            <span>Balance Due</span>
            <span>{formatCurrency(invoice.balanceDue, "USD")}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintableInvoice;