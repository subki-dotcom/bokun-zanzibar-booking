import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card } from "react-bootstrap";
import { BookingFlowProvider } from "../../context/BookingFlowContext";
import useBookingFlow from "../../hooks/useBookingFlow";
import { fetchTourBySlug } from "../../api/toursApi";
import {
  fetchAvailability,
  fetchBookingQuestions,
  createQuote
} from "../../api/bookingsApi";
import { createPesapalPayment } from "../../api/paymentsApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import BookingFlowLayout from "../../components/booking/BookingFlowLayout";
import BookingStepper from "../../components/booking/BookingStepper";
import BookingSummarySidebar from "../../components/booking/BookingSummarySidebar";
import CompletedTripDetailsCard from "../../components/booking/CompletedTripDetailsCard";
import ExtrasStep from "../../components/booking/ExtrasStep";
import BookingQuestionsStep from "../../components/booking/BookingQuestionsStep";
import CustomerDetailsStep from "../../components/booking/CustomerDetailsStep";
import ReviewConfirmStep from "../../components/booking/ReviewConfirmStep";
import ConfirmationStep from "../../components/booking/ConfirmationStep";
import SmartCheckoutInitializer from "../../components/booking/SmartCheckoutInitializer";
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

const BookingFlowInner = () => {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { state, updateFlow, hydrateFlow } = useBookingFlow();

  const [tour, setTour] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [currentStepId, setCurrentStepId] = useState(STEP_IDS.CUSTOMER);
  const [completedStepIds, setCompletedStepIds] = useState([STEP_IDS.TRIP_DETAILS]);
  const [initLoading, setInitLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState("");

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
      pax: participants.length ? buildPaxFromParticipants(participants) : { adults, children: 0, infants: 0 }
    };
  }, [searchParams]);

  const hasExtras = Boolean((availability?.extras || []).length);
  const hasQuestions = Boolean((state.questions || []).length);
  const hasConfirmation = Boolean(state.bookingResult);

  const steps = useMemo(
    () =>
      buildSmartCheckoutSteps({
        hasExtras,
        hasQuestions,
        hasConfirmation,
        currentStepId,
        completedStepIds
      }),
    [hasExtras, hasQuestions, hasConfirmation, currentStepId, completedStepIds]
  );

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
    navigate(`/tours/${slug}${query ? `?${query}` : ""}`);
  }, [buildTripDetailsQuery, navigate, slug]);

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
        pax: overrides.pax ?? state.pax,
        priceCategoryParticipants:
          overrides.priceCategoryParticipants ?? state.priceCategoryParticipants ?? [],
        extras: overrides.extras ?? state.extras ?? [],
        promoCode: overrides.promoCode ?? state.promoCode ?? ""
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
          sourceChannel: "direct_website"
        });

        updateFlow({
          quote,
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
    [buildBookingPayload, updateFlow]
  );

  const initializeCheckout = useCallback(async () => {
    setInitLoading(true);
    setError("");

    try {
      const tourData = await fetchTourBySlug(slug);
      setTour(tourData);

      const session = readBookingSession();
      const sessionValid = hasCompleteTripDetails(session, slug);
      const seededTrip = sessionValid
        ? {
            optionId: String(session?.tripDetails?.optionId || ""),
            travelDate: String(session?.tripDetails?.travelDate || ""),
            startTime: String(session?.tripDetails?.startTime || ""),
            rateId: String(session?.tripDetails?.rateId || ""),
            participants: normalizeParticipants(session?.tripDetails?.passengers || []),
            pax: session?.tripDetails?.pax || buildPaxFromParticipants(session?.tripDetails?.passengers || [])
          }
        : querySeed;

      if (!seededTrip.optionId || !seededTrip.travelDate) {
        throw new Error("Trip details are missing. Please select option, date, and passengers from product page.");
      }

      const selectedOption =
        (tourData.options || []).find(
          (option) => String(option?.bokunOptionId || "") === String(seededTrip.optionId || "")
        ) || null;

      if (!selectedOption) {
        throw new Error("Selected option is not available anymore. Please reselect trip details.");
      }

      const defaultCatalog = resolveDefaultCatalog(tourData.priceCatalogs || [], seededTrip.rateId);
      const initialRateId = String(seededTrip.rateId || defaultCatalog.id || "").trim();
      const initialParticipants = normalizeParticipants(seededTrip.participants || []);
      const initialPax = initialParticipants.length
        ? buildPaxFromParticipants(initialParticipants)
        : seededTrip.pax || { adults: 2, children: 0, infants: 0 };

      hydrateFlow({
        selectedProduct: {
          productId: tourData.bokunProductId,
          slug: tourData.slug,
          title: tourData.title
        },
        option: selectedOption,
        priceCatalogId: initialRateId,
        priceCatalog: resolveCatalogById(tourData.priceCatalogs || [], initialRateId) || defaultCatalog.catalog,
        travelDate: seededTrip.travelDate,
        startTime: seededTrip.startTime || "",
        pax: initialPax,
        priceCategoryParticipants: initialParticipants,
        extras: [],
        questions: [],
        answers: [],
        quote: null,
        bookingResult: null,
        tripDetailsCompleted: true,
        availabilityChecked: false,
        sourceChannel: "direct_website"
      });

      const availabilityPayload = {
        productId: tourData.bokunProductId,
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
        resolveCatalogById(tourData.priceCatalogs || [], resolvedCatalogId) ||
        defaultCatalog.catalog;

      const seededExtras = mapSessionExtrasToAvailability(
        session?.selectedExtras || [],
        availabilityResult?.extras || []
      );

      const quotePayload = {
        ...availabilityPayload,
        startTime: availabilityResult?.startTime || seededTrip.startTime || "",
        priceCatalogId: resolvedCatalogId,
        priceCategoryParticipants: syncedParticipants,
        pax: syncedPax,
        extras: seededExtras
      };

      const [quoteResult, questionsResult] = await Promise.all([
        createQuote({
          ...quotePayload,
          sourceChannel: "direct_website"
        }),
        fetchBookingQuestions({
          productId: tourData.bokunProductId,
          optionId: selectedOption.bokunOptionId,
          travelDate: seededTrip.travelDate
        }).catch(() => [])
      ]);

      const firstActionableStep = resolveFirstActionableStepId({
        hasExtras: Boolean((availabilityResult?.extras || []).length),
        hasQuestions: Boolean((questionsResult || []).length)
      });

      updateFlow({
        priceCatalogId: resolvedCatalogId,
        priceCatalog: resolvedCatalog || null,
        startTime: quotePayload.startTime || "",
        pax: syncedPax,
        priceCategoryParticipants: syncedParticipants,
        extras: quoteResult?.extras || seededExtras,
        quote: quoteResult,
        questions: questionsResult || [],
        availabilityChecked: true
      });

      setCompletedStepIds([STEP_IDS.TRIP_DETAILS]);
      setCurrentStepId(firstActionableStep);

      saveBookingSession({
        source: "single_product_page",
        product: {
          productId: tourData.bokunProductId,
          slug: tourData.slug,
          title: tourData.title
        },
        tripDetails: {
          optionId: selectedOption.bokunOptionId,
          optionTitle: selectedOption.name || "",
          rateId: resolvedCatalogId,
          rateTitle: resolvedCatalog?.title || "",
          travelDate: seededTrip.travelDate,
          startTime: quotePayload.startTime || "",
          passengers: syncedParticipants,
          pax: syncedPax
        },
        selectedExtras: quoteResult?.extras || seededExtras,
        availabilityQuote: quoteResult,
        tripDetailsCompleted: true,
        availabilityChecked: true
      });
    } catch (err) {
      setError(err.message || "Failed to initialize smart checkout");
    } finally {
      setInitLoading(false);
      setAvailabilityLoading(false);
    }
  }, [slug, querySeed, hydrateFlow, updateFlow]);

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

  const handleQuestionsContinue = () => {
    markStepCompleted(STEP_IDS.QUESTIONS);
    handleGoNext();
  };

  const handleCustomerContinue = async () => {
    const quote = await refreshLiveQuote();
    if (!quote) {
      return;
    }

    markStepCompleted(STEP_IDS.CUSTOMER);
    handleGoNext();
  };

  const handleCreateBooking = async () => {
    const payload = buildBookingPayload();
    if (!payload || !state.quote?.quoteToken) {
      setError("Missing live quote token. Please refresh quote and try again.");
      return;
    }

    setSubmitLoading(true);
    setError("");

    try {
      const totalAmount = Number(
        state.quote?.pricing?.finalPayable ??
          state.quote?.pricing?.grossAmount ??
          0
      );
      const currency = state.quote?.pricing?.currency || "USD";

      const result = await createPesapalPayment({
        ...payload,
        quoteToken: state.quote.quoteToken,
        bookingQuestions: state.answers,
        customer: state.customer,
        paymentMethod: "pesapal",
        amount: totalAmount,
        currency
      });

      saveBookingSession({
        ...(readBookingSession() || {}),
        payment: {
          provider: "pesapal",
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
        navigate(`/my-booking/${result.bookingReference}`);
        clearBookingSession();
      } else {
        throw new Error("Payment redirect URL was not returned.");
      }
    } catch (err) {
      setError(err.message || "Pesapal payment could not be initialized");
      setSubmitLoading(false);
      return;
    } finally {
      // Keep loading state active when browser is redirecting to Pesapal.
      if (!document.hidden) {
        setSubmitLoading(false);
      }
    }
  };

  const handleInitializerError = (err) => {
    setError(err?.message || "Could not initialize checkout");
    setInitLoading(false);
  };

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

    if (currentStepId === STEP_IDS.QUESTIONS) {
      return (
        <BookingQuestionsStep
          questions={state.questions || []}
          answers={state.answers || []}
          setAnswers={(next) => {
            const value = typeof next === "function" ? next(state.answers || []) : next;
            updateFlow({ answers: value });
          }}
          pax={state.pax}
          priceCategoryParticipants={state.priceCategoryParticipants}
          onBack={hasExtras ? handleGoPrevious : handleChangeTripDetails}
          onNext={handleQuestionsContinue}
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
          onBack={hasQuestions || hasExtras ? handleGoPrevious : handleChangeTripDetails}
          onNext={handleCustomerContinue}
        />
      );
    }

    if (currentStepId === STEP_IDS.REVIEW) {
      return (
        <ReviewConfirmStep
          flowState={state}
          submitting={submitLoading}
          onBack={handleGoPrevious}
          onConfirm={handleCreateBooking}
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
              <Button type="button" className="premium-btn text-white" onClick={() => navigate(`/tours/${slug}`)}>
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
      stepper={<BookingStepper steps={steps} />}
      left={
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
      }
      right={
        <>
          <BookingSummarySidebar
            flowState={state}
            tour={tour}
            availability={availability}
            quoteLoading={quoteLoading}
            availabilityLoading={availabilityLoading}
            onChangeTripDetails={handleChangeTripDetails}
          />

          {state.bookingResult ? (
            <Card className="surface-card mt-3">
              <Card.Body>
                <h6 className="mb-2">Next</h6>
                <Button
                  type="button"
                  variant="outline-info"
                  className="w-100"
                  onClick={() => navigate(`/my-booking/${state.bookingResult.bookingReference}`)}
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

const BookingFlowPage = () => (
  <BookingFlowProvider>
    <BookingFlowInner />
  </BookingFlowProvider>
);

export default BookingFlowPage;
