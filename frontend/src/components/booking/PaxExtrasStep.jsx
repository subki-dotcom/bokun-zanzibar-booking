import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";

const resolveCatalogId = (catalog = {}) =>
  String(catalog?.activityPriceCatalogId || catalog?.catalogId || "").trim();

const PaxExtrasStep = ({
  pax,
  setPax,
  selectedPriceCatalogId = "",
  setSelectedPriceCatalogId,
  availablePriceCatalogs = [],
  onRefreshAvailability,
  loading = false,
  priceCategoryParticipants = [],
  setPriceCategoryParticipants,
  availablePriceCategories = [],
  extras,
  setExtras,
  availableExtras = [],
  onBack,
  onNext
}) => {
  const buildParticipantsFromCategories = (categories = []) =>
    (categories || []).map((category) => ({
      categoryId: String(category.categoryId || ""),
      title: category.title || "Category",
      ticketCategory: category.ticketCategory || "",
      quantity: Math.max(0, Number(category.quantity || 0))
    }));

  const effectiveParticipants =
    (priceCategoryParticipants || []).length > 0
      ? priceCategoryParticipants
      : buildParticipantsFromCategories(availablePriceCategories);

  const updatePax = (field, value) => {
    const parsed = Math.max(0, Number(value || 0));
    setPax((prev) => ({ ...prev, [field]: parsed }));
  };

  const usesPriceCategories = availablePriceCategories.length > 0;
  const hasMultipleCatalogs = (availablePriceCatalogs || []).filter((catalog) => catalog.active !== false).length > 1;

  const updateCategoryQuantity = (categoryId, value, minQuantity = 0, maxQuantity = 50) => {
    const parsed = Math.max(Number(minQuantity || 0), Number(value || 0));
    const safeQuantity = Math.min(Number(maxQuantity || 50), parsed);

    const baseParticipants =
      (priceCategoryParticipants || []).length > 0
        ? priceCategoryParticipants
        : buildParticipantsFromCategories(availablePriceCategories);

    const hasRow = baseParticipants.some((item) => String(item.categoryId) === String(categoryId));
    const next = baseParticipants.map((item) =>
      String(item.categoryId) === String(categoryId)
        ? {
            ...item,
            quantity: safeQuantity
          }
        : item
    );

    if (!hasRow) {
      const category = (availablePriceCategories || []).find(
        (item) => String(item.categoryId) === String(categoryId)
      );
      next.push({
        categoryId: String(categoryId),
        title: category?.title || "Category",
        ticketCategory: category?.ticketCategory || "",
        quantity: safeQuantity
      });
    }

    setPriceCategoryParticipants(next.filter((item) => String(item.categoryId || "")));
  };

  const toggleExtra = (extra) => {
    const extraCode = String(extra.code);
    const existing = extras.find((item) => String(item.code) === extraCode);

    if (existing) {
      setExtras(extras.filter((item) => String(item.code) !== extraCode));
      return;
    }

    setExtras([
      ...extras,
      {
        code: extraCode,
        label: extra.label,
        amount: Number(extra.amount || 0),
        quantity: 1
      }
    ]);
  };

  const updateExtraQuantity = (code, value, maxQuantity = 10) => {
    const parsed = Math.max(1, Number(value || 1));
    const safeQuantity = Math.min(Math.max(1, Number(maxQuantity || 1)), parsed);

    setExtras(
      extras.map((item) =>
        String(item.code) === String(code)
          ? {
              ...item,
              quantity: safeQuantity
            }
          : item
      )
    );
  };

  const selectedPaxTotal = usesPriceCategories
    ? effectiveParticipants.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    : Number(pax.adults || 0) + Number(pax.children || 0) + Number(pax.infants || 0);

  return (
    <Card className="surface-card">
      <Card.Body>
        <h4 className="mb-3">Pax & Extras</h4>

        {hasMultipleCatalogs ? (
          <Form.Group className="mb-3">
            <Form.Label>Price catalog</Form.Label>
            <Form.Select
              value={selectedPriceCatalogId || ""}
              onChange={async (event) => {
                const nextCatalogId = event.target.value;
                setSelectedPriceCatalogId(nextCatalogId);
                if (typeof onRefreshAvailability === "function") {
                  await onRefreshAvailability(nextCatalogId);
                }
              }}
            >
              {(availablePriceCatalogs || [])
                .filter((catalog) => catalog.active !== false)
                .map((catalog) => (
                  <option key={resolveCatalogId(catalog)} value={resolveCatalogId(catalog)}>
                    {catalog.title}
                  </option>
                ))}
            </Form.Select>
          </Form.Group>
        ) : null}

        {usesPriceCategories ? (
          <div className="d-grid gap-3">
            {availablePriceCategories.map((category) => {
              const categoryId = String(category.categoryId);
              const selected = effectiveParticipants.find((item) => String(item.categoryId) === categoryId);
              const quantity = Number(selected?.quantity ?? category.quantity ?? 0);
              const minQuantity = Math.max(0, Number(category.minQuantity || 0));
              const maxQuantity = Math.max(minQuantity, Number(category.maxQuantity || 50));

              return (
                <div key={categoryId} className="border rounded p-3">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <strong>{category.title}</strong>
                    <small className="text-muted">{category.ticketCategory || "Passenger"}</small>
                  </div>
                  <Form.Control
                    type="number"
                    min={minQuantity}
                    max={maxQuantity}
                    value={quantity}
                    onChange={(event) =>
                      updateCategoryQuantity(categoryId, event.target.value, minQuantity, maxQuantity)
                    }
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="row g-3">
            <div className="col-md-4">
              <Form.Label>Adults</Form.Label>
              <Form.Control type="number" min={1} value={pax.adults} onChange={(e) => updatePax("adults", e.target.value)} />
            </div>
            <div className="col-md-4">
              <Form.Label>Children</Form.Label>
              <Form.Control
                type="number"
                min={0}
                value={pax.children}
                onChange={(e) => updatePax("children", e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <Form.Label>Infants</Form.Label>
              <Form.Control
                type="number"
                min={0}
                value={pax.infants}
                onChange={(e) => updatePax("infants", e.target.value)}
              />
            </div>
          </div>
        )}

        {availableExtras.length > 0 ? (
          <>
            <hr />

            <h6 className="mb-2">Optional extras</h6>
            <div className="d-grid gap-3">
              {availableExtras.map((extra) => {
                const code = String(extra.code);
                const selected = extras.find((item) => String(item.code) === code);
                const checked = Boolean(selected);
                const maxQuantity = Math.max(1, Number(extra.maxQuantity || 1));

                return (
                  <div key={code} className="border rounded p-2">
                    <Form.Check
                      type="checkbox"
                      id={`extra-${code}`}
                      checked={checked}
                      onChange={() => toggleExtra(extra)}
                      label={`${extra.label} (+${extra.currency || "USD"} ${extra.amount})`}
                    />
                    {extra.description ? <small className="text-muted d-block ms-4">{extra.description}</small> : null}
                    {checked ? (
                      <div className="ms-4 mt-2 d-flex align-items-center gap-2">
                        <small className="text-muted">Qty</small>
                        <Form.Control
                          type="number"
                          min={1}
                          max={maxQuantity}
                          value={selected.quantity || 1}
                          onChange={(event) => updateExtraQuantity(code, event.target.value, maxQuantity)}
                          className="extra-qty-input"
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        <div className="checkout-action-row mt-4">
          <Button variant="outline-secondary" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button className="premium-btn text-white" onClick={onNext} disabled={selectedPaxTotal < 1 || loading}>
            {loading ? "Loading Live Quote..." : "Continue"}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default PaxExtrasStep;
