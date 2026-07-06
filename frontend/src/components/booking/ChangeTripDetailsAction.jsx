import Button from "react-bootstrap/Button";
import { BsArrowRepeat } from "react-icons/bs";

const ChangeTripDetailsAction = ({ onClick, className = "", disabled = false, icon = <BsArrowRepeat />, label = "Change trip details" }) => (
  <Button
    type="button"
    variant="outline-secondary"
    className={`change-trip-btn ${className}`.trim()}
    onClick={onClick}
    disabled={disabled}
  >
    <span className="change-trip-icon">{icon}</span>
    {label}
  </Button>
);

export default ChangeTripDetailsAction;
