import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchTourBySlug } from "../../api/toursApi";
import { createQuote, fetchAvailability, fetchBookingQuestions } from "../../api/bookingsApi";
import { fetchBokunPickupPlaces, fetchBokunProductDetails } from "../../api/bokunApi";
import { createDpoPayment, createPaypalPayment, createPesapalPayment } from "../../api/paymentsApi";
import { captureMarketingLead } from "../../api/marketingApi";
import { usePaymentProviders } from "../../context/PaymentProvidersContext";
import { clearBookingSession, readBookingSession, saveBookingSession } from "../../utils/bookingSession";
import { buildMarketingContext } from "../../utils/marketingAttribution";
import { buildPesapalProcessingPath } from "../../utils/pesapalProcessing";
import { trackAnalyticsEvent } from "../../utils/analytics";
import { pickupAreaFromOption, pickupPlacesForOption } from "../../utils/pickupPlaces";
import {
  buildPaxFromParticipants,
  decodeJsonMaybe,
  mapSessionExtrasToAvailability,
  markFallbackPickupPlaces,
  markProductPickupPlaces,
  mergeLivePickupDetails,
  normalizeParticipants,
  resolveCatalogById,
  resolveDefaultCatalog,
  resolveLiveStartTimeId,
  syncParticipantsWithCategories
} from "../../utils/checkoutParticipants";
import {
  findQuestionAnswer,
  getMissingRequiredQuestionLabels,
  isCustomerManagedQuestion,
  isSystemManagedQuestion,
  normalizeQuestionScope
} from "../../utils/bookingQuestions";
import { displayOptionName } from "../tours/tourPage/bookingHelpers";
import { bookingNotes, contactErrors, paymentChoices, pickupLabel } from "./checkoutData";
import { defaultPhoneCountry, validatePhone } from "./phone";

const SOURCE_CHANNEL = "direct_website";
const SESSION_SOURCE = "single_product_page";
const FORM_KEY = (slug) => `riser_checkout_form_v1:${slug}`;

const emptyForm = () => ({
  firstName: "",
  lastName: "",
  email: "",
  phoneCountry: defaultPhoneCountry(),
  phoneNational: "",
  marketingConsent: false,
  hotelQuery: "",
  hotelName: "",
  pickupPlaceId: "",
  hotelNotListed: false,
  roomNumber: "",
  language: "",
  notes: ""
});

const readSavedForm = (slug) => {
  try {
    return JSON.parse(sessionStorage.getItem(FORM_KEY(slug)) || "null");
  } catch {
    return null;
  }
};

const itemFor = (tour) => [{ item_id: String(tour?.bokunProductId || ""), item_name: tour?.title || "", quantity: 1 }];

// The trip chosen on the tour page: from the booking session when it matches the link, otherwise from the link.
const readSeed = (slug, searchParams) => {
  const fromQuery = {
    optionId: String(searchParams.get("option") || "").trim(),
    travelDate: String(searchParams.get("date") || "").trim(),
    startTime: String(searchParams.get("time") || "").trim(),
    startTimeId: "",
    rateId: String(searchParams.get("catalog") || "").trim(),
    participants: normalizeParticipants(decodeJsonMaybe(searchParams.get("passengers") || "") || [])
  };
  const adults = Number.parseInt(searchParams.get("adults") || "", 10);
  const session = readBookingSession();
  const trip = session?.product?.slug === slug ? session.tripDetails || {} : null;
  const sessionMatches =
    trip &&
    String(trip.optionId || "") &&
    (!fromQuery.optionId || String(trip.optionId) === fromQuery.optionId) &&
    (!fromQuery.travelDate || String(trip.travelDate) === fromQuery.travelDate);
  const seed = sessionMatches
    ? {
        optionId: String(trip.optionId || ""),
        optionTitle: String(trip.optionTitle || ""),
        travelDate: String(trip.travelDate || ""),
        startTime: String(trip.startTime || fromQuery.startTime || ""),
        startTimeId: String(trip.startTimeId || ""),
        rateId: String(trip.rateId || fromQuery.rateId || ""),
        participants: normalizeParticipants(trip.passengers || []),
        total: Number(session.availabilityQuote?.total) > 0 ? Number(session.availabilityQuote.total) : null,
        currency: session.availabilityQuote?.currency || session.currency || "USD",
        title: session.product?.title || ""
      }
    : { ...fromQuery, optionTitle: "", total: null, currency: "USD", title: "" };
  const pax = seed.participants.length
    ? buildPaxFromParticipants(seed.participants)
    : { adults: Number.isFinite(adults) ? Math.max(1, adults) : 2, children: 0, infants: 0 };
  return { ...seed, pax, marketing: session?.marketing || buildMarketingContext(searchParams.toString()) };
};

