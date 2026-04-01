export const mockBokunMappedProduct = {
  productId: "1175398",
  productTitle: "Zanzibar Jozani Forest Salaam Cave and Mtende Beach Private Tour",
  currency: "USD",
  defaultRateId: "104666",
  startingFromPrice: 140,
  rateOptions: [
    {
      id: "104666",
      label: "Default",
      description: "Standard booking setup",
      pricingType: "per_person"
    }
  ],
  pricingCategories: [
    { id: "1111558", label: "Adult", min: 0, max: 20, defaultQuantity: 2, ticketCategory: "ADULT" },
    { id: "1139039", label: "Child", min: 0, max: 20, defaultQuantity: 0, ticketCategory: "CHILD" },
    { id: "775204", label: "Infant", min: 0, max: 10, defaultQuantity: 0, ticketCategory: "INFANT" }
  ],
  selectedTripExample: {
    optionId: "2100001",
    optionTitle: "Private pickup from Paje hotels",
    rateId: "104666",
    travelDate: "2026-04-10",
    passengers: [
      { categoryId: "1111558", title: "Adult", ticketCategory: "ADULT", quantity: 2 },
      { categoryId: "1139039", title: "Child", ticketCategory: "CHILD", quantity: 1 }
    ]
  }
};

