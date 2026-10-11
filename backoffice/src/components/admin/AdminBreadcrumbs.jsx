import { Link } from "react-router-dom";

const AdminBreadcrumbs = ({ items = [] }) => {
  const visibleItems = items.filter((item) => item?.label);

  if (!visibleItems.length) return null;

  return (
    <nav className="admin-platform-breadcrumbs" aria-label="Breadcrumb">
      {visibleItems.map((item, index) => {
        const isLast = index === visibleItems.length - 1;

        return (
          <span key={`${item.label}-${index}`} className="admin-platform-breadcrumb-item">
            {item.path && !isLast ? <Link to={item.path}>{item.label}</Link> : <span>{item.label}</span>}
          </span>
        );
      })}
    </nav>
  );
};

export default AdminBreadcrumbs;
