const dayjs = require("dayjs");

const mockProducts = [
  {
    id: "bk_prod_znz_dolphin",
    title: "Mnemba Atoll Dolphin & Snorkeling Adventure",
    slug: "mnemba-atoll-dolphin-snorkeling-adventure",
    description:
      "Sail from Matemwe to Mnemba Atoll for a premium morning dolphin spotting and reef snorkeling experience.",
    shortDescription: "Luxury speedboat, reef snorkeling, and tropical fruit on board.",
    duration: "5h",
    images: [
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
      "https://images.unsplash.com/photo-1500375592092-40eb2168fd21"
    ],
    meetingInfo: "Meet at Matemwe Beach launch point, 07:00 AM.",
    pickupInfo: "Hotel pickup available from Stone Town, Nungwi, Kendwa.",
    included: ["Boat transfer", "Snorkeling gear", "Fruits & water", "Guide"],
    excluded: ["Marine conservation fee", "Personal expenses"],
    highlights: [
      "Dolphin spotting near Mnemba",
      "Crystal clear snorkeling reefs",
      "Small-group premium boat"
    ],
    categories: ["Ocean", "Snorkeling", "Family"],
    destination: "Zanzibar",
    status: "active",
    currency: "USD",
    fromPrice: 85,
    activityPriceCatalogs: [
      {
        id: "mock_apc_default",
        catalogId: "mock_default",
        active: true,
        catalog: {
          title: "Default",
          isVendorDefaultCatalog: true,
          currency: "USD"
        }
      }
    ],
    options: [
      {
        id: "bk_opt_znz_dolphin_shared",
        name: "Shared Speedboat",
        description: "Join a shared premium speedboat trip",
        language: "English",
        pricingSummary: "From USD 85 per adult",
        pickupSupported: true,
        meetingPointSupported: true,
        active: true,
        itinerary: ["Hotel pickup", "Boat transfer", "Snorkeling session", "Return"],
        importantInformation: ["Bring swimwear", "Bring sunscreen", "Subject to sea conditions"]
      },
      {
        id: "bk_opt_znz_dolphin_private",
        name: "Private Charter",
        description: "Private premium charter for your group",
        language: "English",
        pricingSummary: "From USD 420 per charter",
        pickupSupported: true,
        meetingPointSupported: true,
        active: true,
        itinerary: ["Private pickup", "Private charter", "Flexible schedule", "Drop-off"],
        importantInformation: ["Max 8 pax", "Weather policy applies"]
      }
    ]
  },
  {
    id: "bk_prod_znz_stonetown",
    title: "Stone Town Heritage & Spice Route",
    slug: "stone-town-heritage-and-spice-route",
    description:
      "Discover Zanzibar history in Stone Town and finish with a guided spice farm tasting tour.",
    shortDescription: "UNESCO culture walk plus sensory spice farm experience.",
    duration: "6h",
    images: [
      "https://images.unsplash.com/photo-1526772662000-3f88f10405ff",
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828"
    ],
    meetingInfo: "Meet outside Old Fort main gate at 09:00 AM.",
    pickupInfo: "Pickup available from Stone Town hotels.",
    included: ["Guide", "Spice tasting", "Bottled water"],
    excluded: ["Lunch", "Tips"],
    highlights: ["Stone Town alleys", "Historic landmarks", "Spice tasting"],
    categories: ["Culture", "History"],
    destination: "Zanzibar",
    status: "active",
    currency: "USD",
    fromPrice: 55,
    activityPriceCatalogs: [
      {
        id: "mock_apc_default",
        catalogId: "mock_default",
        active: true,
        catalog: {
          title: "Default",
          isVendorDefaultCatalog: true,
          currency: "USD"
        }
      }
    ],
    options: [
      {
        id: "bk_opt_znz_stonetown_group",
        name: "Group Tour",
        description: "Small group guided tour",
        language: "English",
        pricingSummary: "From USD 55 per adult",
        pickupSupported: false,
        meetingPointSupported: true,
        active: true,
        itinerary: ["Stone Town walk", "Spice farm visit", "Return"],
        importantInformation: ["Comfortable walking shoes recommended"]
      }
    ]
  }
];

