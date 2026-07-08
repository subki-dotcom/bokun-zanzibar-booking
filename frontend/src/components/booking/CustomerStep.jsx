import { useEffect, useMemo, useState } from "react";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import { BsArrowLeft, BsArrowRight, BsInfoCircle } from "react-icons/bs";
import {
  applyDialCodeToPhone,
  countryCodeToFlagEmoji,
  getCountryFlagUrl,
  getDialCodeFromCountries,
  resolveDefaultCountryCode
} from "../../utils/phoneCodes";

const formatPickupPlaceLabel = (place = {}) =>
  [place.title, place.address]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");

const findCountry = (countryCode = "", countries = []) =>
  countries.find(
    (country = {}) => String(country.code || "").toUpperCase() === String(countryCode || "").toUpperCase()
  );

const CustomerStep = ({
  customer = {},
  setCustomer,
  pickupPlaces = [],
  pickupInfo = "",
  countries = [],
  loading = false,
  onBack,
  onNext
}) => {
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const updateCustomer = (field, value) => {
    setCustomer((prev) => ({ ...prev, [field]: value }));
  };

  const requiredFields = useMemo(
    () => [
      ["firstName", "First Name"],
      ["lastName", "Last Name"],
      ["email", "Email Address"],
      ["phone", "Phone Number"],
      ["country", "Country"]
    ],
    []
  );
  const missingFields = requiredFields
    .filter(([field]) => !String(customer[field] || "").trim())
    .map(([, label]) => label);
  const isValid = missingFields.length === 0;
  const hasPickupPlaces = Array.isArray(pickupPlaces) && pickupPlaces.length > 0;
  const hasPickupInfo = Boolean(String(pickupInfo || "").trim());
  const hasCountries = Array.isArray(countries) && countries.length > 0;
  const selectedDialCode = getDialCodeFromCountries(customer.country, countries);
  const selectedCountryCode = String(customer.country || "TZ").toUpperCase();
  const selectedCountry = findCountry(selectedCountryCode, countries);
  const selectedFlagUrl = getCountryFlagUrl(selectedCountryCode, 40);
  const notesValue = String(customer.notes || "");
  const notesCount = Math.min(250, notesValue.length);

  useEffect(() => {
    if (!hasCountries) {
      return;
    }

    if (!customer.country) {
      const defaultCountry = resolveDefaultCountryCode(countries, "TZ");
      if (defaultCountry) {
        setCustomer((prev) => ({
          ...prev,
          country: defaultCountry,
          phone: applyDialCodeToPhone(prev.phone, defaultCountry, countries)
        }));
      }
      return;
    }

    if (!customer.phone && selectedDialCode) {
      setCustomer((prev) => ({
        ...prev,
        phone: applyDialCodeToPhone(prev.phone, prev.country, countries)
      }));
    }
  }, [countries, customer.country, customer.phone, hasCountries, selectedDialCode, setCustomer]);

  const updateCountry = (countryCode) => {
    setCustomer((prev) => ({
      ...prev,
      country: countryCode,
      phone: applyDialCodeToPhone(prev.phone, countryCode, countries)
    }));
  };

  const updatePickupHotel = (pickupLabel) => {
    const selectedPlace = pickupPlaces.find((place) => formatPickupPlaceLabel(place) === pickupLabel);

    setCustomer((prev) => ({
      ...prev,
      hotelName: pickupLabel,
      pickupPlaceId: selectedPlace?.productScoped === false ? "" : selectedPlace?.id ? String(selectedPlace.id) : ""
    }));
  };

  const handleContinue = () => {
    setAttemptedSubmit(true);

    if (!isValid) {
      return;
    }

    onNext?.();
  };

  return (
    <Card className="surface-card smart-step-card customer-step-card">
      <Card.Body>
        <div className="customer-step-header">
          <h4>Customer Details</h4>
          <p>Enter the primary contact information for this booking</p>
        </div>

        <div className="customer-step-form-grid">
          <Form.Group>
            <Form.Label>First Name <span>*</span></Form.Label>
            <Form.Control
              value={customer.firstName || ""}
              placeholder="Subki"
              onChange={(e) => updateCustomer("firstName", e.target.value)}
            />
          </Form.Group>

          <Form.Group>
            <Form.Label>Last Name <span>*</span></Form.Label>
            <Form.Control
              value={customer.lastName || ""}
              placeholder="Subki"
              onChange={(e) => updateCustomer("lastName", e.target.value)}
            />
          </Form.Group>

          <Form.Group>
            <Form.Label>Email Address <span>*</span></Form.Label>
            <Form.Control
              type="email"
              value={customer.email || ""}
              placeholder="info@risertoursandsafaris.co.tz"
              onChange={(e) => updateCustomer("email", e.target.value)}
            />
          </Form.Group>

          <Form.Group>
            <Form.Label>Phone Number <span>*</span></Form.Label>
            <div className="checkout-phone-field customer-phone-field">
              <span className="checkout-phone-country" title={selectedCountry?.title || selectedCountryCode}>
                {selectedFlagUrl ? (
                  <img src={selectedFlagUrl} alt={`${selectedCountryCode} flag`} loading="lazy" />
                ) : (
                  <span className="checkout-phone-flag-fallback">{selectedCountryCode.slice(0, 2)}</span>
                )}
              </span>
              <Form.Control
                value={customer.phone || ""}
                placeholder={selectedDialCode ? `${selectedDialCode} 778 775 044` : "+255 778 775 044"}
                onChange={(e) => updateCustomer("phone", applyDialCodeToPhone(e.target.value, customer.country, countries))}
              />
            </div>
          </Form.Group>

          <Form.Group>
            <Form.Label>Country <span>*</span></Form.Label>
            {hasCountries ? (
              <Form.Select value={customer.country || ""} onChange={(e) => updateCountry(e.target.value)}>
                <option value="">Select country</option>
                {countries.map((country) => (
                  <option key={country.code || country.title} value={country.code}>
                    {[countryCodeToFlagEmoji(country.code), country.label || `${country.title} (${country.code})`]
                      .filter(Boolean)
                      .join(" ")}
                  </option>
                ))}
              </Form.Select>
            ) : (
              <Form.Control
                value={customer.country || ""}
                placeholder="Tanzania (TZ)"
                onChange={(e) => updateCustomer("country", e.target.value)}
              />
            )}
          </Form.Group>

          <Form.Group>
            <Form.Label>Pickup hotel</Form.Label>
            {hasPickupPlaces ? (
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
            ) : (
              <Form.Control
                value={customer.hotelName || ""}
                placeholder="Enter pickup hotel name"
                onChange={(e) => updateCustomer("hotelName", e.target.value)}
              />
            )}
            {!hasPickupPlaces ? (
              <div className="checkout-pickup-note customer-pickup-note">
                <BsInfoCircle />
                <span>Enter your hotel name if pickup is needed.</span>
              </div>
            ) : null}
          </Form.Group>

          <Form.Group className="customer-step-wide">
            <Form.Label>Special request</Form.Label>
            <div className="customer-notes-field">
              <Form.Control
                as="textarea"
                rows={3}
                maxLength={250}
                value={notesValue}
                placeholder="Any special requests or additional information..."
                onChange={(e) => updateCustomer("notes", e.target.value)}
              />
              <span>{notesCount}/250</span>
            </div>
          </Form.Group>
        </div>

        {attemptedSubmit && !isValid ? (
          <div className="customer-step-validation">
            Please complete: {missingFields.join(", ")}.
          </div>
        ) : null}

        <div className="customer-step-actions">
          <Button variant="outline-secondary" onClick={onBack} disabled={loading}>
            <BsArrowLeft /> Back
          </Button>
          <Button className="premium-btn text-white" onClick={handleContinue} disabled={loading}>
            {loading ? "Checking live price..." : "Continue"} {!loading ? <BsArrowRight /> : null}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default CustomerStep;
