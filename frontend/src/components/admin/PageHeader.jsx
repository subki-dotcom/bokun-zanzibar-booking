const PageHeader = ({ eyebrow, title, description, actions = null }) => (
  <div className="admin-platform-page-header">
    <div>
      {eyebrow ? <span className="admin-platform-eyebrow">{eyebrow}</span> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
    {actions ? <div className="admin-platform-page-actions">{actions}</div> : null}
  </div>
);

export default PageHeader;
