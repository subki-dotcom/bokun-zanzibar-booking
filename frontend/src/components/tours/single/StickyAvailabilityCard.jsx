import BookingAvailabilityCard from "./bookingCard/BookingAvailabilityCard";

const StickyAvailabilityCard = ({
  tour = {},
  selectedOption = null,
  selectedStartTime = "",
  initialSelection = null,
  onLiveAvailabilityChecked,
  hideContinueButton = false
}) => (
  <BookingAvailabilityCard
    tour={tour}
    selectedOption={selectedOption}
    selectedStartTime={selectedStartTime}
    initialSelection={initialSelection}
    onLiveAvailabilityChecked={onLiveAvailabilityChecked}
    hideContinueButton={hideContinueButton}
  />
);

export default StickyAvailabilityCard;
