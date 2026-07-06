import { useEffect } from "react";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import { BsInfoCircle, BsLock, BsShieldCheck } from "react-icons/bs";
import { isCustomerSummaryValid } from "./CustomerSummaryCard";
import ConfirmActionRow from "./ConfirmActionRow";
import { formatCurrency } from "../../utils/formatters";
import { applyDialCodeToPhone, getDialCodeFromCountries, resolveDefaultCountryCode } from "../../utils/phoneCodes";

const formatPickupPlaceLabel = (place = {}) =>
  [place.title, place.address]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");

const toSafeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ReviewConfirmStep = ({
  flowState = {},
  submitting = false,
  onBack,
  onConfirm,
  onCustomerChange,
  pickupPlaces = [],
  pickupInfo = "",
  countries = []
}) => {
  const customer = flowState.customer || {};
  const customerValid = isCustomerSummaryValid(customer);
  const hasQuoteToken = Boolean(flowState?.quote?.quoteToken);
  const disableConfirm = !customerValid || !hasQuoteToken;
  const pricing = flowState?.quote?.pricing || {};
  const currency = pricing.currency || "USD";
  const subtotal = toSafeNumber(pricing.baseAmount);
  const finalPayable = toSafeNumber(pricing.finalPayable || pricing.grossAmount || subtotal);
  const bookingFee = Math.max(0, finalPayable - subtotal);
  const hasPickupPlaces = Array.isArray(pickupPlaces) && pickupPlaces.length > 0;
  const hasPickupInfo = Boolean(String(pickupInfo || "").trim());
  const hasCountries = Array.isArray(countries) && countries.length > 0;
  const selectedDialCode = getDialCodeFromCountries(customer.country, countries);

  useEffect(() => {
    if (!hasCountries || !onCustomerChange) {
      return;
    }

    if (!customer.country) {
      const defaultCountry = resolveDefaultCountryCode(countries, "TZ");
      if (defaultCountry) {
        onCustomerChange({
          ...customer,
          country: defaultCountry,
          phone: applyDialCodeToPhone(customer.phone, defaultCountry, countries)
        });
      }
      return;
    }

    if (!customer.phone && selectedDialCode) {
      onCustomerChange({
        ...customer,
        phone: applyDialCodeToPhone(customer.phone, customer.country, countries)
      });
    }
  }, [countries, customer, hasCountries, onCustomerChange, selectedDialCode]);

  const updateCustomer = (field, value) => {
    if (!onCustomerChange) return;
    onCustomerChange({ ...customer, [field]: value });
  };

  const updateCountry = (countryCode) => {
    if (!onCustomerChange) return;
    onCustomerChange({
      ...customer,
      country: countryCode,
      phone: applyDialCodeToPhone(customer.phone, countryCode, countries)
    });
  };

  const updatePickupHotel = (pickupLabel) => {
    if (!onCustomerChange) return;
    const selectedPlace = pickupPlaces.find((place) => formatPickupPlaceLabel(place) === pickupLabel);

    onCustomerChange({
      ...customer,
      hotelName: pickupLabel,
      pickupPlaceId: selectedPlace?.id ? String(selectedPlace.id) : ""
    });
  };

  return (
    <div className="checkout-review-stack">
      <Card className="surface-card smart-step-card review-confirm-main-card">
        <Card.Body>
          <div className="review-confirm-header">
            <h4 className="mb-1">Customer Details</h4>
            <p className="mb-0">Enter the primary contact information for this booking</p>
          </div>

          <div className="checkout-customer-grid mt-3">
            <Form.Group>
              <Form.Label>First Name <span>*</span></Form.Label>
              <Form.Control value={customer.firstName || ""} onChange={(e) => updateCustomer("firstName", e.target.value)} />
            </Form.Group>
            <Form.Group>
              <Form.Label>Last Name <span>*</span></Form.Label>
              <Form.Control value={customer.lastName || ""} onChange={(e) => updateCustomer("lastName", e.target.value)} />
            </Form.Group>
            <Form.Group>
              <Form.Label>Email Address <span>*</span></Form.Label>
              <Form.Control type="email" value={customer.email || ""} onChange={(e) => updateCustomer("email", e.target.value)} />
            </Form.Group>
            <Form.Group>
              <Form.Label>Phone Number <span>*</span></Form.Label>
              <Form.Control
                value={customer.phone || ""}
                placeholder={selectedDialCode ? `${selectedDialCode}778000000` : "Phone number"}
                onChange={(e) => updateCustomer("phone", applyDialCodeToPhone(e.target.value, customer.country, countries))}
              />
            </Form.Group>
            <Form.Group className="checkout-customer-wide">
              <Form.Label>Country</Form.Label>
              {hasCountries ? (
                <Form.Select value={customer.country || ""} onChange={(e) => updateCountry(e.target.value)}>
                  <option value="">Select country</option>
                  {countries.map((country) => (
                    <option key={country.code || country.title} value={country.code}>
                      {country.label || `${country.title} (${country.code})`}
                    </option>
                  ))}
                </Form.Select>
              ) : (
                <Form.Control value={customer.country || ""} onChange={(e) => updateCustomer("country", e.target.value)} />
              )}
            </Form.Group>
            <Form.Group className="checkout-customer-wide">
              <Form.Label>Pickup hotel</Form.Label>
              {hasPickupPlaces ? (
                <>
                  <Form.Select value={customer.hotelName || ""} onChange={(e) => updatePickupHotel(e.target.value)}>
                    <option value="">Select pickup hotel from Bokun</option>
                    {pickupPlaces.map((place) => {
                      const pickupLabel = formatPickupPlaceLabel(place);
                      return (
                        <option key={`${place.id || place.title}-${pickupLabel}`} value={pickupLabel}>
                          {pickupLabel}
                        </option>
                      );
                    })}
                  </Form.Select>
                  <div className="checkout-pickup-note is-loaded">
                    Pickup hotels loaded automatically.
                  </div>
                </>
              ) : (
                <>
                  <Form.Control
                    value={customer.hotelName || ""}
                    placeholder="Enter pickup hotel name"
                    onChange={(e) => updateCustomer("hotelName", e.target.value)}
                  />
                  <div className="checkout-pickup-note">
                    {hasPickupInfo
                      ? "Pickup is available. Enter your hotel name and we will confirm pickup details."
                      : "Enter your hotel name if pickup is needed."}
                  </div>
                </>
              )}
            </Form.Group>
            <Form.Group className="checkout-customer-wide">
              <div className="checkout-optional-label">
                <Form.Label>Special Requests / Notes</Form.Label>
                <small>Optional</small>
              </div>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Any special requests or additional information..."
                value={customer.notes || ""}
                onChange={(e) => updateCustomer("notes", e.target.value)}
              />
            </Form.Group>
          </div>
        </Card.Body>
      </Card>

      <Card className="surface-card smart-step-card checkout-payment-card">
        <Card.Body>
          <div className="review-confirm-header">
            <h4 className="mb-1">Payment Summary</h4>
            <p className="mb-0">Review the cost breakdown</p>
          </div>

          <div className="checkout-payment-lines">
            <div>
              <span>Subtotal</span>
              <strong>{formatCurrency(subtotal, currency)}</strong>
            </div>
            <div>
              <span>Booking Fee <BsInfoCircle /></span>
              <strong>{formatCurrency(bookingFee, currency)}</strong>
            </div>
            <div className="checkout-payment-total">
              <span>Total Payable</span>
              <strong>{formatCurrency(finalPayable, currency)}</strong>
            </div>
          </div>

          <div className="checkout-pay-note">
            <BsShieldCheck />
            <span>
              <strong>You will not be charged now</strong>
              <small>You can review all details before proceeding to secure payment.</small>
            </span>
          </div>

          <ConfirmActionRow
            submitting={submitting}
            disableConfirm={disableConfirm}
            confirmLabel="Confirm & Pay Secure Checkout"
            loadingLabel="Redirecting to Pesapal..."
            onBack={onBack}
            onConfirm={onConfirm}
            confirmIcon={<BsLock />}
          />
        </Card.Body>
      </Card>
    </div>
  );
};

export default ReviewConfirmStep;
