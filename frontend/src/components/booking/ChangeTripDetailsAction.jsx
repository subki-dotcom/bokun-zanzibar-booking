import Button from "react-bootstrap/Button";
import { BsArrowRepeat } from "react-icons/bs";

const ChangeTripDetailsAction = ({ onClick, className = "", disabled = false }) => (
  <Button
    type="button"
    variant="outline-secondary"
    className={`change-trip-btn ${className}`.trim()}
    onClick={onClick}
    disabled={disabled}
  >
    <BsArrowRepeat className="me-2" />
    Change trip details
  </Button>
);

export default ChangeTripDetailsAction;

