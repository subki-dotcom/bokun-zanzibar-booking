export const buildVisiblePages = ({ page = 1, totalPages = 1 } = {}) => {
  const safeTotal = Math.max(1, Number(totalPages || 1));
  const current = Math.max(1, Math.min(safeTotal, Number(page || 1)));
  const start = Math.max(1, current - 2);
  const end = Math.min(safeTotal, start + 4);
  const adjustedStart = Math.max(1, end - 4);
  const pages = [];

  for (let index = adjustedStart; index <= end; index += 1) {
    pages.push(index);
  }

  return pages;
};
