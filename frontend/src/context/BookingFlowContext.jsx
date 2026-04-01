import { createContext, useCallback, useContext, useMemo, useState } from "react";

const BookingFlowContext = createContext(null);

const createDefaultData = () => ({
  selectedProduct: null,
  option: null,
  priceCatalogId: "",
  priceCatalog: null,
  travelDate: "",
  startTime: "",
  pax: { adults: 2, children: 0, infants: 0 },
  priceCategoryParticipants: [],
  extras: [],
  questions: [],
  answers: [],
  customer: {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    country: "",
    hotelName: "",
    notes: ""
  },
  quote: null,
  bookingResult: null,
  promoCode: "",
  tripDetailsCompleted: false,
  availabilityChecked: false,
  sourceChannel: "direct_website",
  checkoutProgress: {}
});

export const BookingFlowProvider = ({ children }) => {
  const [state, setState] = useState(createDefaultData);

  const updateFlow = useCallback((patch) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFlow = useCallback(() => {
    setState(createDefaultData());
  }, []);

  const hydrateFlow = useCallback((payload = {}) => {
    setState({
      ...createDefaultData(),
      ...payload
    });
  }, []);

  const value = useMemo(
    () => ({
      state,
      updateFlow,
      resetFlow,
      hydrateFlow
    }),
    [state, updateFlow, resetFlow, hydrateFlow]
  );

  return <BookingFlowContext.Provider value={value}>{children}</BookingFlowContext.Provider>;
};

export const useBookingFlowContext = () => {
  const ctx = useContext(BookingFlowContext);

  if (!ctx) {
    throw new Error("useBookingFlowContext must be used within BookingFlowProvider");
  }

  return ctx;
};
