import BookingAvailabilityCard from "./bookingCard/BookingAvailabilityCard";

const StickyAvailabilityCard = ({
  tour = {},
  selectedOption = null,
  selectedStartTime = "",
  initialSelection = null,
  onLiveAvailabilityChecked,
  onStartingPrice,
  onPrefetchAvailability,
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
    onStartingPrice={onStartingPrice}
    onPrefetchAvailability={onPrefetchAvailability}
    hideContinueButton={hideContinueButton}
    checkoutPath={checkoutPath}
    sessionSource={sessionSource}
  />
);

export default StickyAvailabilityCard;
