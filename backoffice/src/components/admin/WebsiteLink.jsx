import { Link } from "react-router-dom";
import { isRunningInBackOffice } from "../../config/appContext";
import { WEBSITE_URL } from "../../config/site";

// Links to customer pages (tours, booking and invoice views). On the website's /admin fallback they stay
// in-app; in the Back Office those routes do not exist, so they open the website in a new tab.
const WebsiteLink = ({ to, children, ...props }) =>
  isRunningInBackOffice() ? (
    <a href={`${WEBSITE_URL}${to}`} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ) : (
    <Link to={to} {...props}>
      {children}
    </Link>
  );

export default WebsiteLink;
