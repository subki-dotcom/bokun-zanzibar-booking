import CustomerStep from "./CustomerStep";

const CustomerDetailsStep = ({
  customer,
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
}) => (
  <div className="checkout-customer-step-wrap">
    <CustomerStep
      customer={customer}
      setCustomer={setCustomer}
      pickupPlaces={pickupPlaces}
      pickupInfo={pickupInfo}
      countries={countries}
      questions={questions}
      answers={answers}
      setAnswers={setAnswers}
      loading={loading}
      onBack={onBack}
      onNext={onNext}
    />
  </div>
);

export default CustomerDetailsStep;
