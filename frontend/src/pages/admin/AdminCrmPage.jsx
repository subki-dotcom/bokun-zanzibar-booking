import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsBell, BsClipboard2Check, BsGraphUpArrow, BsJournalCheck, BsPeople, BsReceipt, BsShieldCheck } from "react-icons/bs";
import { useLocation } from "react-router-dom";
import {
  acceptCrmQuote,
  approveCrmQuote,
  completeCrmFollowUp,
  completeCrmTask,
  createCrmB2BPartner,
  createCrmFollowUp,
  createCrmLead,
  createCrmOpportunity,
  createCrmQuote,
  createCrmTask,
  convertCrmQuoteToBooking,
  fetchCrmB2BPartners,
  fetchCrmCustomers,
  fetchCrmDashboard,
  fetchCrmCustomerTimeline,
  fetchCrmDuplicateCandidates,
  fetchCrmFollowUps,
  fetchCrmLeads,
  fetchCrmOpportunities,
  fetchCrmPipeline,
  fetchCrmQuotes,
  fetchCrmTasks,
  logCrmCustomerCommunication,
  sendCrmQuote,
  updateCrmB2BPartner,
  updateCrmFollowUp,
  updateCrmLead,
  updateCrmOpportunity,
  updateCrmQuote,
  updateCrmTask
} from "../../api/adminApi";
import { AdminMetricCard, StatusBadge, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const modeFromPath = (pathname = "") => {
  if (pathname.includes("b2b-agents")) return "b2bAgents";
  if (pathname.includes("pipeline")) return "pipeline";
  if (pathname.includes("follow-ups")) return "followUps";
  if (pathname.includes("tasks")) return "tasks";
  if (pathname.includes("quotes")) return "quotes";
  if (pathname.includes("opportunities")) return "opportunities";
  if (pathname.includes("leads")) return "leads";
  if (pathname.includes("duplicates")) return "duplicates";
  if (pathname.includes("customers")) return "customers";
  return "dashboard";
};

const leadStatuses = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED", "LOST", "ARCHIVED"];
const leadSources = [
  "WEBSITE",
  "WHATSAPP",
  "EMAIL",
  "PHONE",
  "WALK_IN",
  "VIATOR_INQUIRY",
  "GETYOURGUIDE_INQUIRY",
  "HOTEL",
  "AGENT",
  "B2B",
  "SOCIAL_MEDIA",
  "REFERRAL",
  "OTHER"
];
const opportunityStages = [
  "NEW",
  "QUALIFIED",
  "NEEDS_ANALYSIS",
  "QUOTE_PREPARATION",
  "QUOTE_SENT",
  "NEGOTIATION",
  "AWAITING_CUSTOMER",
  "READY_TO_BOOK",
  "WON",
  "LOST"
];
const quoteStatuses = [
  "DRAFT",
  "INTERNAL_REVIEW",
  "APPROVED",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CONVERTED",
  "CANCELLED"
];
const quoteLineItemTypes = [
  "BOKUN_PRODUCT",
  "CUSTOM_SERVICE",
  "TRANSFER",
  "TOUR",
  "SAFARI",
  "ACCOMMODATION",
  "ADD_ON",
  "DISCOUNT",
  "OTHER_SERVICE"
];
const followUpTypes = [
  "CALL",
  "WHATSAPP",
  "EMAIL",
  "QUOTE_FOLLOW_UP",
  "PAYMENT_FOLLOW_UP",
  "DECISION_FOLLOW_UP",
  "POST_TRIP_FOLLOW_UP",
  "CUSTOM"
];
const followUpStatuses = ["PENDING", "COMPLETED", "MISSED", "CANCELLED"];
const communicationChannels = ["EMAIL", "WHATSAPP", "PHONE", "SMS", "IN_PERSON", "OTHER"];
const communicationDirections = ["OUTBOUND", "INBOUND", "INTERNAL_NOTE"];
const crmPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
const taskStatuses = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"];
const taskRelatedEntityTypes = ["LEAD", "OPPORTUNITY", "CUSTOMER", "QUOTE", "BOOKING", "OTHER"];
const b2bPartnerTypes = ["TRAVEL_AGENT", "HOTEL", "TOUR_OPERATOR", "CORPORATE_CLIENT", "B2B_PARTNER", "OTHER"];
const b2bPartnerStatuses = [
  "PROSPECT",
  "CONTACTED",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "AGREEMENT",
  "ACTIVE_PARTNER",
  "INACTIVE",
  "LOST"
];
const b2bCommissionModels = ["NONE", "PERCENTAGE", "FIXED_AMOUNT", "NET_RATE", "CUSTOM"];
const b2bNetRateModels = ["NONE", "STANDARD_NET_RATE", "PRODUCT_SPECIFIC", "CONTRACTED", "CUSTOM"];
const lostReasons = [
  "PRICE_TOO_HIGH",
  "NO_RESPONSE",
  "CHANGED_DESTINATION",
  "BOOKED_COMPETITOR",
  "DATES_CHANGED",
  "SERVICE_UNAVAILABLE",
  "PAYMENT_ISSUE",
  "CANCELLED_TRIP",
  "OTHER"
];

const customerName = (customer = {}) =>
  customer.fullName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "-";

const duplicateName = (customer = {}) =>
  customer?.fullName || customer?.email || customer?.crmCustomerNumber || customer?._id || "-";

const leadName = (lead = {}) => lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "-";
const formatMoney = (amount = 0, currency = "USD") => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(amount || 0));
  } catch (_error) {
    return `${currency || "USD"} ${Number(amount || 0).toFixed(2)}`;
  }
};
const toIsoDateTime = (value = "") => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const emptyLeadForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  source: "WEBSITE",
  status: "NEW",
  notes: ""
};

const emptyOpportunityForm = {
  title: "",
  stage: "NEW",
  estimatedValue: "",
  currency: "USD",
  probability: "",
  expectedCloseDate: "",
  source: "WEBSITE",
  notes: "",
  lostReason: "OTHER",
  wonBokunBookingId: ""
};

const emptyQuoteForm = {
  opportunityId: "",
  customerId: "",
  currency: "USD",
  validUntil: "",
  itemType: "CUSTOM_SERVICE",
  description: "",
  productId: "",
  productOptionId: "",
  quantity: "1",
  unitPrice: "",
  discount: "",
  tax: "",
  notes: "",
  terms: ""
};

const emptyFollowUpForm = {
  leadId: "",
  opportunityId: "",
  customerId: "",
  type: "CALL",
  dueAt: "",
  priority: "NORMAL",
  notes: ""
};

const emptyTaskForm = {
  title: "",
  description: "",
  relatedEntityType: "OTHER",
  relatedEntityId: "",
  dueDate: "",
  priority: "NORMAL"
};

const emptyCommunicationForm = {
  channel: "WHATSAPP",
  direction: "OUTBOUND",
  subject: "",
  summary: "",
  note: "",
  occurredAt: ""
};

const emptyB2BPartnerForm = {
  partnerType: "TRAVEL_AGENT",
  companyName: "",
  contactPerson: "",
  email: "",
  phone: "",
  country: "",
  commissionModel: "NONE",
  commissionRate: "",
  fixedCommissionAmount: "",
  netRateModel: "NONE",
  creditLimit: "",
  currency: "USD",
  paymentTerms: "",
  status: "PROSPECT",
  notes: ""
};

