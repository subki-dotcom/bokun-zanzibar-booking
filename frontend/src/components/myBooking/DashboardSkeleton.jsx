// Loading shapes that match the booking page cards (hero, key facts, day, pickup, ticket, receipt).
const Line = ({ width = "100%", height = 14, style = {} }) => <span className="mb-skel" style={{ display: "block", width, height, ...style }} />;

const DashboardSkeleton = () => (
  <div aria-hidden="true">
    <div className="mb-hero is-skeleton">
      <div className="mb-container">
        <Line width={220} height={12} />
        <Line width={170} height={28} style={{ marginTop: 16, borderRadius: 999 }} />
        <Line width="min(520px, 80%)" height={44} style={{ marginTop: 16 }} />
        <Line width="min(420px, 70%)" height={16} style={{ marginTop: 12 }} />
      </div>
    </div>
    <div className="mb-container">
      <div className="mb-layout">
        <div className="mb-main">
          <div className="mb-facts">
            {[0, 1, 2, 3].map((index) => (
              <div className="mb-fact" key={index}>
                <Line width={44} height={44} style={{ borderRadius: 12, flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <Line width="50%" height={10} />
                  <Line width="80%" height={14} style={{ marginTop: 8 }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mb-card mb-section">
            <Line width={90} height={10} />
            <Line width="60%" height={22} style={{ marginTop: 12 }} />
            {[0, 1, 2, 3].map((index) => (
              <Line key={index} width={`${90 - index * 10}%`} height={14} style={{ marginTop: 18 }} />
            ))}
          </div>
          <div className="mb-card mb-pickup">
            <div className="mb-map" />
            <div className="mb-pickup-body">
              <Line width={100} height={10} />
              <Line width="70%" height={20} style={{ marginTop: 12 }} />
              <Line width="55%" height={14} style={{ marginTop: 12 }} />
            </div>
          </div>
        </div>
        <div className="mb-side">
          <div className="mb-ticket">
            <div className="mb-ticket-bar" />
            <div className="mb-ticket-body">
              <Line width="70%" height={16} />
              <Line width="90%" height={14} style={{ marginTop: 16 }} />
              <Line width="90%" height={14} style={{ marginTop: 12 }} />
              <Line width={96} height={96} style={{ marginTop: 20, borderRadius: 10 }} />
              <Line width="100%" height={48} style={{ marginTop: 16, borderRadius: 999 }} />
            </div>
          </div>
          <div className="mb-card mb-receipt">
            <Line width="40%" height={16} />
            <Line width="100%" height={12} style={{ marginTop: 16 }} />
            <Line width="100%" height={36} style={{ marginTop: 16, borderRadius: 10 }} />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default DashboardSkeleton;
