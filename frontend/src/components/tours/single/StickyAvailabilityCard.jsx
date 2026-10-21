import BookingAvailabilityCard from "./bookingCard/BookingAvailabilityCard";

const StickyAvailabilityCard = ({
  tour = {},
  selectedOption = null,
  selectedStartTime = "",
  initialSelection = null,
  onLiveAvailabilityChecked,
  onStartingPrice,
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
    hideContinueButton={hideContinueButton}
    checkoutPath={checkoutPath}
    sessionSource={sessionSource}
  />
);

export default StickyAvailabilityCard;
