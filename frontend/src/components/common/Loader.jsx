import Spinner from "react-bootstrap/Spinner";

const Loader = ({ message = "Loading..." }) => (
  <div className="d-flex align-items-center justify-content-center py-5 gap-3">
    <Spinner animation="border" variant="info" />
    <span>{message}</span>
  </div>
);

export default Loader;