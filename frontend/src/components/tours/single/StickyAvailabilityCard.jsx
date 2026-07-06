import BookingAvailabilityCard from "./bookingCard/BookingAvailabilityCard";

const StickyAvailabilityCard = ({
  tour = {},
  selectedOption = null,
  selectedStartTime = "",
  initialSelection = null,
  onLiveAvailabilityChecked,
  hideContinueButton = false,
  checkoutPath = "",
  sessionSource = "single_product_page"
}) => (
  <BookingAvailabilityCard
    tour={tour}
    selectedOption={selectedOption}
    selectedStartTime={selectedStartTime}
    initialSelection={initialSelection}
    onLiveAvailabilityChecked={onLiveAvailabilityChecked}
    hideContinueButton={hideContinueButton}
    checkoutPath={checkoutPath}
    sessionSource={sessionSource}
  />
);

export default StickyAvailabilityCard;
