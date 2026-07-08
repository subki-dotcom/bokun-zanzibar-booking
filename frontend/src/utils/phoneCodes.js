import { allCountries } from "country-telephone-data";

const countriesByIso = new Map(
  allCountries.map((country) => [
    String(country.iso2 || country[1] || "").toUpperCase(),
    {
      name: country.name || country[0],
      iso2: String(country.iso2 || country[1] || "").toUpperCase(),
      dialCode: String(country.dialCode || country[2] || "")
    }
  ])
);

const normalizeCountryCode = (countryCode = "") =>
  String(countryCode || "").trim().toUpperCase();

export const getDialCodeForCountry = (countryCode = "") => {
  const country = countriesByIso.get(normalizeCountryCode(countryCode));
  return country?.dialCode ? `+${country.dialCode}` : "";
};

export const getDialCodeFromCountries = (countryCode = "", countries = []) => {
  const matchedCountry = countries.find(
    (country = {}) => String(country.code || "").toUpperCase() === String(countryCode || "").toUpperCase()
  );

  return matchedCountry?.dialCode || getDialCodeForCountry(countryCode);
};

export const resolveDefaultCountryCode = (countries = [], preferredCode = "TZ") => {
  const preferred = countries.find(
    (country = {}) => String(country.code || "").toUpperCase() === String(preferredCode || "").toUpperCase()
  );

  return String(preferred?.code || countries[0]?.code || "").toUpperCase();
};

export const getCountryFlagUrl = (countryCode = "", width = 40) => {
  const code = normalizeCountryCode(countryCode);

  if (!/^[A-Z]{2}$/.test(code)) {
    return "";
  }

  return `https://flagcdn.com/w${Number(width) || 40}/${code.toLowerCase()}.png`;
};

export const countryCodeToFlagEmoji = (countryCode = "") => {
  const code = normalizeCountryCode(countryCode);

  if (!/^[A-Z]{2}$/.test(code)) {
    return "";
  }

  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
};

export const applyDialCodeToPhone = (phone = "", countryCode = "", countries = []) => {
  const dialCode = getDialCodeFromCountries(countryCode, countries);
  const currentPhone = String(phone || "").trim().replace(/\s+/g, "");

  if (!dialCode) {
    return currentPhone;
  }

  if (!currentPhone) {
    return dialCode;
  }

  if (currentPhone.startsWith(dialCode)) {
    return currentPhone;
  }

  if (currentPhone.startsWith("+")) {
    const withoutExistingCode = currentPhone.replace(/^\+\d+\s*/, "").trim();
    return `${dialCode}${withoutExistingCode}`;
  }

  return `${dialCode}${currentPhone}`;
};
