import BookingAvailabilityCard from "./bookingCard/BookingAvailabilityCard";

const StickyAvailabilityCard = ({
  tour = {},
  selectedOption = null,
  selectedStartTime = "",
  initialSelection = null,
  onLiveAvailabilityChecked
}) => (
  <BookingAvailabilityCard
    tour={tour}
    selectedOption={selectedOption}
    selectedStartTime={selectedStartTime}
    initialSelection={initialSelection}
    onLiveAvailabilityChecked={onLiveAvailabilityChecked}
  />
);

export default StickyAvailabilityCard;
