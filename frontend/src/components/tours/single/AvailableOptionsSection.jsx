import { Button, Card } from "react-bootstrap";
import OptionCard from "./OptionCard";

const AvailableOptionsSection = ({
  tour = {},
  options = [],
  selectedOptionId = "",
  onSelectOption,
  adults = 1,
  availabilityResult = null,
  onClearAvailabilityFilter,
  travelDate = "",
  onOptionStartTimeChange,
  selectedPriceCatalogId = ""
}) => {
  const hasDateFilter = Boolean(availabilityResult);
  const availableCount = Number(availabilityResult?.availableCount || 0);
  const totalOptions = Number(availabilityResult?.totalOptions || 0);
  const liveComparedAdults = Number(availabilityResult?.comparedAdults || adults || 1);
  const resolvedTravelDate = availabilityResult?.travelDate || "selected date";

  return (
    <section className="single-tour-section">
      <div className="single-tour-section-head">
        <h3>Available options</h3>
        <p>
          {hasDateFilter
            ? `Showing ${availableCount} of ${totalOptions} option(s) available on ${resolvedTravelDate}.`
            : "Live pricing and availability are confirmed after you select a date."}
        </p>
        {hasDateFilter ? (
          <Button
            variant="outline-secondary"
            size="sm"
            className="mt-2"
            onClick={onClearAvailabilityFilter}
          >
            Show all options
          </Button>
        ) : null}
      </div>

      {options.length ? (
        <div className="single-options-grid">
          {options.map((option) => (
            <OptionCard
              key={option.bokunOptionId || option.name}
              option={option}
              tour={tour}
              hasDateFilter={hasDateFilter}
              liveComparedAdults={liveComparedAdults}
              liveAvailability={option.liveAvailability || null}
              selectedStartTime={option.selectedStartTime || ""}
              travelDate={travelDate}
              adults={liveComparedAdults}
              onChangeStartTime={onOptionStartTimeChange}
              selectedPriceCatalogId={selectedPriceCatalogId}
              isSelected={String(selectedOptionId) === String(option.bokunOptionId)}
              onSelect={onSelectOption}
            />
          ))}
        </div>
      ) : (
        <Card className="single-tour-empty-card">
          <Card.Body>
            <h5 className="mb-2">
              {hasDateFilter ? "No option available for selected date" : "Options are being refreshed"}
            </h5>
            {hasDateFilter ? (
              <p className="mb-0">
                Try another date to check live availability from Bokun. Departure time and final slots may change by
                date.
              </p>
            ) : (
              <p className="mb-0">
                This product currently has no active options in the local snapshot. Please run sync and retry.
              </p>
            )}
          </Card.Body>
        </Card>
      )}
    </section>
  );
};

export default AvailableOptionsSection;
