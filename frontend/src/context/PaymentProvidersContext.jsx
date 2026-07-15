import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchPaymentProviders } from "../api/paymentsApi";
import { PAYMENT_METHODS } from "../utils/paymentMethods";

const PaymentProvidersContext = createContext(null);

const mergeProviders = (providers = []) => {
  const statusById = new Map((providers || []).map((provider) => [provider.id, provider]));

  return PAYMENT_METHODS.map((method) => {
    const status = statusById.get(method.id);
    return {
      ...method,
      enabled: Boolean(status?.enabled),
      mode: status?.mode || "unavailable",
      unavailableReason: status?.unavailableReason || "This payment method is not available right now."
    };
  });
};

export const PaymentProvidersProvider = ({ children }) => {
  const [providers, setProviders] = useState(() => mergeProviders());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshProviders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPaymentProviders();
      setProviders(mergeProviders(data));
      setError("");
    } catch (requestError) {
      setProviders(mergeProviders());
      setError(requestError.message || "Payment methods could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  const value = useMemo(() => ({
    providers,
    loading,
    error,
    refreshProviders,
    availableProviders: providers.filter((provider) => provider.enabled),
    isProviderEnabled: (providerId) => providers.some((provider) => provider.id === providerId && provider.enabled),
    getProvider: (providerId) => providers.find((provider) => provider.id === providerId) || PAYMENT_METHODS[0]
  }), [providers, loading, error, refreshProviders]);

  return <PaymentProvidersContext.Provider value={value}>{children}</PaymentProvidersContext.Provider>;
};

export const usePaymentProviders = () => {
  const context = useContext(PaymentProvidersContext);
  if (!context) {
    throw new Error("usePaymentProviders must be used inside PaymentProvidersProvider");
  }
  return context;
};
