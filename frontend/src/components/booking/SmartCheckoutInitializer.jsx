import { useEffect, useRef } from "react";

const SmartCheckoutInitializer = ({ onInitialize, onError }) => {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) {
      return;
    }

    ranRef.current = true;

    const run = async () => {
      try {
        await onInitialize?.();
      } catch (error) {
        onError?.(error);
      }
    };

    run();
  }, [onInitialize, onError]);

  return null;
};

export default SmartCheckoutInitializer;

