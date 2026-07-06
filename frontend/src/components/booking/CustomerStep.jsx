import { useEffect } from "react";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import { applyDialCodeToPhone, getDialCodeFromCountries, resolveDefaultCountryCode } from "../../utils/phoneCodes";

const formatPickupPlaceLabel = (place = {}) =>
  [place.title, place.address]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");

const CustomerStep = ({ customer, setCustomer, pickupPlaces = [], pickupInfo = "", countries = [], onBack, onNext }) => {
  const updateCustomer = (field, value) => {
    setCustomer((prev) => ({ ...prev, [field]: value }));
  };

  const isValid = customer.firstName && customer.lastName && customer.email && customer.phone;
  const hasPickupPlaces = Array.isArray(pickupPlaces) && pickupPlaces.length > 0;
  const hasPickupInfo = Boolean(String(pickupInfo || "").trim());
  const hasCountries = Array.isArray(countries) && countries.length > 0;
  const selectedDialCode = getDialCodeFromCountries(customer.country, countries);

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
      pickupPlaceId: selectedPlace?.id ? String(selectedPlace.id) : ""
    }));
  };

  return (
    <Card className="surface-card">
      <Card.Body>
        <h4 className="mb-3">Customer Details</h4>
        <div className="row g-3">
          <div className="col-md-6">
            <Form.Label>First name</Form.Label>
            <Form.Control value={customer.firstName} onChange={(e) => updateCustomer("firstName", e.target.value)} />
          </div>
          <div className="col-md-6">
            <Form.Label>Last name</Form.Label>
            <Form.Control value={customer.lastName} onChange={(e) => updateCustomer("lastName", e.target.value)} />
          </div>
          <div className="col-md-6">
            <Form.Label>Email</Form.Label>
            <Form.Control type="email" value={customer.email} onChange={(e) => updateCustomer("email", e.target.value)} />
          </div>
          <div className="col-md-6">
            <Form.Label>Phone</Form.Label>
            <Form.Control
              value={customer.phone}
              placeholder={selectedDialCode ? `${selectedDialCode}778000000` : "Phone number"}
              onChange={(e) => updateCustomer("phone", applyDialCodeToPhone(e.target.value, customer.country, countries))}
            />
          </div>
          <div className="col-md-6">
            <Form.Label>Country</Form.Label>
            {hasCountries ? (
              <Form.Select value={customer.country} onChange={(e) => updateCountry(e.target.value)}>
                <option value="">Select country</option>
                {countries.map((country) => (
                  <option key={country.code || country.title} value={country.code}>
                    {country.label || `${country.title} (${country.code})`}
                  </option>
                ))}
              </Form.Select>
            ) : (
              <Form.Control value={customer.country} onChange={(e) => updateCustomer("country", e.target.value)} />
            )}
          </div>
          <div className="col-md-6">
            <Form.Label>Pickup hotel</Form.Label>
            {hasPickupPlaces ? (
              <>
                <Form.Select value={customer.hotelName} onChange={(e) => updatePickupHotel(e.target.value)}>
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
                  value={customer.hotelName}
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
          </div>
          <div className="col-12">
            <Form.Label>Special request</Form.Label>
            <Form.Control as="textarea" rows={2} value={customer.notes} onChange={(e) => updateCustomer("notes", e.target.value)} />
          </div>
        </div>

        <div className="checkout-action-row mt-4">
          <Button variant="outline-secondary" onClick={onBack}>
            Back
          </Button>
          <Button className="premium-btn text-white" onClick={onNext} disabled={!isValid}>
            Continue
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default CustomerStep;
