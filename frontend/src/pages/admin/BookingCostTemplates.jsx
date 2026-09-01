import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, ButtonGroup, Card, Col, Form, Modal, Row, Table } from "react-bootstrap";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  BsArchive,
  BsArrowLeft,
  BsArrowRepeat,
  BsBoxSeam,
  BsCalculator,
  BsCheck2Circle,
  BsExclamationTriangle,
  BsEye,
  BsLayers,
  BsPencil,
  BsPlus,
  BsSearch,
  BsSliders,
  BsTrash
} from "react-icons/bs";
import {
  archiveBookingAccountingCostTemplate,
  createBookingAccountingCostTemplate,
  fetchBookingAccountingCostTemplate,
  fetchBookingAccountingCostTemplates,
  previewBookingAccountingCostTemplate,
  syncBokunProductCatalog,
  updateBookingAccountingCostTemplate
} from "../../api/adminApi";
import { AdminMetricCard, StatusBadge, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";

const asArray = (value) => (Array.isArray(value) ? value : []);
const safeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value, currency = "USD") => formatCurrency(safeNumber(value), currency || "USD");
const label = (value = "") =>
  String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
const todayInput = () => new Date().toISOString().slice(0, 10);

const COMMON_COST_CATEGORIES = [
  "Boat",
  "Guide",
  "Transport",
  "Fuel",
  "Entrance Fees",
  "Water",
  "Supplier",
  "Vehicle",
  "Commission",
  "Other"
];

const defaultLine = () => ({
  category: "Guide",
  description: "",
  basis: "fixed_per_booking",
  appliesTo: "all",
  amount: "10",
  percentage: "",
  percentageBase: "selling_amount",
  tiers: [],
  notes: ""
});

const defaultForm = () => ({
  bokunProductId: "",
  bokunOptionId: "",
  pricingCategoryId: "",
  currency: "USD",
  name: "",
  description: "",
  internalNotes: "",
  status: "draft",
  validFrom: todayInput(),
  validTo: "",
  costLines: []
});

const defaultDashboardFilters = () => ({
  search: "",
  productId: "",
  optionId: "",
  costStatus: "",
  templateStatus: "",
  view: "all",
  page: 1,
  limit: 10
});

const StatusPill = ({ value }) => {
  const status = String(value || "missing_cost").toLowerCase();
  if (status === "missing_cost") return <Badge bg="warning" text="dark">Missing Cost</Badge>;
  if (status === "costed" || status === "active") return <Badge bg="success">Active</Badge>;
  if (status === "draft") return <Badge bg="secondary">Draft</Badge>;
  if (status === "inactive") return <Badge bg="light" text="dark">Inactive</Badge>;
  if (status === "archived") return <Badge bg="dark">Archived</Badge>;
  return <StatusBadge value={value} />;
};

const TemplateMetricGrid = ({ summary = {}, currency = "USD" }) => (
  <Row className="g-3 mb-4 cost-template-metric-grid">
    <Col md={6} xl={3}>
      <AdminMetricCard
        label="Total Bokun Products"
        value={summary.totalBokunProducts || 0}
        detail={`${summary.totalBokunOptions || 0} synced options`}
        icon={BsBoxSeam}
      />
    </Col>
    <Col md={6} xl={3}>
      <AdminMetricCard
        label="Costed Options"
        value={summary.costedOptions || 0}
        detail="With active templates"
        icon={BsCheck2Circle}
        status="COMPLETED"
      />
    </Col>
    <Col md={6} xl={3}>
      <AdminMetricCard
        label="Missing Cost"
        value={summary.missingCost || 0}
        detail="Options without active rules"
        icon={BsExclamationTriangle}
        status={summary.missingCost ? "WARNING" : "COMPLETED"}
      />
    </Col>
    <Col md={6} xl={3}>
      <AdminMetricCard
        label="Active Templates"
        value={summary.activeTemplates || 0}
        detail={`${summary.inactiveTemplates || 0} inactive or archived`}
        icon={BsLayers}
      />
    </Col>
  </Row>
);

