import { useMemo } from "react";
import { Modal, Offcanvas } from "react-bootstrap";
import AvailabilitySummaryBar from "./AvailabilitySummaryBar";
import AvailabilityLoadingState from "./AvailabilityLoadingState";
import AvailabilityEmptyState from "./AvailabilityEmptyState";
import AvailabilityErrorState from "./AvailabilityErrorState";
import AvailabilityOptionCard from "./AvailabilityOptionCard";

const deriveLanguageLabel = (options = []) => {
  const uniqueLanguages = Array.from(
    new Set(
      (Array.isArray(options) ? options : [])
        .map((option) => String(option?.language || "").trim())
        .filter(Boolean)
    )
  );

  if (!uniqueLanguages.length) {
    return "Language per option";
  }

  if (uniqueLanguages.length === 1) {
    return uniqueLanguages[0];
  }

  return "Multiple language options";
};

const resolveBadgeByIndex = (index = 0) => {
  if (index === 0) return "Best value";
  if (index === 1) return "Popular";
  if (index === 2) return "Premium";
  return "";
};

const AvailabilityOptionModal = ({
  show = false,
  isDesktop = true,
  loading = false,
  error = "",
  options = [],
  selectedOptionId = "",
  travelDate = "",
  pax = { adults: 1, children: 0, infants: 0 },
  selectedRateLabel = "",
  selectedStartTimesByOption = {},
  onClose,
  onEditSearch,
  onSelectOption,
  onChangeStartTime,
  onContinue
}) => {
  const languageLabel = useMemo(() => deriveLanguageLabel(options), [options]);
  const hasOptions = Array.isArray(options) && options.length > 0;

  const content = (
    <div className="availability-picker-body">
      <AvailabilitySummaryBar
        travelDate={travelDate}
        pax={pax}
        selectedRateLabel={selectedRateLabel}
        languageLabel={languageLabel}
        onEditSearch={onEditSearch}
      />

      {loading ? <AvailabilityLoadingState /> : null}
      {!loading && error ? <AvailabilityErrorState message={error} onEditSearch={onEditSearch} /> : null}
      {!loading && !error && !hasOptions ? <AvailabilityEmptyState onEditSearch={onEditSearch} /> : null}

      {!loading && !error && hasOptions ? (
        <div className="availability-option-list">
          {options.map((option, index) => (
            <AvailabilityOptionCard
              key={option?.bokunOptionId || option?.name || `option-${index}`}
              option={option}
              badge={resolveBadgeByIndex(index)}
              selected={String(selectedOptionId) === String(option?.bokunOptionId || "")}
              selectedTime={selectedStartTimesByOption[String(option?.bokunOptionId || "")] || ""}
              onSelectOption={onSelectOption}
              onChangeTime={onChangeStartTime}
              onContinue={onContinue}
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  if (isDesktop) {
    return (
      <Modal
        show={show}
        onHide={onClose}
        size="xl"
        centered
        dialogClassName="availability-picker-modal"
        contentClassName="availability-picker-modal-content"
      >
        <Modal.Header closeButton>
          <Modal.Title>Choose your option</Modal.Title>
        </Modal.Header>
        <Modal.Body>{content}</Modal.Body>
      </Modal>
    );
  }

  return (
    <Offcanvas
      show={show}
      onHide={onClose}
      placement="bottom"
      className="availability-picker-sheet"
    >
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>Choose your option</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>{content}</Offcanvas.Body>
    </Offcanvas>
  );
};

export default AvailabilityOptionModal;
