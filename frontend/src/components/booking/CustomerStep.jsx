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

const normalizeQuestionScope = (value = "") => {
  const token = String(value || "booking").toLowerCase();
  if (token.includes("pickup")) return "pickup";
  if (token.includes("passenger") || token.includes("participant")) return "passenger";
  return "booking";
};

const answerFromCustomer = (question = {}, customer = {}) => {
  const token = `${question.label || ""} ${question.help || ""} ${question.placeholder || ""}`.toLowerCase();

  if (/pickup|hotel|accommodation|meeting point/.test(token)) return customer.hotelName;
  if (/first\s*name|given\s*name/.test(token)) return customer.firstName;
  if (/last\s*name|family\s*name|surname/.test(token)) return customer.lastName;
  if (/full\s*name|customer\s*name/.test(token)) return [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  if (/e-?mail/.test(token)) return customer.email;
  if (/phone|mobile|whatsapp|telephone/.test(token)) return customer.phone;
  if (/country|nationality/.test(token)) return customer.country;
  if (/special request|comment|note/.test(token)) return customer.notes;

  return "";
};

const isCustomerManagedQuestion = (question = {}) => {
  const token = `${question.label || ""} ${question.help || ""} ${question.placeholder || ""}`.toLowerCase();
  return /pickup|hotel|accommodation|meeting point|first\s*name|given\s*name|last\s*name|family\s*name|surname|full\s*name|customer\s*name|e-?mail|phone|mobile|whatsapp|telephone|country|nationality|special request|comment|note/.test(token);
};

const CustomerStep = ({
  customer = {},
  setCustomer,
  pickupPlaces = [],
  pickupInfo = "",
  countries = [],
  questions = [],
  answers = [],
  setAnswers,
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
  const additionalQuestions = useMemo(
    () =>
      (Array.isArray(questions) ? questions : []).filter((question) => {
        const scope = normalizeQuestionScope(question.scope);
        if (!question?.required || scope === "passenger") return false;

        return !isCustomerManagedQuestion(question);
      }),
    [questions]
  );
  const answerForQuestion = (question = {}) =>
    (Array.isArray(answers) ? answers : []).find(
      (answer = {}) =>
        String(answer.questionId || "") === String(question.questionId || question.id || "") &&
        normalizeQuestionScope(answer.scope) === normalizeQuestionScope(question.scope)
    );
  const missingAdditionalQuestions = additionalQuestions
    .filter((question) => {
      const answer = answerForQuestion(question)?.answer;
      return Array.isArray(answer) ? answer.length === 0 : !String(answer || "").trim();
    })
    .map((question) => question.label || "Required tour information");
  const missingCustomerManagedQuestions = (Array.isArray(questions) ? questions : [])
    .filter((question) => question?.required && normalizeQuestionScope(question.scope) !== "passenger")
    .filter((question) => isCustomerManagedQuestion(question))
    .filter((question) => !String(answerFromCustomer(question, customer) || "").trim())
    .map((question) => question.label || "Required tour information");
  const missingFields = requiredFields
    .filter(([field]) => !String(customer[field] || "").trim())
    .map(([, label]) => label)
    .concat(missingAdditionalQuestions, missingCustomerManagedQuestions)
    .filter((label, index, all) => all.indexOf(label) === index);
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

  const updateAdditionalAnswer = (question, answer) => {
    const questionId = String(question.questionId || question.id || "");
    if (!questionId || typeof setAnswers !== "function") return;

    setAnswers((current = []) => {
      const next = Array.isArray(current) ? current.filter((item = {}) => {
        return !(
          String(item.questionId || "") === questionId &&
          normalizeQuestionScope(item.scope) === normalizeQuestionScope(question.scope)
        );
      }) : [];

      return [
        ...next,
        {
          questionId,
          label: question.label || "Additional information",
          scope: normalizeQuestionScope(question.scope),
          answer
        }
      ];
    });
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

          {additionalQuestions.length > 0 ? (
            <div className="customer-step-wide customer-additional-details" aria-live="polite">
              <h5>Additional information required for this tour</h5>
              {additionalQuestions.map((question) => {
                const questionId = String(question.questionId || question.id || "");
                const currentAnswer = answerForQuestion(question)?.answer || "";
                const isSelect = Boolean(question.selectFromOptions || (question.options || []).length > 0);
                const isTextarea = String(question.type || "").toLowerCase().includes("textarea");

                return (
                  <Form.Group key={`${question.scope || "booking"}-${questionId}`} className="customer-step-wide">
                    <Form.Label>{question.label || "Additional information"} <span>*</span></Form.Label>
                    {question.help ? <Form.Text className="text-muted d-block mb-1">{question.help}</Form.Text> : null}
                    {isSelect ? (
                      <Form.Select
                        value={currentAnswer}
                        onChange={(event) => updateAdditionalAnswer(question, event.target.value)}
                      >
                        <option value="">Select an option</option>
                        {(question.options || []).map((option) => (
                          <option key={option.value} value={option.value}>{option.label || option.value}</option>
                        ))}
                      </Form.Select>
                    ) : (
                      <Form.Control
                        as={isTextarea ? "textarea" : "input"}
                        rows={isTextarea ? 3 : undefined}
                        value={currentAnswer}
                        placeholder={question.placeholder || "Enter required information"}
                        onChange={(event) => updateAdditionalAnswer(question, event.target.value)}
                      />
                    )}
                  </Form.Group>
                );
              })}
            </div>
          ) : null}

          <Form.Group className="customer-step-wide customer-marketing-consent">
            <Form.Check
              type="checkbox"
              id="checkout-marketing-consent"
              checked={Boolean(customer.marketingConsent)}
              label="Send me Zanzibar travel updates and exclusive offers."
              onChange={(event) => updateCustomer("marketingConsent", event.target.checked)}
            />
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
