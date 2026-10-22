// Phone numbers for checkout: country calling codes and validation with libphonenumber-js.
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js";
import { browserCountryCode } from "../../utils/phoneCodes.js";

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

// Every country with its calling code, sorted by name: { iso: "GB", name: "United Kingdom", dial: "44" }.
export const PHONE_COUNTRIES = getCountries()
  .map((iso) => ({ iso, name: regionNames?.of(iso) || iso, dial: String(getCountryCallingCode(iso)) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const byIso = new Map(PHONE_COUNTRIES.map((country) => [country.iso, country]));

export const phoneCountry = (iso = "") => byIso.get(String(iso || "").toUpperCase()) || null;

// The guest's country from the browser language ("en-GB" -> GB); Tanzania when the browser names no region.
export const defaultPhoneCountry = (languages) => {
  const detected = browserCountryCode(languages);
  return byIso.has(detected) ? detected : "TZ";
};

// Countries whose name, code or calling code matches the search ("uni", "gb", "+44", "44").
export const searchPhoneCountries = (query = "") => {
  const token = String(query || "").trim().toLowerCase().replace(/^\+/, "");
  if (!token) return PHONE_COUNTRIES;
  return PHONE_COUNTRIES.filter(
    (country) => country.name.toLowerCase().includes(token) || country.iso.toLowerCase() === token || country.dial.startsWith(token)
  );
};

// Validates the number typed after the country code. A number typed with its own "+code" is accepted as it is
// (travellers often use a phone from another country). Returns the E.164 number checkout sends.
export const validatePhone = (national = "", iso = "") => {
  const value = String(national || "").trim();
  const country = phoneCountry(iso);
  if (!value.replace(/\D/g, "")) {
    return { valid: false, e164: "", country: country?.iso || "", message: "Enter your phone number" };
  }
  const parsed = value.startsWith("+") || value.startsWith("00")
    ? parsePhoneNumberFromString(value.replace(/^00/, "+"))
    : parsePhoneNumberFromString(value, country?.iso);
  if (!parsed || !parsed.isValid()) {
    return {
      valid: false,
      e164: "",
      country: country?.iso || "",
      message: country ? `Enter a valid ${country.name} number, or add your country code` : "Enter a valid phone number"
    };
  }
  // Codes shared by several countries (+44, +1) keep the guest's choice.
  const sameCode = country && String(parsed.countryCallingCode) === country.dial;
  return { valid: true, e164: parsed.number, country: sameCode ? country.iso : parsed.country || country?.iso || "", message: "" };
};

// "+44 7700 900123" for summaries.
export const formatPhone = (e164 = "") => {
  const parsed = parsePhoneNumberFromString(String(e164 || ""));
  return parsed ? parsed.formatInternational() : String(e164 || "");
};