const mockAvailability = ({ optionId, travelDate, pax, priceCatalogId }) => {
  const slots = ["08:00", "09:00", "10:30", "13:00", "15:00"];
  const basePrice = optionId.includes("private") ? 420 : optionId.includes("stonetown") ? 55 : 85;
  const adultCount = pax?.adults || 1;
  const childrenCount = pax?.children || 0;

  return {
    travelDate,
    optionId,
    available: true,
    currency: "USD",
    priceCatalog: {
      activityPriceCatalogId: "mock_apc_default",
      catalogId: priceCatalogId || "mock_default",
      title: "Default",
      active: true,
      isVendorDefault: true,
      currency: "USD"
    },
    availablePriceCatalogs: [
      {
        activityPriceCatalogId: "mock_apc_default",
        catalogId: "mock_default",
        title: "Default",
        active: true,
        isVendorDefault: true,
        currency: "USD"
      }
    ],
    slots: slots.map((time, idx) => ({
      time,
      capacityLeft: Math.max(0, 12 - adultCount - childrenCount - idx),
      status: idx < 4 ? "available" : "limited"
    })),
    pricing: {
      currency: "USD",
      lineItems: [
        { label: "Adult", quantity: adultCount, unitPrice: basePrice, total: adultCount * basePrice },
        {
          label: "Child",
          quantity: childrenCount,
          unitPrice: Math.round(basePrice * 0.7),
          total: childrenCount * Math.round(basePrice * 0.7)
        }
      ],
      baseAmount: adultCount * basePrice + childrenCount * Math.round(basePrice * 0.7),
      extraAmount: 0,
      grossAmount: adultCount * basePrice + childrenCount * Math.round(basePrice * 0.7)
    }
  };
};

const mockQuestions = ({ optionId }) => {
  const common = [
    {
      id: "pickup_location",
      label: "Pickup hotel/location",
      type: "text",
      scope: "booking",
      required: true,
      options: []
    },
    {
      id: "dietary_notes",
      label: "Dietary notes",
      type: "textarea",
      scope: "booking",
      required: false,
      options: []
    }
  ];

  if (optionId.includes("dolphin")) {
    common.push({
      id: "swim_ability",
      label: "Can all guests swim?",
      type: "select",
      scope: "booking",
      required: true,
      options: ["Yes", "No"]
    });
  }

  common.push({
    id: "passport_name",
    label: "Passenger full name",
    type: "text",
    scope: "passenger",
    required: true,
    options: []
  });

  return common;
};

const mockPriceList = (productId = "") => {
  const product = mockProducts.find((item) => String(item.id) === String(productId));
  if (!product) {
    return {
      pricesByDateRange: []
    };
  }

  const rates = (product.options || []).map((option) => {
    const optionName = String(option.name || "").toLowerCase();
    const isPrivate = optionName.includes("private");
    const passengers = isPrivate
      ? [
          {
            pricingCategoryId: "group",
            title: "Group",
            ticketCategory: "GROUP",
            minPerBooking: 1,
            maxPerBooking: 1
          }
        ]
      : [
          {
            pricingCategoryId: "adult",
            title: "Adult",
            ticketCategory: "ADULT",
            minPerBooking: 0,
            maxPerBooking: 20
          },
          {
            pricingCategoryId: "child",
            title: "Child",
            ticketCategory: "CHILD",
            minPerBooking: 0,
            maxPerBooking: 20
          }
        ];

    return {
      rateId: option.id,
      title: option.name,
      passengers
    };
  });

  return {
    pricesByDateRange: [
      {
        startDate: dayjs().format("YYYY-MM-DD"),
        endDate: dayjs().add(60, "day").format("YYYY-MM-DD"),
        rates
      }
    ]
  };
};

const mockBookingCreate = ({
  productId,
  optionId,
  travelDate,
  startTime,
  customer,
  pax
}) => {
  const reference = `ZNZ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  return {
    id: `bokun_${reference}`,
    bookingReference: reference,
    confirmationCode: reference,
    productId,
    optionId,
    travelDate,
    startTime,
    createdAt: dayjs().toISOString(),
    status: "CONFIRMED",
    customer,
    pax
  };
};

module.exports = {
  mockProducts,
  mockAvailability,
  mockPriceList,
  mockQuestions,
  mockBookingCreate
};
