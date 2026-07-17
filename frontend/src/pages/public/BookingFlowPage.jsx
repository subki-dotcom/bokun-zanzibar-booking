import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card } from "react-bootstrap";
import { BsArrowLeft, BsArrowRight } from "react-icons/bs";
import { BookingFlowProvider } from "../../context/BookingFlowContext";
import useBookingFlow from "../../hooks/useBookingFlow";
import { fetchTourBySlug } from "../../api/toursApi";
import {
  fetchAvailability,
  createQuote,
  fetchBookingQuestions
} from "../../api/bookingsApi";
import { fetchBokunCountries, fetchBokunPickupPlaces, fetchBokunProductDetails } from "../../api/bokunApi";
import { createDpoPayment, createPaypalPayment, createPesapalPayment } from "../../api/paymentsApi";
import { captureMarketingLead } from "../../api/marketingApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import BookingFlowLayout from "../../components/booking/BookingFlowLayout";
import BookingStepper from "../../components/booking/BookingStepper";
import BookingSummarySidebar from "../../components/booking/BookingSummarySidebar";
import CompletedTripDetailsCard from "../../components/booking/CompletedTripDetailsCard";
import ReviewOrderSummarySidebar from "../../components/booking/ReviewOrderSummarySidebar";
import ExtrasStep from "../../components/booking/ExtrasStep";
import CustomerDetailsStep from "../../components/booking/CustomerDetailsStep";
import ReviewConfirmStep from "../../components/booking/ReviewConfirmStep";
import ConfirmationStep from "../../components/booking/ConfirmationStep";
import SmartCheckoutInitializer from "../../components/booking/SmartCheckoutInitializer";
import PaymentMethodSelector from "../../components/booking/PaymentMethodSelector";
import { isCustomerSummaryValid } from "../../components/booking/CustomerSummaryCard";
import { getPaymentMethodLabel } from "../../utils/paymentMethods";
import { usePaymentProviders } from "../../context/PaymentProvidersContext";
import {
  STEP_IDS,
  buildSmartCheckoutSteps,
  resolveFirstActionableStepId,
  resolveNextStepId,
  resolvePreviousStepId
} from "../../utils/checkoutFlow";
import {
  clearBookingSession,
  hasCompleteTripDetails,
  readBookingSession,
  saveBookingSession
} from "../../utils/bookingSession";
import { buildMarketingContext } from "../../utils/marketingAttribution";
import { trackAnalyticsEvent } from "../../utils/analytics";

const normalizeTicketCategory = (value = "") => {
  const token = String(value || "").toLowerCase();

  if (token.includes("adult")) return "adult";
  if (token.includes("child")) return "child";
  if (token.includes("infant") || token.includes("baby")) return "infant";

  return "other";
};

const decodeJsonMaybe = (raw = "") => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
};

const resolveCatalogId = (catalog = {}) =>
  String(catalog?.activityPriceCatalogId || catalog?.catalogId || catalog?.id || "").trim();

const resolveCatalogById = (catalogs = [], catalogId = "") =>
  (catalogs || []).find((catalog) => resolveCatalogId(catalog) === String(catalogId || "").trim()) || null;

const resolveDefaultCatalog = (catalogs = [], preferredCatalogId = "") => {
  const activeCatalogs = (catalogs || []).filter((catalog) => catalog?.active !== false);
  if (!activeCatalogs.length) {
    return { id: "", catalog: null };
  }

  if (preferredCatalogId) {
    const preferred = resolveCatalogById(activeCatalogs, preferredCatalogId);
    if (preferred) {
      return {
        id: resolveCatalogId(preferred),
        catalog: preferred
      };
    }
  }

  const defaultCatalog = activeCatalogs.find((catalog) => catalog?.isVendorDefault) || activeCatalogs[0];
  return {
    id: resolveCatalogId(defaultCatalog),
    catalog: defaultCatalog || null
  };
};

const normalizeParticipants = (participants = []) =>
  (participants || [])
    .map((row = {}) => {
      const categoryId = String(row.categoryId || row.pricingCategoryId || "").trim();
      if (!categoryId) {
        return null;
      }

      return {
        categoryId,
        title: row.title || row.label || "Passenger",
        ticketCategory: row.ticketCategory || "",
        quantity: Math.max(0, Number(row.quantity || 0))
      };
    })
    .filter(Boolean);

const buildPaxFromParticipants = (participants = []) => {
  let adults = 0;
  let children = 0;
  let infants = 0;

  (participants || []).forEach((participant) => {
    const quantity = Math.max(0, Number(participant.quantity || 0));
    const bucket = normalizeTicketCategory(participant.ticketCategory || participant.title);

    if (bucket === "adult") adults += quantity;
    else if (bucket === "child") children += quantity;
    else if (bucket === "infant") infants += quantity;
    else adults += quantity;
  });

  if (adults + children + infants <= 0) {
    adults = 1;
  }

  return { adults, children, infants };
};

