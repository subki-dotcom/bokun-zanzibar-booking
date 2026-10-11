import Alert from "react-bootstrap/Alert";

const ErrorAlert = ({ error, className = "" }) => {
  if (!error) return null;

  return (
    <Alert variant="danger" className={className}>
      {typeof error === "string" ? error : error.message || "Something went wrong"}
    </Alert>
  );
};

export default ErrorAlert;