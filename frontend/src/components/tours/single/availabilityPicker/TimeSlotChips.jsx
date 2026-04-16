const normalizeTimeToken = (value = "") => {
  const token = String(value || "").trim();
  if (!token) {
    return "";
  }

  const match = token.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return token;
  }

  return `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`;
};

const TimeSlotChips = ({ slots = [], value = "", onChange, disabled = false }) => {
  const normalizedSelected = normalizeTimeToken(value);
  const rows = (Array.isArray(slots) ? slots : [])
    .map((slot = {}) => ({
      time: normalizeTimeToken(slot.time),
      capacityLeft: Math.max(0, Number(slot.capacityLeft || 0))
    }))
    .filter((slot) => slot.time);

  if (!rows.length) {
    return <div className="availability-time-empty">Time is confirmed after option selection</div>;
  }

  return (
    <div className="availability-time-grid">
      {rows.map((slot) => {
        const isActive = slot.time === normalizedSelected;
        const leftLabel =
          slot.capacityLeft > 0 && slot.capacityLeft < 1000 ? ` (${slot.capacityLeft} left)` : "";

        return (
          <button
            key={slot.time}
            type="button"
            className={`availability-time-chip ${isActive ? "is-active" : ""}`.trim()}
            onClick={() => onChange?.(slot.time)}
            disabled={disabled}
          >
            {slot.time}
            {leftLabel}
          </button>
        );
      })}
    </div>
  );
};

export default TimeSlotChips;