const AdminCrmPage = () => {
  const location = useLocation();
  const mode = useMemo(() => modeFromPath(location.pathname), [location.pathname]);
  const [dashboard, setDashboard] = useState(null);
  const [customers, setCustomers] = useState({ items: [] });
  const [duplicates, setDuplicates] = useState({ items: [] });
  const [leads, setLeads] = useState({ items: [] });
  const [opportunities, setOpportunities] = useState({ items: [] });
  const [quotes, setQuotes] = useState({ items: [] });
  const [followUps, setFollowUps] = useState({ items: [] });
  const [tasks, setTasks] = useState({ items: [] });
  const [pipeline, setPipeline] = useState({ columns: [] });
  const [b2bPartners, setB2BPartners] = useState({ items: [] });
  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [opportunityForm, setOpportunityForm] = useState(emptyOpportunityForm);
  const [quoteForm, setQuoteForm] = useState(emptyQuoteForm);
  const [quoteConversionForms, setQuoteConversionForms] = useState({});
  const [followUpForm, setFollowUpForm] = useState(emptyFollowUpForm);
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [communicationForm, setCommunicationForm] = useState(emptyCommunicationForm);
  const [b2bPartnerForm, setB2BPartnerForm] = useState(emptyB2BPartnerForm);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerTimeline, setCustomerTimeline] = useState({ items: [] });
  const [savingLead, setSavingLead] = useState(false);
  const [savingOpportunity, setSavingOpportunity] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false);
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [savingCommunication, setSavingCommunication] = useState(false);
  const [savingB2BPartner, setSavingB2BPartner] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    setActionMessage("");

    try {
      const [
        nextDashboard,
        nextCustomers,
        nextDuplicates,
        nextLeads,
        nextOpportunities,
        nextQuotes,
        nextFollowUps,
        nextTasks,
        nextPipeline,
        nextB2BPartners
      ] = await Promise.all([
        fetchCrmDashboard(),
        mode === "dashboard" || mode === "customers" ? fetchCrmCustomers({ limit: 50 }) : Promise.resolve({ items: [] }),
        mode === "dashboard" || mode === "duplicates" ? fetchCrmDuplicateCandidates({ status: "OPEN", limit: 50 }) : Promise.resolve({ items: [] }),
        mode === "leads" ? fetchCrmLeads({ limit: 50 }) : Promise.resolve({ items: [] }),
        mode === "opportunities" ? fetchCrmOpportunities({ limit: 50 }) : Promise.resolve({ items: [] }),
        mode === "quotes" ? fetchCrmQuotes({ limit: 50 }) : Promise.resolve({ items: [] }),
        mode === "followUps" ? fetchCrmFollowUps({ limit: 50 }) : Promise.resolve({ items: [] }),
        mode === "tasks" ? fetchCrmTasks({ limit: 50 }) : Promise.resolve({ items: [] }),
        mode === "pipeline" ? fetchCrmPipeline({ limitPerStage: 20, includeClosed: true }) : Promise.resolve({ columns: [] }),
        mode === "b2bAgents" ? fetchCrmB2BPartners({ limit: 50 }) : Promise.resolve({ items: [] })
      ]);
      setDashboard(nextDashboard);
      setCustomers(nextCustomers);
      setDuplicates(nextDuplicates);
      setLeads(nextLeads);
      setOpportunities(nextOpportunities);
      setQuotes(nextQuotes);
      setFollowUps(nextFollowUps);
      setTasks(nextTasks);
      setPipeline(nextPipeline);
      setB2BPartners(nextB2BPartners);
    } catch (err) {
      setError(err.message || "Failed to load CRM");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [mode]);

  useEffect(() => {
    if (mode !== "customers") return;
    const items = customers.items || [];
    if (!items.length) {
      setSelectedCustomerId("");
      setCustomerTimeline({ items: [] });
      return;
    }
    const selectedStillExists = items.some((customer) => String(customer.id || customer._id) === String(selectedCustomerId));
    if (!selectedCustomerId || !selectedStillExists) {
      setSelectedCustomerId(items[0].id || items[0]._id || "");
    }
  }, [mode, customers, selectedCustomerId]);

  useEffect(() => {
    let cancelled = false;

    const loadTimeline = async () => {
      if (mode !== "customers" || !selectedCustomerId) {
        setCustomerTimeline({ items: [] });
        return;
      }
      setTimelineLoading(true);
      try {
        const data = await fetchCrmCustomerTimeline(selectedCustomerId, { limit: 100 });
        if (!cancelled) setCustomerTimeline(data || { items: [] });
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load customer timeline");
      } finally {
        if (!cancelled) setTimelineLoading(false);
      }
    };

    loadTimeline();
    return () => {
      cancelled = true;
    };
  }, [mode, selectedCustomerId]);

  if (loading) return <Loader message="Loading CRM..." />;

  const metrics = dashboard?.metrics || {};
  const customerItems = customers.items || [];
  const duplicateItems = duplicates.items || [];
  const leadItems = leads.items || [];
  const opportunityItems = opportunities.items || [];
  const quoteItems = quotes.items || [];
  const followUpItems = followUps.items || [];
  const taskItems = tasks.items || [];
  const pipelineColumns = pipeline.columns || [];
  const b2bPartnerItems = b2bPartners.items || [];
  const selectedCustomer = customerItems.find((customer) => String(customer.id || customer._id) === String(selectedCustomerId));
  const timelineItems = customerTimeline.items || [];
  const quoteConversionFor = (quote) => quoteConversionForms[quote.id || quote._id] || {};

  const updateLeadForm = (field, value) => {
    setLeadForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateOpportunityForm = (field, value) => {
    setOpportunityForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateQuoteForm = (field, value) => {
    setQuoteForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateQuoteConversionForm = (quoteId, field, value) => {
    setQuoteConversionForms((prev) => ({
      ...prev,
      [quoteId]: {
        ...(prev[quoteId] || {}),
        [field]: value
      }
    }));
  };

  const updateFollowUpForm = (field, value) => {
    setFollowUpForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateTaskForm = (field, value) => {
    setTaskForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateCommunicationForm = (field, value) => {
    setCommunicationForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateB2BPartnerForm = (field, value) => {
    setB2BPartnerForm((prev) => ({ ...prev, [field]: value }));
  };

  const submitLead = async (event) => {
    event.preventDefault();
    setSavingLead(true);
    setError("");
    setActionMessage("");

    try {
      const result = await createCrmLead({
        ...leadForm,
        email: leadForm.email || "",
        phone: leadForm.phone || ""
      });
      setLeadForm(emptyLeadForm);
      await load({ silent: true });
      setActionMessage(result.action === "existing" ? "Existing lead matched." : "Lead saved.");
    } catch (err) {
      setError(err.message || "Failed to save lead");
    } finally {
      setSavingLead(false);
    }
  };

  const changeLeadStatus = async (lead, status) => {
    setError("");
    setActionMessage("");
    try {
      await updateCrmLead(lead.id || lead._id, { status });
      await load({ silent: true });
      setActionMessage(`Lead ${lead.leadReference || ""} updated.`);
    } catch (err) {
      setError(err.message || "Failed to update lead status");
    }
  };

  const submitOpportunity = async (event) => {
    event.preventDefault();
    setSavingOpportunity(true);
    setError("");
    setActionMessage("");

    try {
      const payload = {
        ...opportunityForm,
        estimatedValue: opportunityForm.estimatedValue === "" ? 0 : Number(opportunityForm.estimatedValue),
        probability: opportunityForm.probability === "" ? undefined : Number(opportunityForm.probability),
        expectedCloseDate: opportunityForm.expectedCloseDate || ""
      };
      if (payload.stage !== "LOST") {
        delete payload.lostReason;
      }
      if (payload.stage !== "WON") {
        delete payload.wonBokunBookingId;
      }
      const result = await createCrmOpportunity(payload);
      setOpportunityForm(emptyOpportunityForm);
      await load({ silent: true });
      setActionMessage(result.action === "existing" ? "Existing opportunity matched." : "Opportunity saved.");
    } catch (err) {
      setError(err.message || "Failed to save opportunity");
    } finally {
      setSavingOpportunity(false);
    }
  };

  const changeOpportunityStage = async (opportunity, stage) => {
    setError("");
    setActionMessage("");
    try {
      await updateCrmOpportunity(opportunity.id || opportunity._id, { stage });
      await load({ silent: true });
      setActionMessage(`Opportunity ${opportunity.opportunityNumber || ""} updated.`);
    } catch (err) {
      setError(err.message || "Failed to update opportunity stage");
    }
  };

  const submitQuote = async (event) => {
    event.preventDefault();
    setSavingQuote(true);
    setError("");
    setActionMessage("");

    try {
      const payload = {
        opportunityId: quoteForm.opportunityId || undefined,
        customerId: quoteForm.customerId || undefined,
        currency: quoteForm.currency || "USD",
        validUntil: quoteForm.validUntil || "",
        notes: quoteForm.notes,
        terms: quoteForm.terms,
        lineItems: [
          {
            itemType: quoteForm.itemType,
            description: quoteForm.description,
            productId: quoteForm.productId,
            productOptionId: quoteForm.productOptionId,
            quantity: Number(quoteForm.quantity || 1),
            unitPrice: Number(quoteForm.unitPrice || 0),
            discount: Number(quoteForm.discount || 0),
            tax: Number(quoteForm.tax || 0)
          }
        ]
      };
      const result = await createCrmQuote(payload);
      setQuoteForm(emptyQuoteForm);
      await load({ silent: true });
      setActionMessage(`Quote ${result.quote?.quoteNumber || ""} saved.`);
    } catch (err) {
      setError(err.message || "Failed to save quote");
    } finally {
      setSavingQuote(false);
    }
  };

  const runQuoteAction = async (quote, action) => {
    setError("");
    setActionMessage("");
    try {
      const quoteId = quote.id || quote._id;
      const handlers = {
        approve: approveCrmQuote,
        send: sendCrmQuote,
        accept: acceptCrmQuote
      };
      const result = await handlers[action](quoteId);
      await load({ silent: true });
      setActionMessage(`Quote ${result.quote?.quoteNumber || quote.quoteNumber || ""} ${result.action}.`);
    } catch (err) {
      setError(err.message || "Failed to update quote");
    }
  };

  const runQuoteConversion = async (quote) => {
    setError("");
    setActionMessage("");
    try {
      const quoteId = quote.id || quote._id;
      const form = quoteConversionForms[quoteId] || {};
      const payload = {
        bookingReference: form.bookingReference || "",
        bokunBookingId: form.bokunBookingId || "",
        conversionNote: form.conversionNote || ""
      };
      const result = await convertCrmQuoteToBooking(quoteId, payload);
      setQuoteConversionForms((prev) => {
        const next = { ...prev };
        delete next[quoteId];
        return next;
      });
      await load({ silent: true });
      setActionMessage(`Quote ${result.quote?.quoteNumber || quote.quoteNumber || ""} linked to confirmed booking.`);
    } catch (err) {
      setError(err.message || "Failed to convert quote");
    }
  };

  const markQuoteInternalReview = async (quote) => {
    setError("");
    setActionMessage("");
    try {
      await updateCrmQuote(quote.id || quote._id, { status: "INTERNAL_REVIEW" });
      await load({ silent: true });
      setActionMessage(`Quote ${quote.quoteNumber || ""} moved to internal review.`);
    } catch (err) {
      setError(err.message || "Failed to update quote status");
    }
  };

  const submitFollowUp = async (event) => {
    event.preventDefault();
    setSavingFollowUp(true);
    setError("");
    setActionMessage("");

    try {
      const payload = {
        leadId: followUpForm.leadId || undefined,
        opportunityId: followUpForm.opportunityId || undefined,
        customerId: followUpForm.customerId || undefined,
        type: followUpForm.type,
        dueAt: toIsoDateTime(followUpForm.dueAt),
        priority: followUpForm.priority,
        notes: followUpForm.notes
      };
      const result = await createCrmFollowUp(payload);
      setFollowUpForm(emptyFollowUpForm);
      await load({ silent: true });
      setActionMessage(`Follow-up ${result.followUp?.type || ""} saved.`);
    } catch (err) {
      setError(err.message || "Failed to save follow-up");
    } finally {
      setSavingFollowUp(false);
    }
  };

  const completeFollowUpAction = async (followUp) => {
    setError("");
    setActionMessage("");
    try {
      await completeCrmFollowUp(followUp.id || followUp._id, { outcome: "Completed from CRM workspace." });
      await load({ silent: true });
      setActionMessage("Follow-up completed.");
    } catch (err) {
      setError(err.message || "Failed to complete follow-up");
    }
  };

  const changeFollowUpStatus = async (followUp, status) => {
    setError("");
    setActionMessage("");
    try {
      await updateCrmFollowUp(followUp.id || followUp._id, { status });
      await load({ silent: true });
      setActionMessage("Follow-up updated.");
    } catch (err) {
      setError(err.message || "Failed to update follow-up");
    }
  };

  const submitTask = async (event) => {
    event.preventDefault();
    setSavingTask(true);
    setError("");
    setActionMessage("");

    try {
      const payload = {
        ...taskForm,
        relatedEntityId: taskForm.relatedEntityId || "",
        dueDate: toIsoDateTime(taskForm.dueDate)
      };
      const result = await createCrmTask(payload);
      setTaskForm(emptyTaskForm);
      await load({ silent: true });
      setActionMessage(`Task ${result.task?.title || ""} saved.`);
    } catch (err) {
      setError(err.message || "Failed to save task");
    } finally {
      setSavingTask(false);
    }
  };

  const completeTaskAction = async (task) => {
    setError("");
    setActionMessage("");
    try {
      await completeCrmTask(task.id || task._id, { outcome: "Completed from CRM workspace." });
      await load({ silent: true });
      setActionMessage("Task completed.");
    } catch (err) {
      setError(err.message || "Failed to complete task");
    }
  };

  const changeTaskStatus = async (task, status) => {
    setError("");
    setActionMessage("");
    try {
      await updateCrmTask(task.id || task._id, { status });
      await load({ silent: true });
      setActionMessage("Task updated.");
    } catch (err) {
      setError(err.message || "Failed to update task");
    }
  };

  const submitCommunication = async (event) => {
    event.preventDefault();
    if (!selectedCustomerId) return;
    setSavingCommunication(true);
    setError("");
    setActionMessage("");

    try {
      const payload = {
        ...communicationForm,
        occurredAt: toIsoDateTime(communicationForm.occurredAt)
      };
      const result = await logCrmCustomerCommunication(selectedCustomerId, payload);
      setCommunicationForm(emptyCommunicationForm);
      const timeline = await fetchCrmCustomerTimeline(selectedCustomerId, { limit: 100 });
      setCustomerTimeline(timeline || { items: [] });
      setActionMessage(`Communication logged for ${customerName(selectedCustomer)}.`);
      return result;
    } catch (err) {
      setError(err.message || "Failed to log communication");
      return null;
    } finally {
      setSavingCommunication(false);
    }
  };

  const submitB2BPartner = async (event) => {
    event.preventDefault();
    setSavingB2BPartner(true);
    setError("");
    setActionMessage("");

    try {
      const payload = {
        ...b2bPartnerForm,
        commissionRate: b2bPartnerForm.commissionRate === "" ? undefined : Number(b2bPartnerForm.commissionRate),
        fixedCommissionAmount:
          b2bPartnerForm.fixedCommissionAmount === "" ? undefined : Number(b2bPartnerForm.fixedCommissionAmount),
        creditLimit: b2bPartnerForm.creditLimit === "" ? undefined : Number(b2bPartnerForm.creditLimit)
      };
      const result = await createCrmB2BPartner(payload);
      setB2BPartnerForm(emptyB2BPartnerForm);
      await load({ silent: true });
      setActionMessage(result.action === "existing" ? "Existing B2B partner matched." : "B2B partner saved.");
    } catch (err) {
      setError(err.message || "Failed to save B2B partner");
    } finally {
      setSavingB2BPartner(false);
    }
  };

  const changeB2BPartnerStatus = async (partner, status) => {
    setError("");
    setActionMessage("");
    try {
      await updateCrmB2BPartner(partner.id || partner._id, { status });
      await load({ silent: true });
      setActionMessage(`B2B partner ${partner.partnerNumber || ""} updated.`);
    } catch (err) {
      setError(err.message || "Failed to update B2B partner");
    }
  };

  return (
    <div className="admin-crm-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Customer Lifecycle</span>
          <h2>
            {mode === "pipeline"
              ? "Sales Pipeline"
              : mode === "opportunities"
                ? "Opportunities"
              : mode === "quotes"
                ? "Quotes"
                : mode === "b2bAgents"
                  ? "B2B / Agents"
                : mode === "followUps"
                  ? "Follow-ups"
                : mode === "tasks"
                  ? "Tasks"
                : mode === "leads"
                ? "Leads"
                : mode === "duplicates"
                  ? "Duplicate Review"
                  : mode === "customers"
                    ? "Customer Master"
                    : "CRM"}
          </h2>
          <p>Bokun remains booking truth while CRM owns pre-booking customer lifecycle data.</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />
      {actionMessage ? <div className="alert alert-success">{actionMessage}</div> : null}

      <Row className="g-3">
        <Col md={6} xl={3}>
          <AdminMetricCard label="Customers" value={metrics.customerCount || 0} detail="Customer master records" icon={BsPeople} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Possible Duplicates"
            value={metrics.possibleDuplicateCount || 0}
            detail={`${metrics.openDuplicateCount || 0} open review items`}
            icon={BsShieldCheck}
            status={(metrics.openDuplicateCount || 0) > 0 ? "warn" : "pass"}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Leads"
            value={metrics.leadCount || 0}
            detail={`${metrics.newLeadCount || 0} new, ${metrics.qualifiedLeadCount || 0} qualified`}
            icon={BsClipboard2Check}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Open Opportunities"
            value={metrics.openOpportunityCount || 0}
            detail={`${metrics.wonOpportunityCount || 0} won, ${metrics.lostOpportunityCount || 0} lost`}
            icon={BsGraphUpArrow}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Weighted Pipeline"
            value={formatMoney(metrics.weightedPipelineValue || 0)}
            detail={`${formatMoney(metrics.openPipelineValue || 0)} open forecast`}
            icon={BsGraphUpArrow}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Quotes"
            value={metrics.quoteCount || 0}
            detail={`${metrics.sentQuoteCount || 0} sent, ${metrics.acceptedQuoteCount || 0} accepted`}
            icon={BsReceipt}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Follow-ups Due"
            value={metrics.followUpsDueCount || 0}
            detail={`${metrics.pendingFollowUpCount || 0} pending, ${metrics.missedFollowUpCount || 0} missed`}
            icon={BsBell}
            status={(metrics.followUpsDueCount || 0) > 0 ? "warn" : "pass"}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Open Tasks"
            value={metrics.openTaskCount || 0}
            detail={`${metrics.tasksDueCount || 0} due now`}
            icon={BsJournalCheck}
            status={(metrics.tasksDueCount || 0) > 0 ? "warn" : "pass"}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="B2B Partners"
            value={metrics.b2bPartnerCount || 0}
            detail={`${metrics.activeB2BPartnerCount || 0} active, ${metrics.openB2BPartnerCount || 0} in pipeline`}
            icon={BsPeople}
          />
        </Col>
      </Row>

      {mode === "leads" ? (
        <Row className="g-4 mt-1">
          <Col xl={4}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Lead Intake</h5>
                <Form onSubmit={submitLead}>
                  <Row className="g-3">
                    <Col md={6} xl={12}>
                      <Form.Label>First name</Form.Label>
                      <Form.Control value={leadForm.firstName} onChange={(event) => updateLeadForm("firstName", event.target.value)} required />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Last name</Form.Label>
                      <Form.Control value={leadForm.lastName} onChange={(event) => updateLeadForm("lastName", event.target.value)} required />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Email</Form.Label>
                      <Form.Control type="email" value={leadForm.email} onChange={(event) => updateLeadForm("email", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Phone or WhatsApp</Form.Label>
                      <Form.Control value={leadForm.phone} onChange={(event) => updateLeadForm("phone", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Source</Form.Label>
                      <Form.Select value={leadForm.source} onChange={(event) => updateLeadForm("source", event.target.value)}>
                        {leadSources.map((source) => <option key={source} value={source}>{source.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Status</Form.Label>
                      <Form.Select value={leadForm.status} onChange={(event) => updateLeadForm("status", event.target.value)}>
                        {leadStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Notes</Form.Label>
                      <Form.Control as="textarea" rows={3} value={leadForm.notes} onChange={(event) => updateLeadForm("notes", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Button type="submit" disabled={savingLead}>
                        <BsClipboard2Check /> {savingLead ? "Saving" : "Save Lead"}
                      </Button>
                    </Col>
                  </Row>
                </Form>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={8}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Lead Pipeline</h5>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Contact</th>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Next follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadItems.length ? leadItems.map((lead) => (
                      <tr key={lead.id || lead._id}>
                        <td>
                          <strong className="d-block">{leadName(lead)}</strong>
                          <small className="text-muted">{lead.leadReference || lead.id}</small>
                        </td>
                        <td>
                          <span className="d-block">{lead.email || "-"}</span>
                          <small className="text-muted">{lead.phone || lead.whatsappNumber || "-"}</small>
                        </td>
                        <td><StatusBadge value={lead.source} /></td>
                        <td>
                          <Form.Select
                            size="sm"
                            value={lead.status || "NEW"}
                            onChange={(event) => changeLeadStatus(lead, event.target.value)}
                          >
                            {leadStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                          </Form.Select>
                        </td>
                        <td>{formatDateTime(lead.nextFollowUpAt)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="text-center text-muted py-4">No CRM sales leads found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode === "opportunities" ? (
        <Row className="g-4 mt-1">
          <Col xl={4}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Opportunity Intake</h5>
                <Form onSubmit={submitOpportunity}>
                  <Row className="g-3">
                    <Col xs={12}>
                      <Form.Label>Title</Form.Label>
                      <Form.Control value={opportunityForm.title} onChange={(event) => updateOpportunityForm("title", event.target.value)} required />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Estimated value</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        step="0.01"
                        value={opportunityForm.estimatedValue}
                        onChange={(event) => updateOpportunityForm("estimatedValue", event.target.value)}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Currency</Form.Label>
                      <Form.Control
                        maxLength={3}
                        value={opportunityForm.currency}
                        onChange={(event) => updateOpportunityForm("currency", event.target.value.toUpperCase())}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Stage</Form.Label>
                      <Form.Select value={opportunityForm.stage} onChange={(event) => updateOpportunityForm("stage", event.target.value)}>
                        {opportunityStages.map((stage) => <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Probability</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        max="100"
                        value={opportunityForm.probability}
                        onChange={(event) => updateOpportunityForm("probability", event.target.value)}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Expected close</Form.Label>
                      <Form.Control
                        type="date"
                        value={opportunityForm.expectedCloseDate}
                        onChange={(event) => updateOpportunityForm("expectedCloseDate", event.target.value)}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Source</Form.Label>
                      <Form.Select value={opportunityForm.source} onChange={(event) => updateOpportunityForm("source", event.target.value)}>
                        {leadSources.map((source) => <option key={source} value={source}>{source.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    {opportunityForm.stage === "LOST" ? (
                      <Col xs={12}>
                        <Form.Label>Lost reason</Form.Label>
                        <Form.Select value={opportunityForm.lostReason} onChange={(event) => updateOpportunityForm("lostReason", event.target.value)}>
                          {lostReasons.map((reason) => <option key={reason} value={reason}>{reason.replaceAll("_", " ")}</option>)}
                        </Form.Select>
                      </Col>
                    ) : null}
                    {opportunityForm.stage === "WON" ? (
                      <Col xs={12}>
                        <Form.Label>Bokun booking ID</Form.Label>
                        <Form.Control
                          value={opportunityForm.wonBokunBookingId}
                          onChange={(event) => updateOpportunityForm("wonBokunBookingId", event.target.value)}
                        />
                      </Col>
                    ) : null}
                    <Col xs={12}>
                      <Form.Label>Notes</Form.Label>
                      <Form.Control as="textarea" rows={3} value={opportunityForm.notes} onChange={(event) => updateOpportunityForm("notes", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Button type="submit" disabled={savingOpportunity}>
                        <BsGraphUpArrow /> {savingOpportunity ? "Saving" : "Save Opportunity"}
                      </Button>
                    </Col>
                  </Row>
                </Form>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={8}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Opportunity Pipeline</h5>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Opportunity</th>
                      <th>Value</th>
                      <th>Weighted</th>
                      <th>Stage</th>
                      <th>Expected close</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunityItems.length ? opportunityItems.map((opportunity) => (
                      <tr key={opportunity.id || opportunity._id}>
                        <td>
                          <strong className="d-block">{opportunity.title || "-"}</strong>
                          <small className="text-muted">{opportunity.opportunityNumber || opportunity.id}</small>
                        </td>
                        <td>{formatMoney(opportunity.estimatedValue, opportunity.currency)}</td>
                        <td>
                          <span className="d-block">{formatMoney(opportunity.weightedValue, opportunity.currency)}</span>
                          <small className="text-muted">{opportunity.probability || 0}% probability</small>
                        </td>
                        <td>
                          <Form.Select
                            size="sm"
                            value={opportunity.stage || "NEW"}
                            onChange={(event) => changeOpportunityStage(opportunity, event.target.value)}
                            disabled={["WON", "LOST"].includes(opportunity.stage)}
                          >
                            {opportunityStages
                              .filter((stage) => !["WON", "LOST"].includes(stage) || stage === opportunity.stage)
                              .map((stage) => <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>)}
                          </Form.Select>
                        </td>
                        <td>{formatDateTime(opportunity.expectedCloseDate)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="text-center text-muted py-4">No CRM opportunities found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode === "quotes" ? (
        <Row className="g-4 mt-1">
          <Col xl={4}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Quote Builder</h5>
                <Form onSubmit={submitQuote}>
                  <Row className="g-3">
                    <Col md={6} xl={12}>
                      <Form.Label>Opportunity ID</Form.Label>
                      <Form.Control value={quoteForm.opportunityId} onChange={(event) => updateQuoteForm("opportunityId", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Customer ID</Form.Label>
                      <Form.Control value={quoteForm.customerId} onChange={(event) => updateQuoteForm("customerId", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Currency</Form.Label>
                      <Form.Control
                        maxLength={3}
                        value={quoteForm.currency}
                        onChange={(event) => updateQuoteForm("currency", event.target.value.toUpperCase())}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Valid until</Form.Label>
                      <Form.Control
                        type="date"
                        value={quoteForm.validUntil}
                        onChange={(event) => updateQuoteForm("validUntil", event.target.value)}
                      />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Line item type</Form.Label>
                      <Form.Select value={quoteForm.itemType} onChange={(event) => updateQuoteForm("itemType", event.target.value)}>
                        {quoteLineItemTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Description</Form.Label>
                      <Form.Control value={quoteForm.description} onChange={(event) => updateQuoteForm("description", event.target.value)} required />
                    </Col>
                    {quoteForm.itemType === "BOKUN_PRODUCT" ? (
                      <>
                        <Col md={6} xl={12}>
                          <Form.Label>Bokun product ID</Form.Label>
                          <Form.Control value={quoteForm.productId} onChange={(event) => updateQuoteForm("productId", event.target.value)} />
                        </Col>
                        <Col md={6} xl={12}>
                          <Form.Label>Product option ID</Form.Label>
                          <Form.Control value={quoteForm.productOptionId} onChange={(event) => updateQuoteForm("productOptionId", event.target.value)} />
                        </Col>
                      </>
                    ) : null}
                    <Col md={6} xl={12}>
                      <Form.Label>Quantity</Form.Label>
                      <Form.Control
                        type="number"
                        min="0.000001"
                        step="0.01"
                        value={quoteForm.quantity}
                        onChange={(event) => updateQuoteForm("quantity", event.target.value)}
                        required
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Unit price</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        step="0.01"
                        value={quoteForm.unitPrice}
                        onChange={(event) => updateQuoteForm("unitPrice", event.target.value)}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Discount</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        step="0.01"
                        value={quoteForm.discount}
                        onChange={(event) => updateQuoteForm("discount", event.target.value)}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Tax</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        step="0.01"
                        value={quoteForm.tax}
                        onChange={(event) => updateQuoteForm("tax", event.target.value)}
                      />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Notes</Form.Label>
                      <Form.Control as="textarea" rows={2} value={quoteForm.notes} onChange={(event) => updateQuoteForm("notes", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Terms</Form.Label>
                      <Form.Control as="textarea" rows={2} value={quoteForm.terms} onChange={(event) => updateQuoteForm("terms", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Button type="submit" disabled={savingQuote}>
                        <BsReceipt /> {savingQuote ? "Saving" : "Save Quote"}
                      </Button>
                    </Col>
                  </Row>
                </Form>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={8}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Quote Register</h5>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Quote</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Valid until</th>
                      <th>Issued</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quoteItems.length ? quoteItems.map((quote) => (
                      <tr key={quote.id || quote._id}>
                        <td>
                          <strong className="d-block">{quote.quoteNumber || "-"}</strong>
                          <small className="text-muted">{quote.lineItems?.[0]?.description || "CRM quote"}</small>
                        </td>
                        <td>
                          <span className="d-block">{formatMoney(quote.total, quote.currency)}</span>
                          <small className="text-muted">Forecast only</small>
                        </td>
                        <td><StatusBadge value={quote.status} /></td>
                        <td>{formatDateTime(quote.validUntil)}</td>
                        <td>{formatDateTime(quote.sentAt || quote.issueDate)}</td>
                        <td>
                          <div className="d-flex flex-wrap gap-2">
                            {quote.status === "DRAFT" ? (
                              <Button size="sm" variant="outline-secondary" onClick={() => markQuoteInternalReview(quote)}>
                                <BsShieldCheck /> Review
                              </Button>
                            ) : null}
                            {["DRAFT", "INTERNAL_REVIEW"].includes(quote.status) ? (
                              <Button size="sm" variant="outline-primary" onClick={() => runQuoteAction(quote, "approve")}>
                                <BsClipboard2Check /> Approve
                              </Button>
                            ) : null}
                            {quote.status === "APPROVED" ? (
                              <Button size="sm" variant="outline-success" onClick={() => runQuoteAction(quote, "send")}>
                                <BsReceipt /> Send
                              </Button>
                            ) : null}
                            {["SENT", "VIEWED", "APPROVED"].includes(quote.status) ? (
                              <Button size="sm" variant="success" onClick={() => runQuoteAction(quote, "accept")}>
                                <BsGraphUpArrow /> Accept
                              </Button>
                            ) : null}
                            {quote.status === "ACCEPTED" ? (
                              <div className="border rounded p-2 bg-light w-100">
                                <div className="small fw-semibold mb-2">Link confirmed Bókun booking</div>
                                <Row className="g-2">
                                  <Col md={6}>
                                    <Form.Control
                                      size="sm"
                                      placeholder="Booking reference"
                                      value={quoteConversionFor(quote).bookingReference || ""}
                                      onChange={(event) => updateQuoteConversionForm(quote.id || quote._id, "bookingReference", event.target.value)}
                                    />
                                  </Col>
                                  <Col md={6}>
                                    <Form.Control
                                      size="sm"
                                      placeholder="Bókun booking ID"
                                      value={quoteConversionFor(quote).bokunBookingId || ""}
                                      onChange={(event) => updateQuoteConversionForm(quote.id || quote._id, "bokunBookingId", event.target.value)}
                                    />
                                  </Col>
                                  <Col xs={12}>
                                    <Form.Control
                                      size="sm"
                                      placeholder="Conversion note"
                                      value={quoteConversionFor(quote).conversionNote || ""}
                                      onChange={(event) => updateQuoteConversionForm(quote.id || quote._id, "conversionNote", event.target.value)}
                                    />
                                  </Col>
                                  <Col xs={12}>
                                    <Button
                                      size="sm"
                                      variant="outline-success"
                                      onClick={() => runQuoteConversion(quote)}
                                      disabled={!quoteConversionFor(quote).bookingReference && !quoteConversionFor(quote).bokunBookingId}
                                    >
                                      <BsJournalCheck /> Convert
                                    </Button>
                                  </Col>
                                </Row>
                              </div>
                            ) : null}
                            {quote.status === "CONVERTED" ? (
                              <small className="text-muted d-block">
                                Booking {quote.convertedBookingId || "-"} · Bókun {quote.bokunBookingId || "-"}
                              </small>
                            ) : null}
                            {!quoteStatuses.includes(quote.status) ? <StatusBadge value="UNKNOWN" /> : null}
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6} className="text-center text-muted py-4">No CRM quotes found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={12}>
            <Card className="surface-card">
              <Card.Body>
                <h5 className="mb-2">Quote Revenue Guardrail</h5>
                <p className="mb-0 text-muted">
                  Quote value is sales forecast only. Actual revenue remains sourced from booking accounting after Bokun confirms the booking.
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode === "followUps" ? (
        <Row className="g-4 mt-1">
          <Col xl={4}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Schedule Follow-up</h5>
                <Form onSubmit={submitFollowUp}>
                  <Row className="g-3">
                    <Col xs={12}>
                      <Form.Label>Lead ID</Form.Label>
                      <Form.Control value={followUpForm.leadId} onChange={(event) => updateFollowUpForm("leadId", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Opportunity ID</Form.Label>
                      <Form.Control value={followUpForm.opportunityId} onChange={(event) => updateFollowUpForm("opportunityId", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Customer ID</Form.Label>
                      <Form.Control value={followUpForm.customerId} onChange={(event) => updateFollowUpForm("customerId", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Type</Form.Label>
                      <Form.Select value={followUpForm.type} onChange={(event) => updateFollowUpForm("type", event.target.value)}>
                        {followUpTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Due at</Form.Label>
                      <Form.Control
                        type="datetime-local"
                        value={followUpForm.dueAt}
                        onChange={(event) => updateFollowUpForm("dueAt", event.target.value)}
                        required
                      />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Priority</Form.Label>
                      <Form.Select value={followUpForm.priority} onChange={(event) => updateFollowUpForm("priority", event.target.value)}>
                        {crmPriorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </Form.Select>
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Notes</Form.Label>
                      <Form.Control as="textarea" rows={3} value={followUpForm.notes} onChange={(event) => updateFollowUpForm("notes", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Button type="submit" disabled={savingFollowUp}>
                        <BsBell /> {savingFollowUp ? "Saving" : "Save Follow-up"}
                      </Button>
                    </Col>
                  </Row>
                </Form>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={8}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Follow-up Queue</h5>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Due</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Notes</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {followUpItems.length ? followUpItems.map((followUp) => (
                      <tr key={followUp.id || followUp._id}>
                        <td>
                          <StatusBadge value={followUp.type} />
                          {followUp.overdue ? <small className="d-block text-danger mt-1">Overdue</small> : null}
                        </td>
                        <td>{formatDateTime(followUp.dueAt)}</td>
                        <td><StatusBadge value={followUp.priority} /></td>
                        <td>
                          <Form.Select
                            size="sm"
                            value={followUp.status || "PENDING"}
                            onChange={(event) => changeFollowUpStatus(followUp, event.target.value)}
                            disabled={followUp.status === "COMPLETED"}
                          >
                            {followUpStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                          </Form.Select>
                        </td>
                        <td>{followUp.notes || followUp.outcome || "-"}</td>
                        <td>
                          {followUp.status !== "COMPLETED" ? (
                            <Button size="sm" variant="outline-success" onClick={() => completeFollowUpAction(followUp)}>
                              <BsClipboard2Check /> Complete
                            </Button>
                          ) : (
                            <StatusBadge value="DONE" />
                          )}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6} className="text-center text-muted py-4">No CRM follow-ups found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode === "tasks" ? (
        <Row className="g-4 mt-1">
          <Col xl={4}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Create Task</h5>
                <Form onSubmit={submitTask}>
                  <Row className="g-3">
                    <Col xs={12}>
                      <Form.Label>Title</Form.Label>
                      <Form.Control value={taskForm.title} onChange={(event) => updateTaskForm("title", event.target.value)} required />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Related entity</Form.Label>
                      <Form.Select value={taskForm.relatedEntityType} onChange={(event) => updateTaskForm("relatedEntityType", event.target.value)}>
                        {taskRelatedEntityTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Related ID</Form.Label>
                      <Form.Control value={taskForm.relatedEntityId} onChange={(event) => updateTaskForm("relatedEntityId", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Due date</Form.Label>
                      <Form.Control
                        type="datetime-local"
                        value={taskForm.dueDate}
                        onChange={(event) => updateTaskForm("dueDate", event.target.value)}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Priority</Form.Label>
                      <Form.Select value={taskForm.priority} onChange={(event) => updateTaskForm("priority", event.target.value)}>
                        {crmPriorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </Form.Select>
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Description</Form.Label>
                      <Form.Control as="textarea" rows={3} value={taskForm.description} onChange={(event) => updateTaskForm("description", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Button type="submit" disabled={savingTask}>
                        <BsJournalCheck /> {savingTask ? "Saving" : "Save Task"}
                      </Button>
                    </Col>
                  </Row>
                </Form>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={8}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">Sales Task Queue</h5>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Due</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Related</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskItems.length ? taskItems.map((task) => (
                      <tr key={task.id || task._id}>
                        <td>
                          <strong className="d-block">{task.title || "-"}</strong>
                          <small className="text-muted">{task.description || task.outcome || "-"}</small>
                        </td>
                        <td>
                          {formatDateTime(task.dueDate)}
                          {task.overdue ? <small className="d-block text-danger mt-1">Overdue</small> : null}
                        </td>
                        <td><StatusBadge value={task.priority} /></td>
                        <td>
                          <Form.Select
                            size="sm"
                            value={task.status || "TODO"}
                            onChange={(event) => changeTaskStatus(task, event.target.value)}
                            disabled={task.status === "DONE"}
                          >
                            {taskStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                          </Form.Select>
                        </td>
                        <td>
                          <span className="d-block">{task.relatedEntityType || "OTHER"}</span>
                          <small className="text-muted">{task.relatedEntityId || "-"}</small>
                        </td>
                        <td>
                          {task.status !== "DONE" ? (
                            <Button size="sm" variant="outline-success" onClick={() => completeTaskAction(task)}>
                              <BsClipboard2Check /> Done
                            </Button>
                          ) : (
                            <StatusBadge value="DONE" />
                          )}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6} className="text-center text-muted py-4">No CRM tasks found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode === "pipeline" ? (
        <Row className="g-3 mt-1">
          {pipelineColumns.length ? pipelineColumns.map((column) => (
            <Col md={6} xl={4} xxl={3} key={column.stage}>
              <Card className="surface-card h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-3">
                    <div>
                      <h6 className="mb-1">{column.label}</h6>
                      <small className="text-muted">{column.count || 0} opportunities</small>
                    </div>
                    <StatusBadge value={column.stage} />
                  </div>
                  <div className="small text-muted mb-3">
                    <div>{formatMoney(column.totalEstimatedValue, pipeline.filters?.currency || "USD")} estimated</div>
                    <div>{formatMoney(column.weightedValue, pipeline.filters?.currency || "USD")} weighted forecast</div>
                  </div>
                  <div className="d-flex flex-column gap-2">
                    {column.items?.length ? column.items.map((opportunity) => (
                      <div className="border rounded p-3 bg-light" key={opportunity.id || opportunity._id}>
                        <strong className="d-block">{opportunity.title || "-"}</strong>
                        <small className="text-muted d-block mb-2">{opportunity.opportunityNumber || opportunity.id}</small>
                        <div className="small mb-2">
                          <span className="d-block">{formatMoney(opportunity.estimatedValue, opportunity.currency)}</span>
                          <span className="text-muted">{opportunity.probability || 0}% probability</span>
                        </div>
                        <Form.Select
                          size="sm"
                          value={opportunity.stage || column.stage}
                          onChange={(event) => changeOpportunityStage(opportunity, event.target.value)}
                          disabled={column.isTerminal}
                        >
                          {opportunityStages
                            .filter((stage) => !["WON", "LOST"].includes(stage) || stage === opportunity.stage)
                            .map((stage) => <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>)}
                        </Form.Select>
                      </div>
                    )) : (
                      <div className="text-muted small border rounded p-3 bg-light">No opportunities in this stage.</div>
                    )}
                  </div>
                </Card.Body>
              </Card>
            </Col>
          )) : (
            <Col>
              <Card className="surface-card">
                <Card.Body className="text-center text-muted py-4">No CRM pipeline data found.</Card.Body>
              </Card>
            </Col>
          )}
          <Col xs={12}>
            <Card className="surface-card">
              <Card.Body>
                <h5 className="mb-2">Pipeline Forecast Guardrail</h5>
                <p className="mb-0 text-muted">
                  Pipeline value is forecast only. Actual revenue and profit remain sourced from Booking Accounting after Bokun confirms the booking.
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode === "b2bAgents" ? (
        <Row className="g-4 mt-1">
          <Col xl={4}>
            <Card className="surface-card h-100">
              <Card.Body>
                <h5 className="mb-3">B2B / Agent Intake</h5>
                <Form onSubmit={submitB2BPartner}>
                  <Row className="g-3">
                    <Col md={6} xl={12}>
                      <Form.Label>Partner type</Form.Label>
                      <Form.Select value={b2bPartnerForm.partnerType} onChange={(event) => updateB2BPartnerForm("partnerType", event.target.value)}>
                        {b2bPartnerTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Company name</Form.Label>
                      <Form.Control value={b2bPartnerForm.companyName} onChange={(event) => updateB2BPartnerForm("companyName", event.target.value)} required />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Contact person</Form.Label>
                      <Form.Control value={b2bPartnerForm.contactPerson} onChange={(event) => updateB2BPartnerForm("contactPerson", event.target.value)} required />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Email</Form.Label>
                      <Form.Control type="email" value={b2bPartnerForm.email} onChange={(event) => updateB2BPartnerForm("email", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Phone</Form.Label>
                      <Form.Control value={b2bPartnerForm.phone} onChange={(event) => updateB2BPartnerForm("phone", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Country</Form.Label>
                      <Form.Control value={b2bPartnerForm.country} onChange={(event) => updateB2BPartnerForm("country", event.target.value)} />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Status</Form.Label>
                      <Form.Select value={b2bPartnerForm.status} onChange={(event) => updateB2BPartnerForm("status", event.target.value)}>
                        {b2bPartnerStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Commission model</Form.Label>
                      <Form.Select
                        value={b2bPartnerForm.commissionModel}
                        onChange={(event) => updateB2BPartnerForm("commissionModel", event.target.value)}
                      >
                        {b2bCommissionModels.map((model) => <option key={model} value={model}>{model.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Commission rate</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={b2bPartnerForm.commissionRate}
                        onChange={(event) => updateB2BPartnerForm("commissionRate", event.target.value)}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Net rate model</Form.Label>
                      <Form.Select value={b2bPartnerForm.netRateModel} onChange={(event) => updateB2BPartnerForm("netRateModel", event.target.value)}>
                        {b2bNetRateModels.map((model) => <option key={model} value={model}>{model.replaceAll("_", " ")}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Credit limit</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        step="0.01"
                        value={b2bPartnerForm.creditLimit}
                        onChange={(event) => updateB2BPartnerForm("creditLimit", event.target.value)}
                      />
                    </Col>
                    <Col md={6} xl={12}>
                      <Form.Label>Currency</Form.Label>
                      <Form.Control value={b2bPartnerForm.currency} onChange={(event) => updateB2BPartnerForm("currency", event.target.value.toUpperCase().slice(0, 3))} />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Payment terms</Form.Label>
                      <Form.Control value={b2bPartnerForm.paymentTerms} onChange={(event) => updateB2BPartnerForm("paymentTerms", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Notes</Form.Label>
                      <Form.Control as="textarea" rows={3} value={b2bPartnerForm.notes} onChange={(event) => updateB2BPartnerForm("notes", event.target.value)} />
                    </Col>
                    <Col xs={12}>
                      <Button type="submit" disabled={savingB2BPartner}>
                        <BsPeople /> {savingB2BPartner ? "Saving" : "Save Partner"}
                      </Button>
                    </Col>
                  </Row>
                </Form>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={8}>
            <Card className="surface-card">
              <Card.Body>
                <h5 className="mb-3">B2B Partner Pipeline</h5>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Partner</th>
                      <th>Contact</th>
                      <th>Commercial</th>
                      <th>Status</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b2bPartnerItems.length ? b2bPartnerItems.map((partner) => (
                      <tr key={partner.id || partner._id}>
                        <td>
                          <strong className="d-block">{partner.companyName}</strong>
                          <small className="text-muted">{partner.partnerNumber || partner.partnerType?.replaceAll("_", " ")}</small>
                        </td>
                        <td>
                          <span className="d-block">{partner.contactPerson || "-"}</span>
                          <small className="text-muted">{partner.email || partner.phone || "-"}</small>
                        </td>
                        <td>
                          <span className="d-block">{partner.commissionModel?.replaceAll("_", " ") || "NONE"}</span>
                          <small className="text-muted">
                            {partner.creditLimit ? `${formatMoney(partner.creditLimit, partner.currency)} credit` : "No accounting posting"}
                          </small>
                        </td>
                        <td>
                          <Form.Select
                            size="sm"
                            value={partner.status || "PROSPECT"}
                            onChange={(event) => changeB2BPartnerStatus(partner, event.target.value)}
                          >
                            {b2bPartnerStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                          </Form.Select>
                        </td>
                        <td>{formatDateTime(partner.updatedAt || partner.createdAt)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="text-center text-muted py-4">No B2B or agent CRM partners found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode !== "duplicates" &&
      mode !== "leads" &&
      mode !== "opportunities" &&
      mode !== "quotes" &&
      mode !== "b2bAgents" &&
      mode !== "followUps" &&
      mode !== "tasks" &&
      mode !== "pipeline" ? (
        <Row className="g-4 mt-1">
          <Col>
            <Card className="surface-card">
              <Card.Body>
                <h5 className="mb-3">Customer Master</h5>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Contact</th>
                      <th>Lifecycle</th>
                      <th>Segments</th>
                      <th>Deduplication</th>
                      <th>Updated</th>
                      <th>Timeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerItems.length ? customerItems.map((customer) => (
                      <tr
                        key={customer.id || customer._id}
                        className={String(customer.id || customer._id) === String(selectedCustomerId) ? "table-active" : ""}
                      >
                        <td>
                          <strong className="d-block">{customerName(customer)}</strong>
                          <small className="text-muted">{customer.crmCustomerNumber || customer.id}</small>
                        </td>
                        <td>
                          <span className="d-block">{customer.email || "-"}</span>
                          <small className="text-muted">{customer.phone || customer.whatsappNumber || "-"}</small>
                        </td>
                        <td><StatusBadge value={customer.lifecycleStage} /></td>
                        <td>{customer.segments?.length ? customer.segments.join(", ") : "-"}</td>
                        <td><StatusBadge value={customer.deduplicationStatus} /></td>
                        <td>{formatDateTime(customer.updatedAt)}</td>
                        <td>
                          <Button
                            size="sm"
                            variant={String(customer.id || customer._id) === String(selectedCustomerId) ? "primary" : "outline-primary"}
                            onClick={() => setSelectedCustomerId(customer.id || customer._id)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={7} className="text-center text-muted py-4">No customer master records found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode === "customers" ? (
        <Row className="g-4 mt-1">
          <Col lg={5}>
            <Card className="surface-card">
              <Card.Body>
                <h5 className="mb-3">Log Communication</h5>
                <Form onSubmit={submitCommunication}>
                  <Form.Group className="mb-3">
                    <Form.Label>Customer</Form.Label>
                    <Form.Select
                      value={selectedCustomerId}
                      onChange={(event) => setSelectedCustomerId(event.target.value)}
                      disabled={!customerItems.length}
                    >
                      {customerItems.map((customer) => (
                        <option key={customer.id || customer._id} value={customer.id || customer._id}>
                          {customerName(customer)}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Channel</Form.Label>
                        <Form.Select
                          value={communicationForm.channel}
                          onChange={(event) => updateCommunicationForm("channel", event.target.value)}
                        >
                          {communicationChannels.map((channel) => (
                            <option key={channel} value={channel}>{channel.replaceAll("_", " ")}</option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Direction</Form.Label>
                        <Form.Select
                          value={communicationForm.direction}
                          onChange={(event) => updateCommunicationForm("direction", event.target.value)}
                        >
                          {communicationDirections.map((direction) => (
                            <option key={direction} value={direction}>{direction.replaceAll("_", " ")}</option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                  </Row>
                  <Form.Group className="mb-3">
                    <Form.Label>Subject</Form.Label>
                    <Form.Control
                      value={communicationForm.subject}
                      onChange={(event) => updateCommunicationForm("subject", event.target.value)}
                      maxLength={240}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Summary</Form.Label>
                    <Form.Control
                      required
                      value={communicationForm.summary}
                      onChange={(event) => updateCommunicationForm("summary", event.target.value)}
                      maxLength={500}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Notes</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={communicationForm.note}
                      onChange={(event) => updateCommunicationForm("note", event.target.value)}
                      maxLength={2000}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Occurred At</Form.Label>
                    <Form.Control
                      type="datetime-local"
                      value={communicationForm.occurredAt}
                      onChange={(event) => updateCommunicationForm("occurredAt", event.target.value)}
                    />
                  </Form.Group>
                  <Button type="submit" disabled={savingCommunication || !selectedCustomerId}>
                    {savingCommunication ? "Saving" : "Log Communication"}
                  </Button>
                </Form>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={7}>
            <Card className="surface-card">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="mb-0">Customer Timeline</h5>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={async () => {
                      if (!selectedCustomerId) return;
                      setTimelineLoading(true);
                      try {
                        const data = await fetchCrmCustomerTimeline(selectedCustomerId, { limit: 100 });
                        setCustomerTimeline(data || { items: [] });
                      } catch (err) {
                        setError(err.message || "Failed to refresh timeline");
                      } finally {
                        setTimelineLoading(false);
                      }
                    }}
                    disabled={timelineLoading || !selectedCustomerId}
                  >
                    <BsArrowClockwise /> {timelineLoading ? "Loading" : "Refresh"}
                  </Button>
                </div>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Type</th>
                      <th>Channel</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timelineItems.length ? timelineItems.map((event) => (
                      <tr key={event.id || event._id}>
                        <td>{formatDateTime(event.occurredAt || event.createdAt)}</td>
                        <td><StatusBadge value={event.eventType} /></td>
                        <td>
                          {event.communication?.channel ? (
                            <>
                              <span className="d-block">{event.communication.channel.replaceAll("_", " ")}</span>
                              <small className="text-muted">{event.communication.status?.replaceAll("_", " ")}</small>
                            </>
                          ) : "-"}
                        </td>
                        <td>
                          <strong className="d-block">{event.summary || "-"}</strong>
                          <small className="text-muted">{event.communication?.bodyPreview || event.actor?.email || ""}</small>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={4} className="text-center text-muted py-4">
                          {timelineLoading ? "Loading customer timeline." : "No customer timeline events found."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      {mode !== "customers" &&
      mode !== "leads" &&
      mode !== "opportunities" &&
      mode !== "quotes" &&
      mode !== "b2bAgents" &&
      mode !== "followUps" &&
      mode !== "tasks" &&
      mode !== "pipeline" ? (
        <Row className="g-4 mt-1">
          <Col>
            <Card className="surface-card">
              <Card.Body>
                <h5 className="mb-3">Duplicate Review Queue</h5>
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Primary</th>
                      <th>Possible Duplicate</th>
                      <th>Match</th>
                      <th>Status</th>
                      <th>Detected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateItems.length ? duplicateItems.map((candidate) => (
                      <tr key={candidate.id || candidate._id || candidate.candidateKey}>
                        <td>{duplicateName(candidate.primaryCustomerId)}</td>
                        <td>{duplicateName(candidate.duplicateCustomerId)}</td>
                        <td>{candidate.matchFields?.length ? candidate.matchFields.join(", ") : "-"}</td>
                        <td><StatusBadge value={candidate.status} /></td>
                        <td>{formatDateTime(candidate.createdAt)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="text-center text-muted py-4">No open duplicate candidates.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      ) : null}

      <Row className="g-4 mt-1">
        <Col>
          <Card className="surface-card">
            <Card.Body>
              <h5 className="mb-3">Enabled CRM Foundation</h5>
              <div className="d-flex flex-wrap gap-2">
                {(dashboard?.enabledModules || []).map((item) => (
                  <StatusBadge key={item} value={item} />
                ))}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminCrmPage;
