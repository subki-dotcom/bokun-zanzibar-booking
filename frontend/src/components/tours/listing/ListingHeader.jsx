const ListingHeader = ({ totalItems = 0, filteredCount = 0 }) => (
  <section className="listing-hero">
    <div className="listing-hero-copy">
      <div className="listing-eyebrow">Zanzibar Experiences</div>
      <h1>
        Tours & <span className="listing-title-accent">Activities</span>
      </h1>
      <p>Discover bookable Zanzibar experiences with live pricing and availability.</p>
    </div>
    <div className="listing-hero-stats">
      <article className="listing-stat-card">
        <span>Total tours</span>
        <strong>{(totalItems || 0).toLocaleString()}</strong>
      </article>
      <article className="listing-stat-card is-soft">
        <span>Results on this page</span>
        <strong>{(filteredCount || 0).toLocaleString()}</strong>
      </article>
    </div>
  </section>
);

export default ListingHeader;
