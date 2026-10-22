// Month grid for the tour calendar. Dates are ISO strings (YYYY-MM-DD) in the guest's local calendar.
export const toIsoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const parseIsoDate = (iso = "") => {
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};

// Weeks (Monday first) of the month that contains `monthStart`; days outside the month are null.
// weekStartsOn: 1 = Monday (default), 0 = Sunday.
export const monthWeeks = (monthStart, weekStartsOn = 1) => {
  const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => toIsoDate(new Date(first.getFullYear(), first.getMonth(), index + 1)))
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
};

// A date can be chosen when it is today or later and, inside the range Bókun answered for, has a bookable time.
// Outside that range (or when availability could not be loaded) it stays selectable and is checked as before.
export const isSelectableDate = (iso, { today, availability = null } = {}) => {
  if (!iso || iso < today) return false;
  if (!availability) return true;
  if (iso < availability.startDate || iso > availability.endDate) return true;
  return availability.dates.has(iso);
};
