const SALES_CHANNEL = {
  DIRECT_WEBSITE: "DIRECT_WEBSITE",
  VIATOR: "VIATOR",
  GETYOURGUIDE: "GETYOURGUIDE",
  BOKUN_MARKETPLACE: "BOKUN_MARKETPLACE",
  AGENT: "AGENT",
  B2B: "B2B",
  HOTEL: "HOTEL",
  WHATSAPP: "WHATSAPP",
  WALK_IN: "WALK_IN",
  TOURHQ: "TOURHQ",
  AIRBNB: "AIRBNB",
  OTHER: "OTHER"
};

const normalizeText = (value = "") =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

const extractLabel = (value = null) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return normalizeText(value);
  if (typeof value !== "object") return normalizeText(String(value));

  return normalizeText(
    value.title ||
      value.name ||
      value.label ||
      value.code ||
      value.systemType ||
      value.externalBookingEntityName ||
      value.externalBookingEntityCode ||
      value.id ||
      ""
  );
};

const addCandidate = (candidates, value, source) => {
  const label = extractLabel(value);
  if (!label) return;
  candidates.push({ source, value: label });
};

const extractBokunChannelCandidates = (raw = {}) => {
  const root = raw?.booking || raw?.raw?.booking || raw?.raw || raw || {};
  const candidates = [];

  addCandidate(candidates, root.channel, "channel");
  addCandidate(candidates, root.bookingChannel, "bookingChannel");
  addCandidate(candidates, root.bookingSource, "bookingSource");
  addCandidate(candidates, root.source, "source");
  addCandidate(candidates, root.seller, "seller");
  addCandidate(candidates, root.agent, "agent");
  addCandidate(candidates, root.agentUser, "agentUser");
  addCandidate(candidates, root.affiliate, "affiliate");
  addCandidate(candidates, root.externalBookingEntityName, "externalBookingEntityName");
  addCandidate(candidates, root.externalBookingEntityCode, "externalBookingEntityCode");
  addCandidate(candidates, root.integratedSystem, "integratedSystem");

  return candidates;
};

const mapCandidateToSalesChannel = (candidate = {}) => {
  const value = String(candidate.value || "").trim();
  const token = value.toLowerCase();
  if (!token) return null;

  if (token.includes("getyourguide") || token.includes("get your guide") || token === "gyg") {
    return SALES_CHANNEL.GETYOURGUIDE;
  }

  if (token.includes("viator")) {
    return SALES_CHANNEL.VIATOR;
  }

  if (token.includes("tourhq") || token.includes("tour hq")) {
    return SALES_CHANNEL.TOURHQ;
  }

  if (token.includes("airbnb")) {
    return SALES_CHANNEL.AIRBNB;
  }

  if (token.includes("whatsapp") || token.includes("wa.me")) {
    return SALES_CHANNEL.WHATSAPP;
  }

  if (token.includes("walk") && token.includes("in")) {
    return SALES_CHANNEL.WALK_IN;
  }

  if (token.includes("hotel")) {
    return SALES_CHANNEL.HOTEL;
  }

  if (token.includes("b2b") || token.includes("business")) {
    return SALES_CHANNEL.B2B;
  }

  if (candidate.source === "agent" || candidate.source === "agentUser" || token.includes("agent")) {
    return SALES_CHANNEL.AGENT;
  }

  if (token.includes("marketplace")) {
    return SALES_CHANNEL.BOKUN_MARKETPLACE;
  }

  if (
    token.includes("direct") ||
    token.includes("website") ||
    token.includes("api") ||
    token.includes("riser tours") ||
    token.includes("zanzibar")
  ) {
    return SALES_CHANNEL.DIRECT_WEBSITE;
  }

  return null;
};

const mapBokunSalesChannel = (raw = {}, fallback = "") => {
  const candidates = extractBokunChannelCandidates(raw);

  for (const candidate of candidates) {
    const mapped = mapCandidateToSalesChannel(candidate);
    if (mapped) {
      return {
        salesChannel: mapped,
        rawChannel: candidate.value,
        sourceField: candidate.source,
        candidates
      };
    }
  }

  const fallbackToken = String(fallback || "").trim().toLowerCase();
  if (fallbackToken === "direct_website") {
    return {
      salesChannel: SALES_CHANNEL.DIRECT_WEBSITE,
      rawChannel: fallback,
      sourceField: "fallback",
      candidates
    };
  }

  if (fallbackToken === "agent") {
    return {
      salesChannel: SALES_CHANNEL.AGENT,
      rawChannel: fallback,
      sourceField: "fallback",
      candidates
    };
  }

  return {
    salesChannel: SALES_CHANNEL.OTHER,
    rawChannel: candidates[0]?.value || fallback || "",
    sourceField: candidates[0]?.source || (fallback ? "fallback" : ""),
    candidates
  };
};

module.exports = {
  SALES_CHANNEL,
  extractBokunChannelCandidates,
  mapBokunSalesChannel
};