const syncParticipantsWithCategories = (current = [], categories = []) => {
  const currentMap = new Map(
    normalizeParticipants(current).map((row) => [String(row.categoryId), row])
  );

  if (!Array.isArray(categories) || !categories.length) {
    return normalizeParticipants(current);
  }

  return categories.map((category) => {
    const categoryId = String(category.categoryId || "").trim();
    const currentRow = currentMap.get(categoryId);
    const min = Math.max(0, Number(category.minQuantity || 0));
    const max = Math.max(min, Number(category.maxQuantity || 50));
    const currentQty = Number(currentRow?.quantity ?? category.quantity ?? 0);
    const quantity = Math.min(max, Math.max(min, currentQty));

    return {
      categoryId,
      title: category.title || currentRow?.title || "Passenger",
      ticketCategory: category.ticketCategory || currentRow?.ticketCategory || "",
      quantity
    };
  });
};

const mapSessionExtrasToAvailability = (selectedExtras = [], availableExtras = []) => {
  const byCode = new Map((availableExtras || []).map((extra) => [String(extra.code), extra]));
  return (selectedExtras || [])
    .map((extra = {}) => {
      const match = byCode.get(String(extra.code || ""));
      if (!match) {
        return null;
      }

      return {
        code: String(match.code),
        label: match.label,
        amount: Number(match.amount || 0),
        quantity: Math.min(
          Math.max(1, Number(match.maxQuantity || 1)),
          Math.max(1, Number(extra.quantity || 1))
        )
      };
    })
    .filter(Boolean);
};

const mergeLivePickupDetails = (tourData = {}, liveProduct = null) => {
  if (!liveProduct) {
    return tourData;
  }

  const livePickupPlaces = Array.isArray(liveProduct.pickupPlaces) ? liveProduct.pickupPlaces : [];
  const currentPickupPlaces = Array.isArray(tourData.pickupPlaces) ? tourData.pickupPlaces : [];

  return {
    ...tourData,
    pickupInfo: liveProduct.pickupInfo || tourData.pickupInfo || "",
    pickupPlaces: livePickupPlaces.length ? livePickupPlaces : currentPickupPlaces,
    options: Array.isArray(liveProduct.options) && liveProduct.options.length ? liveProduct.options : tourData.options,
    priceCatalogs:
      Array.isArray(liveProduct.priceCatalogs) && liveProduct.priceCatalogs.length
        ? liveProduct.priceCatalogs
        : tourData.priceCatalogs
  };
};

const markProductPickupPlaces = (places = []) =>
  (Array.isArray(places) ? places : []).map((place) => ({
    ...place,
    productScoped: place.productScoped !== false
  }));

const markFallbackPickupPlaces = (places = []) =>
  (Array.isArray(places) ? places : []).map((place) => ({
    ...place,
    productScoped: false
  }));

const resolveLiveStartTimeId = ({ slots = [], startTime = "", fallbackId = "" } = {}) => {
  const selectedTime = String(startTime || "").trim();
  const availableSlots = Array.isArray(slots) ? slots : [];
  const selectedSlot = selectedTime
    ? availableSlots.find((slot) => String(slot?.time || "").trim() === selectedTime)
    : null;

  return String(selectedSlot?.startTimeId || fallbackId || "").trim();
};

