import { allCountries } from "country-telephone-data";

const countriesByIso = new Map(
  allCountries.map((country) => [
    String(country.iso2 || country[1] || "").toUpperCase(),
    {
      name: country.name || country[0],
      iso2: String(country.iso2 || country[1] || "").toUpperCase(),
      dialCode: String(country.dialCode || country[2] || ""),
      format: String(country.format || country[4] || "")
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

const cleanPhoneInput = (phone = "") => {
  const value = String(phone || "").trim();
  const digits = value.replace(/\D/g, "");

  return {
    digits,
    hasLeadingPlus: value.startsWith("+")
  };
};

export const isValidInternationalPhoneNumber = (phone = "") =>
  /^\+[1-9]\d{7,14}$/.test(String(phone || "").trim());

export const applyDialCodeToPhone = (phone = "", countryCode = "", countries = []) => {
  const dialCode = getDialCodeFromCountries(countryCode, countries);
  const currentPhone = String(phone || "").trim();
  const { digits, hasLeadingPlus } = cleanPhoneInput(currentPhone);

  if (!dialCode) {
    return digits ? `+${digits}` : "";
  }

  if (!currentPhone) {
    return dialCode;
  }

  if (hasLeadingPlus) {
    return digits ? `+${digits}` : dialCode;
  }

  const dialDigits = dialCode.replace(/\D/g, "");
  if (digits.startsWith(dialDigits)) {
    return `+${digits}`;
  }

  return `${dialCode}${digits.replace(/^0+/, "")}`;
};

export const replacePhoneDialCode = (
  phone = "",
  previousCountryCode = "",
  nextCountryCode = "",
  countries = []
) => {
  const previousDialCode = getDialCodeFromCountries(previousCountryCode, countries);
  const nextDialCode = getDialCodeFromCountries(nextCountryCode, countries);
  const normalizedPhone = applyDialCodeToPhone(phone, previousCountryCode, countries);

  if (!nextDialCode) {
    return normalizedPhone;
  }

  if (!normalizedPhone || normalizedPhone === previousDialCode) {
    return nextDialCode;
  }

  if (previousDialCode && normalizedPhone.startsWith(previousDialCode)) {
    const nationalNumber = normalizedPhone.slice(previousDialCode.length).replace(/^0+/, "");
    return `${nextDialCode}${nationalNumber}`;
  }

  return applyDialCodeToPhone(normalizedPhone, nextCountryCode, countries);
};

export const getPhoneFormatExample = (countryCode = "", countries = []) => {
  const code = normalizeCountryCode(countryCode);
  const country = countriesByIso.get(code);
  const dialCode = getDialCodeFromCountries(code, countries);
  const format = country?.format || "";
  const formatDigitCount = (format.match(/\./g) || []).length;

  if (!dialCode) {
    return "+255778775044";
  }

  if (formatDigitCount < 8 || formatDigitCount > 15) {
    return `${dialCode}712345678`;
  }

  const exampleDigits = `${dialCode.replace(/\D/g, "")}712345678901234`;
  let digitIndex = 0;
  return format.replace(/\./g, () => exampleDigits[digitIndex++] || "0");
};

export const validatePhoneNumber = (phone = "", countryCode = "", countries = []) => {
  const normalized = applyDialCodeToPhone(phone, countryCode, countries);
  const dialCode = getDialCodeFromCountries(countryCode, countries);
  const code = normalizeCountryCode(countryCode);
  const country = countriesByIso.get(code);
  const selectedCountry = countries.find(
    (item = {}) => normalizeCountryCode(item.code) === code
  );
  const countryName = selectedCountry?.title || country?.name || "the selected country";
  const example = getPhoneFormatExample(code, countries);

  if (!normalized || normalized === dialCode) {
    return {
      isValid: false,
      normalized,
      message: `Enter your phone number in international format, for example ${example}.`
    };
  }

  if (!isValidInternationalPhoneNumber(normalized)) {
    return {
      isValid: false,
      normalized,
      message: `Enter a valid phone number with 8 to 15 digits, for example ${example}.`
    };
  }

  if (dialCode && !normalized.startsWith(dialCode)) {
    return {
      isValid: false,
      normalized,
      message: `Use the ${dialCode} country code for ${countryName}, or select the correct country.`
    };
  }

  const expectedDigitCount = (country?.format.match(/\./g) || []).length;
  const actualDigitCount = normalized.replace(/\D/g, "").length;
  if (expectedDigitCount >= 8 && expectedDigitCount <= 15 && actualDigitCount !== expectedDigitCount) {
    return {
      isValid: false,
      normalized,
      message: `Enter a valid ${countryName} phone number, for example ${example}.`
    };
  }

  return {
    isValid: true,
    normalized,
    message: ""
  };
};