// Everything the checkout page needs: the trip and live quote, the guest's form, pickup places, extra questions,
// payment choices and the pay action (the same create-payment and redirect flow as before).
const useCheckout = () => {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { availableProviders, loading: providersLoading } = usePaymentProviders();
  const seed = useMemo(() => readSeed(slug, searchParams), [slug, searchParams]);
  const tripKey = `${seed.optionId}|${seed.travelDate}|${seed.startTime}`;
  const saved = useMemo(() => readSavedForm(slug), [slug]);

  const [tour, setTour] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [trip, setTrip] = useState(() => ({
    option: null,
    priceCatalogId: seed.rateId,
    travelDate: seed.travelDate,
    startTime: seed.startTime,
    startTimeId: seed.startTimeId,
    pax: seed.pax,
    participants: seed.participants,
    extras: []
  }));
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [priceNotice, setPriceNotice] = useState("");
  const [soldOut, setSoldOut] = useState(false);
  const [pickupPlaces, setPickupPlaces] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState(() => (Array.isArray(saved?.answers) ? saved.answers : []));
  const [form, setForm] = useState(() => ({ ...emptyForm(), ...(saved?.form || {}) }));
  const [completed, setCompleted] = useState(() => (saved?.tripKey === tripKey && saved?.completed) || {});
  const [method, setMethod] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState("");
  const [fallbackMethod, setFallbackMethod] = useState("");
  const submittingRef = useRef(false);
  const shownTotal = useRef(seed.total);
  const beganCheckout = useRef(false);

  // Form progress survives a refresh (never payment details).
  useEffect(() => {
    try {
      sessionStorage.setItem(FORM_KEY(slug), JSON.stringify({ form, answers, completed, tripKey }));
    } catch {
      // Storage can be unavailable (private mode); the form still works.
    }
  }, [slug, form, answers, completed, tripKey]);

  const setField = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  const buildPayload = useCallback(
    (current = trip, productId = tour?.bokunProductId) => {
      if (!productId || !current.option?.bokunOptionId || !current.travelDate) return null;
      const payload = {
        productId,
        optionId: current.option.bokunOptionId,
        travelDate: current.travelDate,
        startTime: current.startTime,
        startTimeId: current.startTimeId || "",
        pax: current.pax,
        priceCategoryParticipants: current.participants || [],
        extras: current.extras || [],
        promoCode: "",
        marketing: seed.marketing || {}
      };
      if (current.priceCatalogId) payload.priceCatalogId = current.priceCatalogId;
      return payload;
    },
    [trip, tour?.bokunProductId, seed.marketing]
  );

  // A new quote; tells the guest when the total differs from the one they saw.
  const applyQuote = useCallback((next) => {
    const total = Number(next?.pricing?.finalPayable || 0);
    const previous = shownTotal.current;
    if (previous && total && Math.abs(previous - total) > 0.004) {
      const currency = next.pricing.currency || "USD";
      const format = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
      setPriceNotice(`The price for your date changed from ${format(previous)} to ${format(total)}.`);
    }
    if (total) shownTotal.current = total;
    setQuote(next);
  }, []);

  // Loads the tour (instant when the tour page already has it), then live availability, the quote and pickup places.
  useEffect(() => {
    let active = true;
    setLoadError("");
    (async () => {
      try {
        const tourData = await fetchTourBySlug(slug);
        if (!active) return;
        const option = (tourData.options || []).find((item) => String(item?.bokunOptionId || "") === seed.optionId) || null;
        if (!seed.optionId || !seed.travelDate) throw new Error("Choose your date and option on the tour page first.");
        if (!option) throw new Error("This option is no longer available. Please choose your trip again.");
        setTour(tourData);
        const defaultCatalog = resolveDefaultCatalog(tourData.priceCatalogs || [], seed.rateId);
        const rateId = String(seed.rateId || defaultCatalog.id || "").trim();
        const baseTrip = { option, priceCatalogId: rateId, travelDate: seed.travelDate, startTime: seed.startTime, startTimeId: seed.startTimeId, pax: seed.pax, participants: seed.participants, extras: [] };
        setTrip(baseTrip);

        // Pickup places in the background: the live product's list, or every Zanzibar pickup point when it has none.
        (async () => {
          const live = await fetchBokunProductDetails(tourData.bokunProductId, { forceRefresh: true }).catch(() => null);
          const merged = mergeLivePickupDetails(tourData, live);
          const own = markProductPickupPlaces(merged.pickupPlaces || []);
          const places = own.length ? own : markFallbackPickupPlaces(await fetchBokunPickupPlaces({ limit: 900 }).catch(() => []));
          if (active) setPickupPlaces(places);
        })();

        const availability = await fetchAvailability({ ...buildPayload(baseTrip, tourData.bokunProductId), extras: [] });
        if (!active) return;
        const slots = Array.isArray(availability?.slots) ? availability.slots : [];
        const slot = slots.find((item) => String(item?.time || "") === seed.startTime);
        if (availability?.available === false || (seed.startTime && slots.length && (!slot || slot.status === "sold_out" || Number(slot.capacityLeft) === 0))) {
          setSoldOut(true);
        }
        const participants = syncParticipantsWithCategories(seed.participants, availability?.priceCategories || []);
        const catalogId = String(availability?.priceCatalog?.catalogId || rateId || "").trim();
        const session = readBookingSession();
        const liveTrip = {
          ...baseTrip,
          priceCatalogId: catalogId,
          startTimeId: resolveLiveStartTimeId({ slots, startTime: seed.startTime, fallbackId: seed.startTimeId }),
          participants,
          pax: participants.length ? buildPaxFromParticipants(participants) : seed.pax,
          extras: mapSessionExtrasToAvailability(session?.selectedExtras || [], availability?.extras || [])
        };
        const quoteResult = await createQuote({ ...buildPayload(liveTrip, tourData.bokunProductId), sourceChannel: SOURCE_CHANNEL });
        if (!active) return;
        const synced = normalizeParticipants(quoteResult?.priceCategoryParticipants || participants);
        const quotedTrip = { ...liveTrip, participants: synced, pax: synced.length ? buildPaxFromParticipants(synced) : liveTrip.pax, extras: quoteResult?.extras || liveTrip.extras };
        setTrip(quotedTrip);
        applyQuote(quoteResult);
        setQuoteLoading(false);

        if (!beganCheckout.current) {
          beganCheckout.current = true;
          trackAnalyticsEvent("begin_checkout", { currency: quoteResult?.pricing?.currency || "USD", value: Number(quoteResult?.pricing?.finalPayable || 0), items: itemFor(tourData) });
        }
        saveBookingSession({
          ...(session || {}),
          source: SESSION_SOURCE,
          product: { productId: tourData.bokunProductId, slug: tourData.slug, title: tourData.title },
          tripDetails: {
            ...(session?.tripDetails || {}),
            optionId: option.bokunOptionId,
            optionTitle: option.name || "",
            rateId: catalogId,
            rateTitle: resolveCatalogById(tourData.priceCatalogs || [], catalogId)?.title || "",
            travelDate: seed.travelDate,
            startTime: seed.startTime,
            startTimeId: quotedTrip.startTimeId,
            passengers: synced,
            pax: quotedTrip.pax
          },
          selectedExtras: quotedTrip.extras,
          availabilityQuote: { ...(session?.availabilityQuote || {}), total: Number(quoteResult?.pricing?.finalPayable || 0), currency: quoteResult?.pricing?.currency || "USD" },
          marketing: seed.marketing,
          tripDetailsCompleted: true,
          availabilityChecked: true
        });

        try {
          const result = await fetchBookingQuestions({ ...buildPayload(quotedTrip, tourData.bokunProductId), customer: {} });
          if (active) setQuestions(result || []);
        } catch (questionError) {
          // Payment runs the same supplier-side check, so a failed lookup cannot create an invalid booking.
          console.warn("Unable to prefetch booking questions", questionError);
        }
      } catch (error) {
        if (!active) return;
        setQuoteLoading(false);
        setLoadError(error.message || "We could not load this booking. Please try again.");
      }
    })();
    return () => {
      active = false;
    };
    // The trip is read once per link; buildPayload and applyQuote only read stable values here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, tripKey]);

  const refreshQuote = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) return null;
    setQuoteLoading(true);
    try {
      const next = await createQuote({ ...payload, sourceChannel: SOURCE_CHANNEL });
      const synced = normalizeParticipants(next?.priceCategoryParticipants || payload.priceCategoryParticipants);
      setTrip((current) => ({ ...current, participants: synced, pax: synced.length ? buildPaxFromParticipants(synced) : current.pax, extras: next?.extras || current.extras }));
      applyQuote(next);
      return next;
    } catch (error) {
      setPayError(error.message || "We could not check the latest price. Please try again.");
      return null;
    } finally {
      setQuoteLoading(false);
    }
  }, [buildPayload, applyQuote]);

  // Pickup: only the hotels in the chosen option's area (no duplicates); the option's meeting point when it has no pickup.
  const optionName = trip.option?.name || seed.optionTitle;
  const pickupArea = pickupAreaFromOption(optionName);
  const hasPickup = trip.option ? trip.option.pickupSupported !== false : true;
  const hotels = useMemo(() => (pickupPlaces ? pickupPlacesForOption(pickupPlaces, optionName) : null), [pickupPlaces, optionName]);
  const meetingPoint = String(tour?.meetingInfo || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const languages = useMemo(() => {
    const fromOption = String(trip.option?.language || "").trim();
    const list = fromOption ? [fromOption] : tour?.liveTourGuide?.languages?.length ? tour.liveTourGuide.languages : tour?.languages || [];
    return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))];
  }, [trip.option?.language, tour]);
  const language = languages.includes(form.language) ? form.language : languages[0] || "";

  const phone = useMemo(() => validatePhone(form.phoneNational, form.phoneCountry), [form.phoneNational, form.phoneCountry]);
  const customer = useMemo(
    () => ({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: phone.e164,
      country: phone.country || form.phoneCountry,
      hotelName: hasPickup ? (form.hotelNotListed ? String(form.hotelQuery || "").trim() || "To be sent on WhatsApp" : form.hotelName) : "",
      pickupPlaceId: hasPickup && !form.hotelNotListed ? form.pickupPlaceId : "",
      notes: bookingNotes({ ...form, language }, { languageChoosable: languages.length > 1 }),
      marketingConsent: Boolean(form.marketingConsent)
    }),
    [form, phone, hasPickup, language, languages.length]
  );

  // Extra questions the product asks that the form does not already cover.
  const extraQuestions = useMemo(
    () =>
      (questions || []).filter((question) => {
        const scope = normalizeQuestionScope(question.scope);
        return question?.required && scope !== "passenger" && !isSystemManagedQuestion(question) && !isCustomerManagedQuestion(question);
      }),
    [questions]
  );
  const answerFor = useCallback((question) => findQuestionAnswer(answers, question)?.answer || "", [answers]);
  const setAnswer = useCallback((question, answer) => {
    const questionId = String(question.questionId || question.id || "");
    if (!questionId) return;
    const scope = normalizeQuestionScope(question.scope);
    setAnswers((current) => [
      ...(current || []).filter((item = {}) => !(String(item.questionId || "") === questionId && normalizeQuestionScope(item.scope) === scope)),
      { questionId, label: question.label || "Additional information", scope, answer }
    ]);
  }, []);

  const errorsFor = useCallback(
    (step) => {
      if (step === "contact") return contactErrors(form, phone);
      if (step === "activity") {
        const errors = {};
        if (hasPickup && !form.hotelNotListed && !String(form.hotelName || "").trim()) errors.hotel = "Choose your hotel, or tell us it isn't listed";
        for (const question of extraQuestions) {
          if (!String(answerFor(question) || "").trim()) errors[`q:${question.questionId || question.id}`] = `Please answer: ${question.label || "this question"}`;
        }
        return errors;
      }
      return {};
    },
    [form, phone, hasPickup, extraQuestions, answerFor]
  );

  const completeContact = useCallback(() => {
    if (form.phoneNational && phone.valid && phone.country && phone.country !== form.phoneCountry) setField("phoneCountry", phone.country);
    setCompleted((current) => ({ ...current, contact: true }));
    const total = Number(quote?.pricing?.finalPayable || 0);
    const currency = quote?.pricing?.currency || "USD";
    void captureMarketingLead({
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      stage: "checkout_customer",
      source: SOURCE_CHANNEL,
      newsletterConsent: customer.marketingConsent,
      recoveryConsent: customer.marketingConsent,
      context: { productSlug: tour?.slug || "", optionId: trip.option?.bokunOptionId || "", travelDate: trip.travelDate || "", amount: total, currency }
    }).catch(() => null);
    trackAnalyticsEvent("add_contact_info", { currency, value: total, items: itemFor(tour) });
  }, [form.phoneNational, form.phoneCountry, phone, setField, quote, customer, tour, trip.option, trip.travelDate]);

  // Activity done: re-check the live price (the quote is signed and expires) before payment opens.
  const completeActivity = useCallback(async () => {
    const next = await refreshQuote();
    if (!next) return false;
    setCompleted((current) => ({ ...current, activity: true }));
    trackAnalyticsEvent("add_pickup_info", { currency: next?.pricing?.currency || "USD", value: Number(next?.pricing?.finalPayable || 0), items: itemFor(tour) });
    return true;
  }, [refreshQuote, tour]);

  const choices = useMemo(() => paymentChoices(availableProviders.map((provider) => provider.id)), [availableProviders]);
  const selectedChoice = choices.find((choice) => choice.id === method) || choices[0] || null;

  // Pays through the chosen provider: create the booking and payment, then go to the provider's page.
  // Returns "contact" / "activity" when a step needs the guest again.
  const pay = useCallback(async ({ providerOverride = "" } = {}) => {
    if (submittingRef.current || !selectedChoice) return null;
    const provider = providerOverride || selectedChoice.provider;
    submittingRef.current = true;
    setSubmitting(true);
    setPayError("");
    setFallbackMethod("");
    try {
      let current = quote;
      const expired = current?.quoteExpiresAt && new Date(current.quoteExpiresAt).getTime() - Date.now() < 60 * 1000;
      if (!current?.quoteToken || expired) {
        const before = Number(current?.pricing?.finalPayable || 0);
        current = await refreshQuote();
        if (!current) return null;
        // A new total is shown first; the guest presses Pay again for the amount they can see.
        if (before && Math.abs(before - Number(current.pricing?.finalPayable || 0)) > 0.004) return null;
      }
      const payload = buildPayload();
      const amount = Number(current.pricing?.finalPayable ?? current.pricing?.grossAmount ?? 0);
      const currency = current.pricing?.currency || "USD";
      const createPayment = provider === "dpo" ? createDpoPayment : provider === "paypal" ? createPaypalPayment : createPesapalPayment;
      const result = await createPayment({
        ...payload,
        quoteToken: current.quoteToken,
        bookingQuestions: answers,
        customer,
        sourceChannel: SOURCE_CHANNEL,
        paymentMethod: provider,
        amount,
        currency
      });

      trackAnalyticsEvent("add_payment_info", { currency, value: amount, payment_type: provider, items: itemFor(tour) });
      void captureMarketingLead({
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        stage: "checkout_payment_started",
        source: SOURCE_CHANNEL,
        newsletterConsent: customer.marketingConsent,
        recoveryConsent: customer.marketingConsent,
        context: { bookingReference: result.bookingReference || "", productSlug: tour?.slug || "", amount, currency }
      }).catch(() => null);
      saveBookingSession({
        ...(readBookingSession() || {}),
        payment: { provider, bookingId: result.bookingId || "", bookingReference: result.bookingReference || "", initiatedAt: new Date().toISOString() }
      });

      if (result.redirectUrl) {
        if (provider === "pesapal") navigate(buildPesapalProcessingPath(result));
        else window.location.assign(result.redirectUrl);
        return "redirect";
      }
      if (result.bookingReference) {
        clearBookingSession();
        navigate(`/my-booking/${result.bookingReference}`);
        return "redirect";
      }
      throw new Error("The payment page did not open. Please try again.");
    } catch (error) {
      if (error.code === "BOKUN_REQUIRED_ANSWERS") {
        const required = Array.isArray(error.details?.questions) ? error.details.questions : [];
        if (required.length) setQuestions(required);
        const labels = (error.details?.missingQuestions || []).map((question) => String(question?.label || "").trim()).filter(Boolean);
        setPayError(labels.length ? `Please complete: ${labels.join(", ")}.` : "Please complete the extra details this tour needs.");
        return "activity";
      }
      setPayError(error.message || "The payment could not be started. Please try again.");
      const other = choices.find((choice) => choice.provider !== provider);
      setFallbackMethod(other?.id || "");
      return null;
    } finally {
      submittingRef.current = false;
      // Keep the button busy while the browser leaves for the payment page.
      if (!document.hidden) setSubmitting(false);
    }
  }, [selectedChoice, quote, refreshQuote, buildPayload, answers, customer, tour, navigate, choices]);

  const missingAnswers = getMissingRequiredQuestionLabels({ questions, answers, customer });
  const pricing = quote?.pricing || null;
  const total = pricing ? Number(pricing.finalPayable || 0) : seed.total;
  const currency = pricing?.currency || seed.currency || tour?.currency || "USD";

  // Back to the tour page with the same option, date, time and travellers.
  const tourHref = useMemo(() => {
    const query = new URLSearchParams();
    if (trip.option?.bokunOptionId || seed.optionId) query.set("option", String(trip.option?.bokunOptionId || seed.optionId));
    if (trip.travelDate) query.set("date", trip.travelDate);
    if (trip.startTime) query.set("time", trip.startTime);
    const passengers = (trip.participants || [])
      .filter((row) => Number(row.quantity) > 0)
      .map((row) => ({ pricingCategoryId: row.categoryId, quantity: row.quantity }));
    if (passengers.length) query.set("passengers", JSON.stringify(passengers));
    return `/tours/${slug}?${query.toString()}`;
  }, [slug, trip, seed.optionId]);

  return {
    slug,
    tour,
    loadError,
    title: tour?.title || seed.title,
    optionName: displayOptionName(optionName),
    trip,
    tourHref,
    quoteLoading,
    pricing,
    total,
    currency,
    cancellationPolicy: quote?.cancellationPolicy || null,
    priceNotice,
    dismissPriceNotice: () => setPriceNotice(""),
    soldOut,
    form,
    setField,
    phone,
    customer,
    errorsFor,
    completed,
    completeContact,
    completeActivity,
    hasPickup,
    pickupArea,
    hotels,
    pickupLabel,
    pickupFallback: Boolean(pickupPlaces?.length && pickupPlaces[0]?.productScoped === false),
    meetingPoint,
    languages,
    language,
    extraQuestions,
    answerFor,
    setAnswer,
    missingAnswers,
    choices,
    selectedChoice,
    setMethod: (id) => {
      setMethod(id);
      setPayError("");
      setFallbackMethod("");
    },
    providersLoading,
    pay,
    submitting,
    payError,
    fallbackChoice: choices.find((choice) => choice.id === fallbackMethod) || null
  };
};

export default useCheckout;
