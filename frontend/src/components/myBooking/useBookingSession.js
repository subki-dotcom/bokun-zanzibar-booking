// Who is signed in to "My booking" on this browser, shared by the booking pages and the site header.
import { useEffect, useSyncExternalStore } from "react";
import { fetchBookingSession, setCsrfToken, signOutOfBooking } from "../../api/myBookingApi";

const SIGNED_OUT = { status: "signed_out", reference: "", email: "" };
let state = { status: "unknown", reference: "", email: "" };
let pending = null;
const listeners = new Set();

const emit = (next) => {
  state = next;
  listeners.forEach((listener) => listener());
};

export const refreshBookingSession = () => {
  if (pending) return pending;
  if (state.status === "unknown") emit({ ...state, status: "loading" });
  pending = fetchBookingSession()
    .then((session) => {
      setCsrfToken(session.signedIn ? session.csrfToken : "");
      emit(session.signedIn ? { status: "signed_in", reference: session.reference, email: session.email } : SIGNED_OUT);
      return state;
    })
    .catch(() => {
      emit(SIGNED_OUT);
      return state;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
};

export const signOutBookingSession = async () => {
  try {
    await signOutOfBooking();
  } finally {
    setCsrfToken("");
    emit(SIGNED_OUT);
  }
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// { status: unknown | loading | signed_in | signed_out, reference, email (masked) }
const useBookingSession = ({ load = true } = {}) => {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (load && snapshot.status === "unknown") refreshBookingSession();
  }, [load, snapshot.status]);
  return snapshot;
};

export default useBookingSession;