const BookingFlowInner = ({ portal = "public" }) => {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { state, updateFlow, hydrateFlow } = useBookingFlow();
  const isAgentPortal = portal === "agent";
  const sourceChannel = isAgentPortal ? "agent_portal" : "direct_website";
  const sessionSource = isAgentPortal ? "agent_portal" : "single_product_page";
  const productSetupPath = isAgentPortal ? `/agent/new-booking/${slug}` : `/tours/${slug}`;
  const bookingDetailsPath = (reference = "") =>
    isAgentPortal ? `/agent/bookings/${reference}` : `/my-booking/${reference}`;

  const [tour, setTour] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [countries, setCountries] = useState([]);
  const [currentStepId, setCurrentStepId] = useState(STEP_IDS.CUSTOMER);
  const [completedStepIds, setCompletedStepIds] = useState([STEP_IDS.TRIP_DETAILS]);
  const [initLoading, setInitLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState("");
  const [fallbackPaymentMethod, setFallbackPaymentMethod] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("pesapal");
  const {
    availableProviders,
    loading: paymentProvidersLoading,
    isProviderEnabled,
    getProvider
  } = usePaymentProviders();

  useEffect(() => {
    if (
      !paymentProvidersLoading &&
      availableProviders.length > 0 &&
      !isProviderEnabled(selectedPaymentMethod)
    ) {
      setSelectedPaymentMethod(availableProviders[0].id);
    }
  }, [availableProviders, isProviderEnabled, paymentProvidersLoading, selectedPaymentMethod]);

  const querySeed = useMemo(() => {
    const optionId = String(searchParams.get("option") || "").trim();
    const travelDate = String(searchParams.get("date") || "").trim();
    const startTime = String(searchParams.get("time") || "").trim();
    const rateId = String(searchParams.get("catalog") || "").trim();
    const adultsParsed = Number.parseInt(searchParams.get("adults") || "", 10);
    const adults = Number.isFinite(adultsParsed) ? Math.max(1, adultsParsed) : 2;
    const participants = normalizeParticipants(decodeJsonMaybe(searchParams.get("passengers") || "") || []);

    return {
      optionId,
      travelDate,
      startTime,
      rateId,
      participants,
      pax: participants.length ? buildPaxFromParticipants(participants) : { adults, children: 0, infants: 0 },
      marketing: buildMarketingContext(searchParams.toString())
    };
  }, [searchParams]);

  const hasExtras = Boolean((availability?.extras || []).length);
  const hasConfirmation = Boolean(state.bookingResult);
  const isReviewStep = currentStepId === STEP_IDS.REVIEW;
  const isCustomerStep = currentStepId === STEP_IDS.CUSTOMER;
  const customerReady = isCustomerSummaryValid(state.customer || {});
  const selectedPaymentLabel = getProvider(selectedPaymentMethod)?.title || getPaymentMethodLabel(selectedPaymentMethod);
  const paymentMethodEnabled = isProviderEnabled(selectedPaymentMethod);
  const checkoutConfirmDisabled = !customerReady || !state.quote?.quoteToken || paymentProvidersLoading || !paymentMethodEnabled;
  const confirmPaymentLabel = `Pay Securely with ${selectedPaymentLabel}`;
  const loadingPaymentLabel = `Redirecting to ${selectedPaymentLabel}...`;

  const steps = useMemo(
    () =>
      buildSmartCheckoutSteps({
        hasExtras,
        hasConfirmation,
        currentStepId,
        completedStepIds
      }),
    [hasExtras, hasConfirmation, currentStepId, completedStepIds]
  );

  const displaySteps = useMemo(
    () =>
      steps
        .filter((step) => [STEP_IDS.TRIP_DETAILS, STEP_IDS.CUSTOMER, STEP_IDS.REVIEW].includes(step.id))
        .map((step, index) => ({
          ...step,
          index: index + 1
        })),
    [steps]
  );
  const checkoutPickupPlaces = useMemo(() => {
    const statePlaces = Array.isArray(state.pickupPlaces) ? state.pickupPlaces : [];
    const tourPlaces = Array.isArray(tour?.pickupPlaces) ? tour.pickupPlaces : [];

    return statePlaces.length ? statePlaces : tourPlaces;
  }, [state.pickupPlaces, tour?.pickupPlaces]);

  const markStepCompleted = useCallback((stepId) => {
    setCompletedStepIds((prev) => Array.from(new Set([...prev, stepId])));
  }, []);

  const handleGoPrevious = useCallback(() => {
    const previousStep = resolvePreviousStepId(steps, currentStepId);
    if (previousStep === STEP_IDS.TRIP_DETAILS) {
      return;
    }
    setCurrentStepId(previousStep);
  }, [steps, currentStepId]);

  const handleGoNext = useCallback(() => {
    const nextStep = resolveNextStepId(steps, currentStepId);
    setCurrentStepId(nextStep);
  }, [steps, currentStepId]);

  const buildTripDetailsQuery = useCallback(() => {
    const query = new URLSearchParams();
    if (state.option?.bokunOptionId) {
      query.set("option", String(state.option.bokunOptionId));
    }
    if (state.travelDate) {
      query.set("date", state.travelDate);
    }
    if (state.startTime) {
      query.set("time", state.startTime);
    }
    if (state.priceCatalogId) {
      query.set("catalog", state.priceCatalogId);
    }
    if ((state.priceCategoryParticipants || []).length > 0) {
      query.set("passengers", encodeURIComponent(JSON.stringify(state.priceCategoryParticipants)));
    }

    return query.toString();
  }, [state.option?.bokunOptionId, state.travelDate, state.startTime, state.priceCatalogId, state.priceCategoryParticipants]);

  const handleChangeTripDetails = useCallback(() => {
    const query = buildTripDetailsQuery();
    navigate(`${productSetupPath}${query ? `?${query}` : ""}`);
  }, [buildTripDetailsQuery, navigate, productSetupPath]);

  const buildBookingPayload = useCallback(
    (overrides = {}) => {
      if (!tour?.bokunProductId || !state.option?.bokunOptionId || !state.travelDate) {
        return null;
      }

      const payload = {
        productId: tour.bokunProductId,
        optionId: state.option.bokunOptionId,
        travelDate: overrides.travelDate ?? state.travelDate,
        startTime: overrides.startTime ?? state.startTime,
        startTimeId: overrides.startTimeId ?? state.startTimeId ?? "",
        pax: overrides.pax ?? state.pax,
        priceCategoryParticipants:
          overrides.priceCategoryParticipants ?? state.priceCategoryParticipants ?? [],
        extras: overrides.extras ?? state.extras ?? [],
        promoCode: overrides.promoCode ?? state.promoCode ?? "",
        marketing: overrides.marketing ?? state.marketing ?? {}
      };

      const catalogId =
        String(overrides.priceCatalogId || "").trim() || String(state.priceCatalogId || "").trim();
      if (catalogId) {
        payload.priceCatalogId = catalogId;
      }

      return payload;
    },
    [tour, state]
  );

  const refreshLiveQuote = useCallback(
    async (overrides = {}) => {
      const payload = buildBookingPayload(overrides);
      if (!payload) {
        return null;
      }

      setQuoteLoading(true);
      setError("");

      try {
        const quote = await createQuote({
          ...payload,
          sourceChannel
        });

        // Bókun can normalize passenger categories (including mandatory or
        // zero-quantity categories). Keep the request payload aligned with
        // the signed quote token before a payment is initialized.
        const syncedParticipants = normalizeParticipants(
          quote?.priceCategoryParticipants || payload.priceCategoryParticipants || []
        );
        const syncedPax = syncedParticipants.length
          ? buildPaxFromParticipants(syncedParticipants)
          : payload.pax;

        updateFlow({
          quote,
          pax: syncedPax,
          priceCategoryParticipants: syncedParticipants,
          extras: quote?.extras || payload.extras || []
        });

        return quote;
      } catch (err) {
        setError(err.message || "Could not refresh live quote");
        return null;
      } finally {
        setQuoteLoading(false);
      }
    },
    [buildBookingPayload, sourceChannel, updateFlow]
  );

  const initializeCheckout = useCallback(async () => {
    setInitLoading(true);
    setError("");

    try {
      const [tourData, countryList] = await Promise.all([
        fetchTourBySlug(slug),
        fetchBokunCountries().catch(() => [])
      ]);
      const liveProduct = tourData?.bokunProductId
        ? await fetchBokunProductDetails(tourData.bokunProductId, { forceRefresh: true }).catch(() => null)
        : null;
      const mergedTour = mergeLivePickupDetails(tourData, liveProduct);
      const productPickupPlaces = markProductPickupPlaces(mergedTour.pickupPlaces || []);
      const fallbackPickupPlaces = productPickupPlaces.length
        ? []
        : markFallbackPickupPlaces(
            await fetchBokunPickupPlaces({
              limit: 900
            }).catch(() => [])
          );
      const checkoutTour = {
        ...mergedTour,
        pickupPlaces: productPickupPlaces.length ? productPickupPlaces : fallbackPickupPlaces,
        pickupPlacesAreFallback: productPickupPlaces.length === 0 && fallbackPickupPlaces.length > 0
      };

      setTour(checkoutTour);
      setCountries(countryList || []);

      const session = readBookingSession();
      const sessionValid = hasCompleteTripDetails(session, slug);
      const seededTrip = sessionValid
        ? {
            optionId: String(session?.tripDetails?.optionId || ""),
            travelDate: String(session?.tripDetails?.travelDate || ""),
            startTime: String(session?.tripDetails?.startTime || ""),
            startTimeId: String(session?.tripDetails?.startTimeId || ""),
            rateId: String(session?.tripDetails?.rateId || ""),
            participants: normalizeParticipants(session?.tripDetails?.passengers || []),
            pax: session?.tripDetails?.pax || buildPaxFromParticipants(session?.tripDetails?.passengers || [])
          }
        : querySeed;

      if (!seededTrip.optionId || !seededTrip.travelDate) {
        throw new Error("Trip details are missing. Please select option, date, and passengers from product page.");
      }

      const selectedOption =
        (checkoutTour.options || []).find(
          (option) => String(option?.bokunOptionId || "") === String(seededTrip.optionId || "")
        ) || null;

      if (!selectedOption) {
        throw new Error("Selected option is not available anymore. Please reselect trip details.");
      }

      const defaultCatalog = resolveDefaultCatalog(checkoutTour.priceCatalogs || [], seededTrip.rateId);
      const initialRateId = String(seededTrip.rateId || defaultCatalog.id || "").trim();
      const initialParticipants = normalizeParticipants(seededTrip.participants || []);
      const initialPax = initialParticipants.length
        ? buildPaxFromParticipants(initialParticipants)
        : seededTrip.pax || { adults: 2, children: 0, infants: 0 };

      hydrateFlow({
        selectedProduct: {
          productId: checkoutTour.bokunProductId,
          slug: checkoutTour.slug,
          title: checkoutTour.title
        },
        option: selectedOption,
        priceCatalogId: initialRateId,
        priceCatalog: resolveCatalogById(checkoutTour.priceCatalogs || [], initialRateId) || defaultCatalog.catalog,
        travelDate: seededTrip.travelDate,
        startTime: seededTrip.startTime || "",
        startTimeId: seededTrip.startTimeId || "",
        pax: initialPax,
        priceCategoryParticipants: initialParticipants,
        extras: [],
        pickupPlaces: checkoutTour.pickupPlaces || [],
        questions: [],
        answers: [],
        quote: null,
        bookingResult: null,
        tripDetailsCompleted: true,
        availabilityChecked: false,
        sourceChannel,
        marketing: session?.marketing || querySeed.marketing || {}
      });

      const availabilityPayload = {
        productId: checkoutTour.bokunProductId,
        optionId: selectedOption.bokunOptionId,
        travelDate: seededTrip.travelDate,
        startTime: seededTrip.startTime || "",
        pax: initialPax,
        priceCategoryParticipants: initialParticipants,
        extras: [],
        priceCatalogId: initialRateId
      };

      setAvailabilityLoading(true);
      const availabilityResult = await fetchAvailability(availabilityPayload);
      setAvailability(availabilityResult);
      setAvailabilityLoading(false);

      const syncedParticipants = syncParticipantsWithCategories(
        initialParticipants,
        availabilityResult?.priceCategories || []
      );
      const syncedPax = syncedParticipants.length
        ? buildPaxFromParticipants(syncedParticipants)
        : initialPax;
      const resolvedCatalogId =
        String(availabilityResult?.priceCatalog?.catalogId || initialRateId || "").trim();
      const resolvedCatalog =
        availabilityResult?.priceCatalog ||
        resolveCatalogById(checkoutTour.priceCatalogs || [], resolvedCatalogId) ||
        defaultCatalog.catalog;

      const seededExtras = mapSessionExtrasToAvailability(
        session?.selectedExtras || [],
        availabilityResult?.extras || []
      );

      const quotePayload = {
        ...availabilityPayload,
        startTime: availabilityResult?.startTime || seededTrip.startTime || "",
        startTimeId: resolveLiveStartTimeId({
          slots: availabilityResult?.slots || [],
          startTime: availabilityResult?.startTime || seededTrip.startTime || "",
          fallbackId: seededTrip.startTimeId
        }),
        priceCatalogId: resolvedCatalogId,
        priceCategoryParticipants: syncedParticipants,
        pax: syncedPax,
        extras: seededExtras
      };

      const quoteResult = await createQuote({
        ...quotePayload,
        sourceChannel
      });
      let questionsResult = [];
      try {
        questionsResult = await fetchBookingQuestions({
          ...quotePayload,
          priceCategoryParticipants: syncedParticipants,
          extras: quoteResult?.extras || seededExtras,
          customer: state.customer || {}
        });
      } catch (questionError) {
        // Payment initialization performs the same supplier-side validation,
        // so a temporary question lookup failure cannot create an invalid booking.
        console.warn("Unable to prefetch Bokun booking questions", questionError);
      }

      const firstActionableStep = resolveFirstActionableStepId({
        hasExtras: Boolean((availabilityResult?.extras || []).length),
        hasQuestions: false
      });

      updateFlow({
        priceCatalogId: resolvedCatalogId,
        priceCatalog: resolvedCatalog || null,
        startTime: quotePayload.startTime || "",
        startTimeId: quotePayload.startTimeId || "",
        pax: syncedPax,
        priceCategoryParticipants: syncedParticipants,
        extras: quoteResult?.extras || seededExtras,
        pickupPlaces: checkoutTour.pickupPlaces || [],
        quote: quoteResult,
        questions: questionsResult || [],
        availabilityChecked: true
      });

      trackAnalyticsEvent("begin_checkout", {
        currency: quoteResult?.pricing?.currency || "USD",
        value: Number(quoteResult?.pricing?.finalPayable || 0),
        items: [{ item_id: checkoutTour.bokunProductId, item_name: checkoutTour.title, quantity: 1 }]
      });

      setCompletedStepIds([STEP_IDS.TRIP_DETAILS]);
      setCurrentStepId(firstActionableStep);

      saveBookingSession({
        source: sessionSource,
        product: {
          productId: checkoutTour.bokunProductId,
          slug: checkoutTour.slug,
          title: checkoutTour.title
        },
        tripDetails: {
          optionId: selectedOption.bokunOptionId,
          optionTitle: selectedOption.name || "",
          rateId: resolvedCatalogId,
          rateTitle: resolvedCatalog?.title || "",
          travelDate: seededTrip.travelDate,
          startTime: quotePayload.startTime || "",
          startTimeId: quotePayload.startTimeId || "",
          passengers: syncedParticipants,
          pax: syncedPax
        },
        selectedExtras: quoteResult?.extras || seededExtras,
        availabilityQuote: quoteResult,
        marketing: session?.marketing || querySeed.marketing || {},
        tripDetailsCompleted: true,
        availabilityChecked: true
      });
    } catch (err) {
      setError(err.message || "Failed to initialize smart checkout");
    } finally {
      setInitLoading(false);
      setAvailabilityLoading(false);
    }
  }, [slug, querySeed, hydrateFlow, updateFlow, sourceChannel, sessionSource]);

  const handleToggleExtra = (extra) => {
    const code = String(extra?.code || "");
    if (!code) {
      return;
    }

    const existing = (state.extras || []).find((item) => String(item.code) === code);
    if (existing) {
      updateFlow({
        extras: (state.extras || []).filter((item) => String(item.code) !== code)
      });
      return;
    }

    updateFlow({
      extras: [
        ...(state.extras || []),
        {
          code,
          label: extra.label || "Extra",
          amount: Number(extra.amount || 0),
          quantity: 1
        }
      ]
    });
  };

  const handleExtraQuantity = (code, quantity, maxQuantity = 1) => {
    const safeQty = Math.min(Math.max(1, Number(maxQuantity || 1)), Math.max(1, Number(quantity || 1)));
    updateFlow({
      extras: (state.extras || []).map((item) =>
        String(item.code) === String(code)
          ? {
              ...item,
              quantity: safeQty
            }
          : item
      )
    });
  };

  const handleExtrasContinue = async () => {
    const quote = await refreshLiveQuote({
      extras: state.extras || []
    });
    if (!quote) {
      return;
    }

    markStepCompleted(STEP_IDS.EXTRAS);
    handleGoNext();
  };

  const handleCustomerContinue = async () => {
    const requiredCustomerFields = ["firstName", "lastName", "email", "phone", "country"];
    const missingCustomerFields = requiredCustomerFields.filter(
      (field) => !String(state.customer?.[field] || "").trim()
    );

    if (missingCustomerFields.length > 0) {
      setError("Please complete customer name, email, phone, and country before continuing.");
      return;
    }

    const quote = await refreshLiveQuote();
    if (!quote) {
      return;
    }

    void captureMarketingLead({
      email: state.customer.email,
      firstName: state.customer.firstName,
      lastName: state.customer.lastName,
      phone: state.customer.phone,
      stage: "checkout_customer",
      source: sourceChannel,
      newsletterConsent: Boolean(state.customer.marketingConsent),
      recoveryConsent: Boolean(state.customer.marketingConsent),
      context: {
        productSlug: tour?.slug || "",
        optionId: state.option?.bokunOptionId || "",
        travelDate: state.travelDate || "",
        amount: Number(quote?.pricing?.finalPayable || 0),
        currency: quote?.pricing?.currency || "USD"
      }
    }).catch(() => null);

    trackAnalyticsEvent("add_shipping_info", {
      currency: quote?.pricing?.currency || "USD",
      value: Number(quote?.pricing?.finalPayable || 0),
      items: [{ item_id: tour?.bokunProductId || "", item_name: tour?.title || "", quantity: 1 }]
    });

    markStepCompleted(STEP_IDS.CUSTOMER);
    handleGoNext();
  };

  const handleCreateBooking = async () => {
    const payload = buildBookingPayload();
    if (!payload || !state.quote?.quoteToken) {
      setError("Missing live quote token. Please refresh quote and try again.");
      return;
    }

    if (!paymentMethodEnabled) {
      setError(`${selectedPaymentLabel} is not available right now. Please choose another payment method.`);
      return;
    }

    setSubmitLoading(true);
    setError("");
    setFallbackPaymentMethod("");

    try {
      const totalAmount = Number(
        state.quote?.pricing?.finalPayable ??
          state.quote?.pricing?.grossAmount ??
          0
      );
      const currency = state.quote?.pricing?.currency || "USD";
      const createPayment =
        selectedPaymentMethod === "dpo"
          ? createDpoPayment
          : selectedPaymentMethod === "paypal"
            ? createPaypalPayment
            : createPesapalPayment;

      const result = await createPayment({
        ...payload,
        quoteToken: state.quote.quoteToken,
        bookingQuestions: state.answers,
        customer: state.customer,
        sourceChannel,
        paymentMethod: selectedPaymentMethod,
        amount: totalAmount,
        currency
      });

      trackAnalyticsEvent("add_payment_info", {
        currency,
        value: totalAmount,
        payment_type: selectedPaymentMethod,
        items: [{ item_id: tour?.bokunProductId || "", item_name: tour?.title || "", quantity: 1 }]
      });

      void captureMarketingLead({
        email: state.customer.email,
        firstName: state.customer.firstName,
        lastName: state.customer.lastName,
        phone: state.customer.phone,
        stage: "checkout_payment_started",
        source: sourceChannel,
        newsletterConsent: Boolean(state.customer.marketingConsent),
        recoveryConsent: Boolean(state.customer.marketingConsent),
        context: {
          bookingReference: result.bookingReference || "",
          productSlug: tour?.slug || "",
          amount: totalAmount,
          currency
        }
      }).catch(() => null);

      saveBookingSession({
        ...(readBookingSession() || {}),
        payment: {
          provider: selectedPaymentMethod,
          bookingId: result.bookingId || "",
          bookingReference: result.bookingReference || "",
          initiatedAt: new Date().toISOString()
        }
      });

      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }

      if (result.bookingReference) {
        navigate(bookingDetailsPath(result.bookingReference));
        clearBookingSession();
      } else {
        throw new Error(`${selectedPaymentLabel} payment URL was not returned.`);
      }
    } catch (err) {
      setError(err.message || `${selectedPaymentLabel} payment could not be initialized`);
      const fallback = availableProviders.find((provider) => provider.id !== selectedPaymentMethod)?.id || "";
      setFallbackPaymentMethod(fallback);
      setSubmitLoading(false);
      return;
    } finally {
      // Keep loading state active when browser is redirecting to the payment provider.
      if (!document.hidden) {
        setSubmitLoading(false);
      }
    }
  };

  const handleApplyPromo = async (promoCode) => {
    const normalizedCode = String(promoCode || "").trim().toUpperCase();
    updateFlow({ promoCode: normalizedCode });
    const quote = await refreshLiveQuote({ promoCode: normalizedCode });

    if (!quote) {
      return null;
    }

    return {
      applied: Boolean(quote?.pricing?.offer),
      name: quote?.pricing?.offer?.name || ""
    };
  };

  const handleInitializerError = (err) => {
    setError(err?.message || "Could not initialize checkout");
    setInitLoading(false);
  };

  const renderPaymentMethodSelector = (
    className = "",
    inputName = "paymentMethod",
    titleId = "payment-method-title"
  ) => (
    <>
      <PaymentMethodSelector
        className={className}
        inputName={inputName}
        titleId={titleId}
        selectedMethod={selectedPaymentMethod}
        onChange={(method) => {
          setSelectedPaymentMethod(method);
          setError("");
          setFallbackPaymentMethod("");
        }}
        disabled={submitLoading}
      />
      {fallbackPaymentMethod ? (
        <div className="payment-fallback-notice" role="status">
          <span>{selectedPaymentLabel} could not start this payment. You can choose another secure provider.</span>
          <Button
            size="sm"
            variant="outline-success"
            onClick={() => {
              setSelectedPaymentMethod(fallbackPaymentMethod);
              setFallbackPaymentMethod("");
              setError("");
            }}
          >
            Try {getProvider(fallbackPaymentMethod)?.title || getPaymentMethodLabel(fallbackPaymentMethod)}
          </Button>
        </div>
      ) : null}
    </>
  );

  const renderReviewOrderSidebar = (className = "") => (
    <ReviewOrderSummarySidebar
      className={className}
      flowState={state}
      tour={tour}
      paymentMethodSelector={renderPaymentMethodSelector(
        "review-payment-mobile",
        "paymentMethodMobile",
        "payment-method-mobile-title"
      )}
      submitting={submitLoading}
      disableConfirm={checkoutConfirmDisabled}
      onConfirm={handleCreateBooking}
      confirmLabel={confirmPaymentLabel}
      loadingLabel={loadingPaymentLabel}
    />
  );

  const renderCustomerMobileActions = () => (
    <div className="checkout-mobile-customer-actions">
      <Button
        variant="outline-secondary"
        onClick={hasExtras ? handleGoPrevious : handleChangeTripDetails}
        disabled={quoteLoading}
      >
        <BsArrowLeft /> Back
      </Button>
      <Button
        className="premium-btn text-white"
        onClick={handleCustomerContinue}
        disabled={quoteLoading}
      >
        {quoteLoading ? "Checking live price..." : "Continue"}
        {!quoteLoading ? <BsArrowRight /> : null}
      </Button>
    </div>
  );

  const renderCurrentStep = () => {
    if (currentStepId === STEP_IDS.EXTRAS) {
      return (
        <ExtrasStep
          extras={state.extras || []}
          availableExtras={availability?.extras || []}
          onToggleExtra={handleToggleExtra}
          onChangeQuantity={handleExtraQuantity}
          onBack={handleChangeTripDetails}
          onNext={handleExtrasContinue}
          loading={quoteLoading}
        />
      );
    }

    if (currentStepId === STEP_IDS.CUSTOMER) {
      return (
        <CustomerDetailsStep
          customer={state.customer}
          setCustomer={(updater) => {
            const value = typeof updater === "function" ? updater(state.customer) : updater;
            updateFlow({ customer: value });
          }}
          pickupPlaces={checkoutPickupPlaces}
          pickupInfo={tour?.pickupInfo || ""}
          countries={countries}
          questions={state.questions}
          answers={state.answers}
          setAnswers={(updater) => {
            const answers = typeof updater === "function" ? updater(state.answers) : updater;
            updateFlow({ answers });
          }}
          loading={quoteLoading}
          onBack={hasExtras ? handleGoPrevious : handleChangeTripDetails}
          onNext={handleCustomerContinue}
        />
      );
    }

    if (currentStepId === STEP_IDS.REVIEW) {
      return (
        <ReviewConfirmStep
          flowState={state}
          submitting={submitLoading}
          pickupPlaces={checkoutPickupPlaces}
          pickupInfo={tour?.pickupInfo || ""}
          countries={countries}
          onBack={handleGoPrevious}
          onConfirm={handleCreateBooking}
          onEditCustomer={() => setCurrentStepId(STEP_IDS.CUSTOMER)}
          onEditTrip={handleChangeTripDetails}
          onApplyPromo={handleApplyPromo}
          promoLoading={quoteLoading}
          paymentMethodSelector={renderPaymentMethodSelector(
            "review-payment-desktop",
            "paymentMethodDesktop",
            "payment-method-desktop-title"
          )}
        />
      );
    }

    if (currentStepId === STEP_IDS.CONFIRMATION) {
      return <ConfirmationStep bookingResult={state.bookingResult} />;
    }

    return (
      <Card className="surface-card smart-step-card">
        <Card.Body>
          <h4 className="mb-2">Trip details completed</h4>
          <p className="text-muted mb-3">
            Continue checkout from the next required step.
          </p>
          <Button className="premium-btn text-white" onClick={handleGoNext}>
            Continue checkout
          </Button>
        </Card.Body>
      </Card>
    );
  };

  const renderMainContent = () => {
    if (isReviewStep) {
      return (
        <>
          <ErrorAlert error={error} className="mb-3" />
          {renderCurrentStep()}
        </>
      );
    }

    if (isCustomerStep) {
      return (
        <>
          <ErrorAlert error={error} className="mb-3" />
          {renderCurrentStep()}
        </>
      );
    }

    return (
      <>
        <CompletedTripDetailsCard
          tour={tour}
          flowState={state}
          onChangeTripDetails={handleChangeTripDetails}
          loading={quoteLoading || availabilityLoading || submitLoading}
        />
        <ErrorAlert error={error} className="mb-3" />
        {renderCurrentStep()}
      </>
    );
  };

  if (initLoading) {
    return (
      <>
        <SmartCheckoutInitializer onInitialize={initializeCheckout} onError={handleInitializerError} />
        <BookingFlowLayout
          title="Preparing your checkout"
          subtitle="Loading your selected trip details and live Bokun quote."
          left={<Loader message="Initializing smart checkout..." />}
          right={null}
        />
      </>
    );
  }

  if (!tour) {
    return (
      <BookingFlowLayout
        title="Checkout setup required"
        subtitle="Open trip details from the product page before continuing."
        left={
          <Card className="surface-card smart-step-card">
            <Card.Body>
              <ErrorAlert error={error || "Trip details are missing for this checkout session."} className="mb-3" />
              <Button type="button" className="premium-btn text-white" onClick={() => navigate(productSetupPath)}>
                Return to product page
              </Button>
            </Card.Body>
          </Card>
        }
        right={null}
      />
    );
  }

  if (!state.tripDetailsCompleted || !state.option?.bokunOptionId || !state.travelDate) {
    return (
      <BookingFlowLayout
        title={tour?.title || "Checkout setup required"}
        subtitle="Trip setup must be completed on the product page before checkout."
        left={
          <Card className="surface-card smart-step-card">
            <Card.Body>
              <ErrorAlert error={error || "Trip details are incomplete."} className="mb-3" />
              <Button type="button" className="premium-btn text-white" onClick={handleChangeTripDetails}>
                Return to trip setup
              </Button>
            </Card.Body>
          </Card>
        }
        right={null}
      />
    );
  }

  return (
    <BookingFlowLayout
      title={tour?.title || "Booking checkout"}
      subtitle="Trip details are already selected. Continue without repeating previous steps."
      stepper={<BookingStepper steps={displaySteps} />}
      tour={tour}
      left={renderMainContent()}
      right={
        <>
          {isReviewStep ? (
            renderReviewOrderSidebar("review-checkout-sidebar")
          ) : (
            <BookingSummarySidebar
              flowState={state}
              tour={tour}
              availability={availability}
              quoteLoading={quoteLoading}
              availabilityLoading={availabilityLoading}
              onChangeTripDetails={handleChangeTripDetails}
              compactProductTitle={false}
            />
          )}

          {isCustomerStep ? renderCustomerMobileActions() : null}

          {state.bookingResult ? (
            <Card className="surface-card mt-3">
              <Card.Body>
                <h6 className="mb-2">Next</h6>
                <Button
                  type="button"
                  variant="outline-info"
                  className="w-100"
                  onClick={() => navigate(bookingDetailsPath(state.bookingResult.bookingReference))}
                >
                  Open booking page
                </Button>
              </Card.Body>
            </Card>
          ) : null}
        </>
      }
    />
  );
};

const BookingFlowPage = ({ portal = "public" }) => (
  <BookingFlowProvider>
    <BookingFlowInner portal={portal} />
  </BookingFlowProvider>
);

export default BookingFlowPage;
