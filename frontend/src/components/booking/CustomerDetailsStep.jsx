import CustomerStep from "./CustomerStep";

const CustomerDetailsStep = ({ customer, setCustomer, pickupPlaces = [], pickupInfo = "", countries = [], loading = false, onBack, onNext }) => (
  <div className="checkout-customer-step-wrap">
    <CustomerStep
      customer={customer}
      setCustomer={setCustomer}
      pickupPlaces={pickupPlaces}
      pickupInfo={pickupInfo}
      countries={countries}
      loading={loading}
      onBack={onBack}
      onNext={onNext}
    />
  </div>
);

export default CustomerDetailsStep;
