import { toPlainText } from "../../../utils/formatters";

export const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1512100356356-de1b84283e18?auto=format&fit=crop&w=1600&q=80";

const normalizeValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return toPlainText(String(value));
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item))
      .filter(Boolean)
      .join(" ");
  }

  if (typeof value === "object") {
    const keys = ["title", "name", "label", "description", "text", "value", "content"];
    for (const key of keys) {
      if (value[key]) {
        const picked = normalizeValue(value[key]);
        if (picked) {
          return picked;
        }
      }
    }

    return Object.values(value)
      .map((item) => normalizeValue(item))
      .filter(Boolean)
      .join(" ");
  }

  return "";
};

export const toTextList = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => toTextList(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const normalized = normalizeValue(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s*(?:\||\n|;|\u2022)\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

export const uniqueText = (...groups) => {
  const seen = new Set();
  const items = [];

  groups
    .flat()
    .forEach((rawItem) => {
      const item = String(rawItem || "").trim();
      if (!item) {
        return;
      }

      const key = item.toLowerCase();
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      items.push(item);
    });

  return items;
};

export const getGuideLabel = (guideInfo) => {
  if (!guideInfo || typeof guideInfo !== "object") {
    return "";
  }

  if (!guideInfo.supported) {
    return "";
  }

  const languages = Array.isArray(guideInfo.languages)
    ? guideInfo.languages.map((language) => String(language || "").trim()).filter(Boolean)
    : [];

  if (languages.length) {
    return languages.join(", ");
  }

  return guideInfo.guidanceType || "Live guide available";
};

export const buildExperienceDetails = (tour = {}) => {
  const categories = Array.isArray(tour.categories) ? tour.categories.filter(Boolean) : [];
  const guideLabel = getGuideLabel(tour.liveTourGuide);

  return [
    { label: "Experience type", value: tour.experienceType || "Not specified" },
    { label: "Duration", value: tour.duration || "Not specified" },
    { label: "Categories", value: categories.length ? categories.join(", ") : "Not specified" },
    { label: "Live tour guide", value: guideLabel || "Not specified" },
    { label: "Difficulty", value: tour.difficulty || "Not specified" }
  ];
};

export const buildItinerary = (tour = {}) => {
  const productItinerary = toTextList(tour.itinerary);
  const optionItinerary = (tour.options || []).flatMap((option) => toTextList(option?.itinerary));
  return uniqueText(productItinerary, optionItinerary);
};

export const buildQuickHighlights = (tour = {}) => {
  const optionsCount = (tour.options || []).filter((option) => option.active !== false).length;
  const categories = Array.isArray(tour.categories) ? tour.categories.filter(Boolean) : [];
  const firstCategory = categories[0] || "Tours & Activities";

  return [
    {
      label: "Duration",
      value: tour.duration || "Flexible"
    },
    {
      label: "Destination",
      value: tour.destination || "Zanzibar"
    },
    {
      label: "Options",
      value: `${optionsCount || 0} available`
    },
    {
      label: "Category",
      value: firstCategory
    }
  ];
};

export const splitDescription = (description = "") => {
  const plain = toPlainText(description || "");
  if (!plain) {
    return [];
  }

  const sentences = plain
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 2) {
    return [plain];
  }

  const paragraphs = [];
  for (let index = 0; index < sentences.length; index += 2) {
    paragraphs.push(`${sentences[index]} ${sentences[index + 1] || ""}`.trim());
  }

  return paragraphs;
};