const CostTemplateFilters = ({ data, filters, onChange, onReset, onRefresh, loading }) => {
  const products = asArray(data?.products);
  const options = asArray(data?.options).filter(
    (option) => !filters.productId || String(option.bokunProductId) === String(filters.productId)
  );

  return (
    <Card className="surface-card cost-template-filters mb-3">
      <Card.Body>
        <Row className="g-3 align-items-end">
          <Col lg={3} md={6}>
            <Form.Label>Search</Form.Label>
            <div className="cost-template-search">
              <BsSearch />
              <Form.Control
                value={filters.search}
                onChange={(event) => onChange({ search: event.target.value, page: 1 })}
                placeholder="Search product or option..."
              />
            </div>
          </Col>
          <Col lg={2} md={6}>
            <Form.Label>Bokun Product</Form.Label>
            <Form.Select value={filters.productId} onChange={(event) => onChange({ productId: event.target.value, optionId: "", page: 1 })}>
              <option value="">All Products</option>
              {products.map((product) => (
                <option key={product.bokunProductId} value={product.bokunProductId}>{product.title}</option>
              ))}
            </Form.Select>
          </Col>
          <Col lg={2} md={6}>
            <Form.Label>Option / Rate</Form.Label>
            <Form.Select value={filters.optionId} onChange={(event) => onChange({ optionId: event.target.value, page: 1 })}>
              <option value="">All Options</option>
              {options.map((option) => (
                <option key={option.id} value={option.bokunOptionId}>{option.bokunOptionTitle}</option>
              ))}
            </Form.Select>
          </Col>
          <Col lg={2} md={6}>
            <Form.Label>Cost Status</Form.Label>
            <Form.Select value={filters.costStatus} onChange={(event) => onChange({ costStatus: event.target.value, page: 1 })}>
              <option value="">All Cost Status</option>
              <option value="costed">Costed</option>
              <option value="missing_cost">Missing Cost</option>
            </Form.Select>
          </Col>
          <Col lg={2} md={6}>
            <Form.Label>Template Status</Form.Label>
            <Form.Select value={filters.templateStatus} onChange={(event) => onChange({ templateStatus: event.target.value, page: 1 })}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </Form.Select>
          </Col>
          <Col lg={1} md={6} className="d-flex gap-2">
            <Button variant="outline-secondary" className="cost-template-icon-button" onClick={onRefresh} disabled={loading} aria-label="Refresh cost templates">
              <BsArrowRepeat />
            </Button>
            <Button variant="outline-secondary" className="cost-template-icon-button" onClick={onReset} aria-label="Reset cost template filters">
              <BsSliders />
            </Button>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
};

const CostTemplateTable = ({ items, onArchive }) => (
  <>
    <div className="cost-template-table-wrap">
      <Table hover responsive className="align-middle mb-0 cost-template-table">
        <thead>
          <tr>
            <th>Product (Bokun)</th>
            <th>Option / Rate</th>
            <th>Bokun IDs</th>
            <th>Cost Basis</th>
            <th className="text-end">Estimated Cost</th>
            <th>Currency</th>
            <th>Status</th>
            <th className="text-center">Lines</th>
            <th>Last Updated</th>
            <th className="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length ? items.map((item) => (
            <tr key={item.id}>
              <td>
                <div className="cost-template-product">
                  {item.bokunProductImage ? <img src={item.bokunProductImage} alt="" /> : <span><BsBoxSeam /></span>}
                  <div>
                    <strong>{item.bokunProductTitle}</strong>
                    <small>Product ID: {item.bokunProductId}</small>
                  </div>
                </div>
              </td>
              <td>
                <strong className="d-block">{item.bokunOptionTitle}</strong>
                <small className="text-muted">{item.pricingCategoryTitle || "All pricing categories"}</small>
              </td>
              <td>
                <small className="d-block">Prod: {item.bokunProductId}</small>
                <small className="text-muted">Opt: {item.bokunOptionId}</small>
              </td>
              <td>{item.costBasis ? <Badge bg="light" text="dark">{label(item.costBasis)}</Badge> : "-"}</td>
              <td className="text-end">
                {item.estimatedCostExample === null ? "-" : money(item.estimatedCostExample, item.currency)}
              </td>
              <td>{item.currency || "USD"}</td>
              <td><StatusPill value={item.costStatus === "missing_cost" ? "missing_cost" : item.templateStatus} /></td>
              <td className="text-center">{item.costLineCount || 0}</td>
              <td>{formatDateTime(item.lastUpdatedAt)}</td>
              <td>
                <div className="cost-template-row-actions">
                  {item.templateId ? (
                    <>
                      <Button as={Link} to={`/admin/booking-accounting/cost-templates/${item.templateId}`} variant="outline-secondary" size="sm" aria-label="View cost template">
                        <BsEye />
                      </Button>
                      <Button as={Link} to={`/admin/booking-accounting/cost-templates/${item.templateId}/edit`} variant="outline-secondary" size="sm" aria-label="Edit cost template">
                        <BsPencil />
                      </Button>
                      <Button variant="outline-danger" size="sm" onClick={() => onArchive(item.templateId)} aria-label="Archive cost template">
                        <BsArchive />
                      </Button>
                    </>
                  ) : (
                    <Button
                      as={Link}
                      to={`/admin/booking-accounting/cost-templates/new?product=${encodeURIComponent(item.bokunProductId)}&option=${encodeURIComponent(item.bokunOptionId)}`}
                      variant="outline-primary"
                      size="sm"
                    >
                      <BsPlus /> Add
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={10} className="text-center text-muted py-4">No Bokun product options match these filters.</td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
    <div className="cost-template-mobile-list">
      {items.length ? items.map((item) => (
        <Card className="surface-card" key={`${item.id}-mobile`}>
          <Card.Body>
            <div className="d-flex justify-content-between align-items-start gap-2">
              <div className="min-w-0">
                <strong className="d-block text-truncate">{item.bokunProductTitle}</strong>
                <small className="text-muted d-block text-truncate">{item.bokunOptionTitle}</small>
              </div>
              <StatusPill value={item.costStatus === "missing_cost" ? "missing_cost" : item.templateStatus} />
            </div>
            <div className="cost-template-mobile-meta">
              <span>Product {item.bokunProductId}</span>
              <span>Option {item.bokunOptionId}</span>
              <span>{item.estimatedCostExample === null ? "No estimate" : money(item.estimatedCostExample, item.currency)}</span>
            </div>
            <div className="d-flex gap-2 mt-3">
              {item.templateId ? (
                <>
                  <Button as={Link} to={`/admin/booking-accounting/cost-templates/${item.templateId}`} variant="outline-secondary" size="sm">
                    <BsEye /> View
                  </Button>
                  <Button as={Link} to={`/admin/booking-accounting/cost-templates/${item.templateId}/edit`} variant="outline-secondary" size="sm">
                    <BsPencil /> Edit
                  </Button>
                </>
              ) : (
                <Button
                  as={Link}
                  to={`/admin/booking-accounting/cost-templates/new?product=${encodeURIComponent(item.bokunProductId)}&option=${encodeURIComponent(item.bokunOptionId)}`}
                  variant="primary"
                  size="sm"
                >
                  <BsPlus /> Add Cost
                </Button>
              )}
            </div>
          </Card.Body>
        </Card>
      )) : <Alert variant="light" className="border mb-0">No Bokun product options match these filters.</Alert>}
    </div>
  </>
);

export const CostTemplatesDashboard = ({ initialData = null }) => {
  const [filters, setFilters] = useState(defaultDashboardFilters);
  const [data, setData] = useState(initialData || { items: [], summary: {}, products: [], options: [], pagination: {} });
  const [loading, setLoading] = useState(!initialData);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async (requestFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchBookingAccountingCostTemplates({
        ...requestFilters,
        view: requestFilters.view === "all" ? "" : requestFilters.view
      });
      setData(response);
    } catch (err) {
      setError(err.message || "Failed to load cost templates.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const updateFilters = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const reset = () => setFilters((current) => ({ ...defaultDashboardFilters(), limit: current.limit }));

  const archive = async (templateId) => {
    if (!templateId || !window.confirm("Archive this product cost template?")) return;
    try {
      await archiveBookingAccountingCostTemplate(templateId, { reason: "Archived from Booking Accounting cost templates dashboard." });
      await load();
    } catch (err) {
      setError(err.message || "Failed to archive cost template.");
    }
  };

  const syncProducts = async () => {
    setSyncingProducts(true);
    setError("");
    setSyncResult(null);
    try {
      const result = await syncBokunProductCatalog();
      setSyncResult(result);
      const nextFilters = { ...defaultDashboardFilters(), limit: filters.limit };
      setFilters(nextFilters);
      await load(nextFilters);
    } catch (err) {
      setError(err.message || "Bokun product sync failed. Check Bókun credentials and integration logs.");
    } finally {
      setSyncingProducts(false);
    }
  };

  const pagination = data?.pagination || {};
  const pages = Array.from({ length: Math.min(5, pagination.totalPages || 1) }, (_, index) => index + 1);
  const totalProducts = safeNumber(data?.summary?.totalBokunProducts);
  const totalOptions = safeNumber(data?.summary?.totalBokunOptions);
  const visibleItems = asArray(data?.items);
  const hasActiveFilters = Boolean(
    filters.search ||
      filters.productId ||
      filters.optionId ||
      filters.costStatus ||
      filters.templateStatus ||
      (filters.view && filters.view !== "all")
  );
  const filtersHideSyncedOptions = !loading && totalOptions > 0 && visibleItems.length === 0 && (hasActiveFilters || pagination.total === 0);
  const productsWithoutOptions = !loading && totalProducts > 0 && totalOptions === 0;

  return (
    <div className="booking-cost-template-module">
      <div className="admin-platform-page-header cost-template-page-title">
        <div>
          <span className="admin-platform-eyebrow">Booking Accounting / Cost Templates</span>
          <h2>Costed Products</h2>
          <p>Products and options from Bokun with internal cost templates configured in Riser.</p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-primary" onClick={syncProducts} disabled={syncingProducts}>
            <BsArrowRepeat /> {syncingProducts ? "Syncing Bokun" : "Sync Bokun Products"}
          </Button>
          <Button variant="outline-secondary" onClick={() => load()} disabled={loading}>
            <BsArrowRepeat /> Refresh Data
          </Button>
          <Button as={Link} to="/admin/booking-accounting/cost-templates/new" variant="primary">
            <BsPlus /> New Template
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} />
      {syncResult ? (
        <Alert variant="success" className="border-0 cost-template-sync-alert">
          Bokun product sync completed. {safeNumber(syncResult.syncedCount)} products were refreshed from Bokun. Showing all synced options now.
        </Alert>
      ) : null}
      {!loading && totalProducts === 0 ? (
        <Alert variant="warning" className="cost-template-sync-alert">
          No Bokun products are stored locally yet. Run Sync Bokun Products to pull the real product catalog into ProductSnapshot, then refresh this page.
        </Alert>
      ) : null}
      {productsWithoutOptions ? (
        <Alert variant="warning" className="cost-template-sync-alert">
          {totalProducts} Bokun products are stored, but no Bokun options or rates are available for cost templates yet. Run Sync Bokun Products again and check Integration Logs if Bokun does not return rate data.
        </Alert>
      ) : null}
      <TemplateMetricGrid summary={data?.summary || {}} />

      <div className="cost-template-tabs" role="tablist" aria-label="Cost template views">
        {[
          ["all", "All"],
          ["costed", "Costed"],
          ["missing", "Missing Cost"],
          ["inactive", "Inactive"]
        ].map(([value, text]) => (
          <Button
            key={value}
            variant={filters.view === value ? "primary" : "outline-secondary"}
            onClick={() => updateFilters({ view: value, page: 1 })}
          >
            {text}
          </Button>
        ))}
      </div>

      <CostTemplateFilters
        data={data}
        filters={filters}
        onChange={updateFilters}
        onReset={reset}
        onRefresh={() => load()}
        loading={loading}
      />

      {filtersHideSyncedOptions ? (
        <Alert variant="info" className="cost-template-sync-alert d-flex flex-wrap align-items-center justify-content-between gap-2">
          <span>{totalOptions} Bokun options are synced, but the current filters show zero rows.</span>
          <Button variant="outline-primary" size="sm" onClick={reset}>Show all synced options</Button>
        </Alert>
      ) : null}

      <Card className="surface-card cost-template-list-card">
        <Card.Body>
          {loading ? <Loader message="Loading cost templates..." /> : <CostTemplateTable items={visibleItems} onArchive={archive} />}
          <div className="cost-template-pagination">
            <span>
              Showing {visibleItems.length} of {pagination.total || 0} options
            </span>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={!pagination.hasPreviousPage}
                onClick={() => updateFilters({ page: Math.max(1, filters.page - 1) })}
              >
                Previous
              </Button>
              <ButtonGroup size="sm">
                {pages.map((page) => (
                  <Button
                    key={page}
                    variant={pagination.page === page ? "primary" : "outline-secondary"}
                    onClick={() => updateFilters({ page })}
                  >
                    {page}
                  </Button>
                ))}
              </ButtonGroup>
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={!pagination.hasNextPage}
                onClick={() => updateFilters({ page: filters.page + 1 })}
              >
                Next
              </Button>
              <Form.Select
                value={filters.limit}
                onChange={(event) => updateFilters({ limit: Number(event.target.value), page: 1 })}
                size="sm"
                className="cost-template-page-size"
                aria-label="Cost template page size"
              >
                {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size} / page</option>)}
              </Form.Select>
            </div>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

const CostLineModal = ({ show, onHide, onSave, basisTypes = [], line }) => {
  const [draft, setDraft] = useState(line || defaultLine());

  useEffect(() => {
    setDraft(line || defaultLine());
  }, [line, show]);

  const patch = (updates) => setDraft((current) => ({ ...current, ...updates }));

  const save = () => {
    const tiers = draft.basis === "tiered"
      ? asArray(draft.tiers).length
        ? draft.tiers
        : [{ min: 1, max: "", amount: draft.amount || 0 }]
      : [];
    onSave({
      ...draft,
      amount: ["percentage", "tiered"].includes(draft.basis) ? 0 : safeNumber(draft.amount),
      percentage: draft.basis === "percentage" ? safeNumber(draft.percentage) : 0,
      tiers
    });
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered className="cost-line-modal">
      <Modal.Header closeButton>
        <Modal.Title>Cost Line</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="g-3">
          <Col md={6}>
            <Form.Label>Cost Category</Form.Label>
            <Form.Select value={draft.category} onChange={(event) => patch({ category: event.target.value })}>
              {COMMON_COST_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </Form.Select>
          </Col>
          <Col md={6}>
            <Form.Label>Cost Basis</Form.Label>
            <Form.Select
              value={draft.basis}
              onChange={(event) =>
                patch({
                  basis: event.target.value,
                  tiers: event.target.value === "tiered" && !asArray(draft.tiers).length ? [{ min: 1, max: "", amount: draft.amount || 10 }] : draft.tiers
                })
              }
            >
              {basisTypes.map((basis) => <option key={basis} value={basis}>{label(basis)}</option>)}
            </Form.Select>
          </Col>
          <Col md={6}>
            <Form.Label>Applies To</Form.Label>
            <Form.Select value={draft.appliesTo} onChange={(event) => patch({ appliesTo: event.target.value })}>
              <option value="all">All Participants</option>
              <option value="adults">Adults</option>
              <option value="children">Children</option>
              <option value="vehicles">Vehicles</option>
              <option value="group">Group</option>
            </Form.Select>
          </Col>
          <Col md={6}>
            <Form.Label>{draft.basis === "percentage" ? "Percentage" : draft.basis === "tiered" ? "Default Tier Amount" : "Amount"}</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="0.01"
              value={draft.basis === "percentage" ? draft.percentage : draft.amount}
              onChange={(event) =>
                draft.basis === "percentage" ? patch({ percentage: event.target.value }) : patch({ amount: event.target.value })
              }
            />
          </Col>
          {draft.basis === "tiered" ? (
            <>
              <Col md={4}>
                <Form.Label>Tier Min Pax</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  value={asArray(draft.tiers)[0]?.min ?? 1}
                  onChange={(event) => patch({ tiers: [{ ...(asArray(draft.tiers)[0] || {}), min: event.target.value }] })}
                />
              </Col>
              <Col md={4}>
                <Form.Label>Tier Max Pax</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  value={asArray(draft.tiers)[0]?.max ?? ""}
                  onChange={(event) => patch({ tiers: [{ ...(asArray(draft.tiers)[0] || {}), max: event.target.value }] })}
                />
              </Col>
              <Col md={4}>
                <Form.Label>Tier Amount</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  step="0.01"
                  value={asArray(draft.tiers)[0]?.amount ?? draft.amount ?? ""}
                  onChange={(event) => patch({ tiers: [{ ...(asArray(draft.tiers)[0] || {}), amount: event.target.value }] })}
                />
              </Col>
            </>
          ) : null}
          <Col xs={12}>
            <Form.Label>Description</Form.Label>
            <Form.Control value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
          </Col>
          <Col xs={12}>
            <Form.Label>Notes</Form.Label>
            <Form.Control as="textarea" rows={2} value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} />
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>Cancel</Button>
        <Button variant="primary" onClick={save}>Save Cost Line</Button>
      </Modal.Footer>
    </Modal>
  );
};

const CostLineTable = ({ lines, readOnly, onEdit, onRemove }) => (
  <div className="cost-lines-table">
    <Table responsive className="align-middle mb-0">
      <thead>
        <tr>
          <th>#</th>
          <th>Cost Category</th>
          <th>Cost Basis</th>
          <th>Applies To</th>
          <th className="text-end">Amount</th>
          <th className="text-end">Actions</th>
        </tr>
      </thead>
      <tbody>
        {lines.length ? lines.map((line, index) => (
          <tr key={line.lineId || `${line.category}-${index}`}>
            <td>{index + 1}</td>
            <td>
              <strong className="d-block">{line.category}</strong>
              <small className="text-muted">{line.description || "-"}</small>
            </td>
            <td>{label(line.basis)}</td>
            <td>{label(line.appliesTo || "all")}</td>
            <td className="text-end">
              {line.basis === "percentage" ? `${safeNumber(line.percentage).toFixed(2)}%` : safeNumber(line.amount).toFixed(2)}
            </td>
            <td className="text-end">
              <div className="cost-template-row-actions">
                <Button variant="outline-secondary" size="sm" disabled={readOnly} onClick={() => onEdit(index)} aria-label="Edit cost line">
                  <BsPencil />
                </Button>
                <Button variant="outline-danger" size="sm" disabled={readOnly} onClick={() => onRemove(index)} aria-label="Remove cost line">
                  <BsTrash />
                </Button>
              </div>
            </td>
          </tr>
        )) : (
          <tr>
            <td colSpan={6} className="text-center text-muted py-4">No cost lines yet.</td>
          </tr>
        )}
      </tbody>
    </Table>
  </div>
);

const PreviewPanel = ({ preview, context, onContextChange, currency }) => (
  <Card className="surface-card h-100 cost-template-preview-card">
    <Card.Body>
      <div className="d-flex align-items-center gap-2 mb-3">
        <BsCalculator />
        <div>
          <h5 className="mb-0">Estimated Cost Example</h5>
          <small className="text-muted">Calculated by the backend cost template engine.</small>
        </div>
      </div>
      <Row className="g-2 mb-3">
        {[
          ["adults", "Adults"],
          ["children", "Children"],
          ["vehicles", "Vehicles"],
          ["sellingAmount", "Selling"]
        ].map(([key, text]) => (
          <Col xs={6} key={key}>
            <Form.Label>{text}</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step={key === "sellingAmount" ? "0.01" : "1"}
              value={context[key]}
              onChange={(event) => onContextChange({ [key]: event.target.value })}
            />
          </Col>
        ))}
      </Row>
      <div className="cost-template-preview-lines">
        {asArray(preview?.breakdown).length ? asArray(preview.breakdown).map((line) => (
          <div key={line.lineId || line.category}>
            <span>{line.category} <small>({label(line.basis)})</small></span>
            <strong>{money(line.amount, preview.currency || currency)}</strong>
          </div>
        )) : <p className="text-muted mb-0">Add cost lines to preview the booking estimate.</p>}
      </div>
      <div className="cost-template-preview-total">
        <span>Estimated Cost</span>
        <strong>{money(preview?.totalEstimatedCost || 0, preview?.currency || currency)}</strong>
      </div>
    </Card.Body>
  </Card>
);

export const CostTemplateEditor = ({ mode = "cost-template-new", initialCatalog = null }) => {
  const navigate = useNavigate();
  const { templateId } = useParams();
  const params = new URLSearchParams(window.location.search);
  const readOnly = mode === "cost-template-view";
  const isEdit = mode === "cost-template-edit";
  const [catalog, setCatalog] = useState(initialCatalog || { products: [], options: [], costBasisTypes: [] });
  const [form, setForm] = useState(defaultForm());
  const [lineModal, setLineModal] = useState({ show: false, index: null });
  const [previewContext, setPreviewContext] = useState({ adults: 2, children: 0, vehicles: 1, sellingAmount: 0 });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(Boolean(templateId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [catalogResponse, templateResponse] = await Promise.all([
          fetchBookingAccountingCostTemplates({ limit: 500 }),
          templateId ? fetchBookingAccountingCostTemplate(templateId) : Promise.resolve(null)
        ]);
        if (!mounted) return;
        setCatalog(catalogResponse);
        if (templateResponse) {
          setForm({
            ...defaultForm(),
            ...templateResponse,
            validFrom: templateResponse.validFrom ? templateResponse.validFrom.slice(0, 10) : todayInput(),
            validTo: templateResponse.validTo ? templateResponse.validTo.slice(0, 10) : "",
            costLines: asArray(templateResponse.costLines)
          });
        } else {
          const productId = params.get("product") || "";
          const optionId = params.get("option") || "";
          const option = asArray(catalogResponse.options).find(
            (row) => String(row.bokunProductId) === productId && String(row.bokunOptionId) === optionId
          );
          if (option) {
            setForm({
              ...defaultForm(),
              bokunProductId: option.bokunProductId,
              bokunOptionId: option.bokunOptionId,
              currency: option.currency || "USD",
              name: `${option.bokunProductTitle} - ${option.bokunOptionTitle}`
            });
          }
        }
      } catch (err) {
        if (mounted) setError(err.message || "Failed to load cost template.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [templateId]);

  useEffect(() => {
    if (!form.costLines.length) {
      setPreview(null);
      return undefined;
    }
    let mounted = true;
    const timeout = window.setTimeout(async () => {
      try {
        const result = await previewBookingAccountingCostTemplate({
          currency: form.currency,
          costLines: form.costLines,
          context: {
            ...previewContext,
            participants: safeNumber(previewContext.adults) + safeNumber(previewContext.children),
            currency: form.currency
          }
        });
        if (mounted) setPreview(result);
      } catch (_err) {
        if (mounted) setPreview(null);
      }
    }, 250);
    return () => {
      mounted = false;
      window.clearTimeout(timeout);
    };
  }, [form.costLines, form.currency, previewContext]);

  const products = asArray(catalog.products);
  const selectedProduct = products.find((product) => String(product.bokunProductId) === String(form.bokunProductId));
  const productOptions = asArray(catalog.options).filter((option) => String(option.bokunProductId) === String(form.bokunProductId));
  const selectedOption = productOptions.find((option) => String(option.bokunOptionId) === String(form.bokunOptionId));
  const pricingCategories = asArray(selectedOption?.pricingCategories);
  const basisTypes = asArray(catalog.costBasisTypes).length ? catalog.costBasisTypes : ["fixed_per_booking", "per_participant", "per_vehicle"];

  const patch = (updates) => setForm((current) => ({ ...current, ...updates }));

  const selectProduct = (value) => {
    const nextProduct = products.find((product) => String(product.bokunProductId) === String(value));
    patch({
      bokunProductId: value,
      bokunOptionId: "",
      pricingCategoryId: "",
      currency: nextProduct?.currency || form.currency || "USD",
      name: nextProduct ? nextProduct.title : form.name
    });
  };

  const selectOption = (value) => {
    const nextOption = productOptions.find((option) => String(option.bokunOptionId) === String(value));
    patch({
      bokunOptionId: value,
      currency: nextOption?.currency || form.currency || "USD",
      name: nextOption ? `${nextOption.bokunProductTitle} - ${nextOption.bokunOptionTitle}` : form.name
    });
  };

  const saveLine = (line) => {
    setForm((current) => {
      const lines = [...current.costLines];
      if (lineModal.index === null) lines.push({ ...line, lineId: `line-${Date.now()}` });
      else lines[lineModal.index] = { ...lines[lineModal.index], ...line };
      return { ...current, costLines: lines };
    });
  };

  const removeLine = (index) => {
    setForm((current) => ({ ...current, costLines: current.costLines.filter((_line, lineIndex) => lineIndex !== index) }));
  };

  const save = async (status) => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        status,
        validTo: form.validTo || null,
        pricingCategoryTitle:
          pricingCategories.find((category) => String(category.pricingCategoryId) === String(form.pricingCategoryId))?.title || ""
      };
      const result = isEdit
        ? await updateBookingAccountingCostTemplate(templateId, payload)
        : await createBookingAccountingCostTemplate(payload);
      navigate(`/admin/booking-accounting/cost-templates/${result.template.id}`);
    } catch (err) {
      setError(err.message || "Failed to save cost template.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader message="Loading cost template..." />;

  return (
    <div className="booking-cost-template-module">
      <div className="admin-platform-page-header cost-template-page-title">
        <div>
          <Button as={Link} to="/admin/booking-accounting/cost-templates" variant="link" className="cost-template-back-link">
            <BsArrowLeft /> Back to Cost Templates
          </Button>
          <h2>{readOnly ? "Cost Template" : isEdit ? "Edit Cost Template" : "Create Cost Template"}</h2>
          <p>Select a Bokun product option and define internal cost rules.</p>
        </div>
        {readOnly ? (
          <Button as={Link} to={`/admin/booking-accounting/cost-templates/${templateId}/edit`} variant="primary">
            <BsPencil /> Edit Template
          </Button>
        ) : null}
      </div>

      <ErrorAlert error={error} />

      <Card className="surface-card mb-4 cost-template-selection-card">
        <Card.Body>
          <Row className="g-3">
            <Col xl={3} md={6}>
              <Form.Label>1. Select Bokun Product</Form.Label>
              <Form.Select value={form.bokunProductId} onChange={(event) => selectProduct(event.target.value)} disabled={readOnly || isEdit}>
                <option value="">Select product</option>
                {products.map((product) => <option key={product.bokunProductId} value={product.bokunProductId}>{product.title}</option>)}
              </Form.Select>
              <small className="text-success">Synced from Bokun</small>
            </Col>
            <Col xl={3} md={6}>
              <Form.Label>2. Select Option / Rate</Form.Label>
              <Form.Select value={form.bokunOptionId} onChange={(event) => selectOption(event.target.value)} disabled={readOnly || isEdit || !form.bokunProductId}>
                <option value="">Select option</option>
                {productOptions.map((option) => <option key={option.id} value={option.bokunOptionId}>{option.bokunOptionTitle}</option>)}
              </Form.Select>
              <small className="text-success">Synced from Bokun</small>
            </Col>
            <Col xl={3} md={6}>
              <Form.Label>3. Pricing Category</Form.Label>
              <Form.Select value={form.pricingCategoryId || ""} onChange={(event) => patch({ pricingCategoryId: event.target.value })} disabled={readOnly}>
                <option value="">All pricing categories</option>
                {pricingCategories.map((category) => (
                  <option key={category.pricingCategoryId} value={category.pricingCategoryId}>{category.title}</option>
                ))}
              </Form.Select>
              <small className="text-muted">Optional</small>
            </Col>
            <Col xl={3} md={6}>
              <Form.Label>4. Currency</Form.Label>
              <Form.Control value={form.currency} onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} disabled={readOnly} />
              <small className="text-muted">Default from Bokun/local accounting</small>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Row className="g-4">
        <Col xl={9}>
          <Card className="surface-card mb-4">
            <Card.Body>
              <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Cost Lines</h5>
                  <small className="text-muted">Define cost components and how they are calculated.</small>
                </div>
                <Button disabled={readOnly} onClick={() => setLineModal({ show: true, index: null })} variant="primary">
                  <BsPlus /> Add Cost Line
                </Button>
              </div>
              <CostLineTable
                lines={asArray(form.costLines)}
                readOnly={readOnly}
                onEdit={(index) => setLineModal({ show: true, index })}
                onRemove={removeLine}
              />
            </Card.Body>
          </Card>

          <Row className="g-4">
            <Col lg={7}>
              <Card className="surface-card h-100">
                <Card.Body>
                  <h5>Template Details</h5>
                  <Row className="g-3">
                    <Col xs={12}>
                      <Form.Label>Template Name</Form.Label>
                      <Form.Control value={form.name} onChange={(event) => patch({ name: event.target.value })} disabled={readOnly} />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Description</Form.Label>
                      <Form.Control as="textarea" rows={3} value={form.description || ""} onChange={(event) => patch({ description: event.target.value })} disabled={readOnly} />
                    </Col>
                    <Col xs={12}>
                      <Form.Label>Internal Notes</Form.Label>
                      <Form.Control as="textarea" rows={3} value={form.internalNotes || ""} onChange={(event) => patch({ internalNotes: event.target.value })} disabled={readOnly} />
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={5}>
              <Card className="surface-card h-100">
                <Card.Body>
                  <h5>Status & Validity</h5>
                  <Row className="g-3">
                    <Col md={6}>
                      <Form.Label>Status</Form.Label>
                      <Form.Select value={form.status} onChange={(event) => patch({ status: event.target.value })} disabled={readOnly}>
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="archived">Archived</option>
                      </Form.Select>
                    </Col>
                    <Col md={6}>
                      <Form.Label>Valid From</Form.Label>
                      <Form.Control type="date" value={form.validFrom} onChange={(event) => patch({ validFrom: event.target.value })} disabled={readOnly} />
                    </Col>
                    <Col md={6}>
                      <Form.Label>Valid To</Form.Label>
                      <Form.Control type="date" value={form.validTo || ""} onChange={(event) => patch({ validTo: event.target.value })} disabled={readOnly} />
                    </Col>
                    <Col md={6}>
                      <Form.Label>Version</Form.Label>
                      <Form.Control value={form.version || 1} disabled />
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Col>
        <Col xl={3}>
          <PreviewPanel
            preview={preview}
            context={previewContext}
            onContextChange={(patchValue) => setPreviewContext((current) => ({ ...current, ...patchValue }))}
            currency={form.currency}
          />
        </Col>
      </Row>

      {!readOnly ? (
        <div className="cost-template-sticky-actions">
          <Button variant="outline-secondary" as={Link} to="/admin/booking-accounting/cost-templates">Cancel</Button>
          <Button variant="outline-primary" disabled={saving} onClick={() => save("draft")}>Save as Draft</Button>
          <Button variant="primary" disabled={saving} onClick={() => save("active")}>Save Template</Button>
        </div>
      ) : null}

      <CostLineModal
        show={lineModal.show}
        line={lineModal.index === null ? null : form.costLines[lineModal.index]}
        basisTypes={basisTypes}
        onHide={() => setLineModal({ show: false, index: null })}
        onSave={saveLine}
      />
    </div>
  );
};
