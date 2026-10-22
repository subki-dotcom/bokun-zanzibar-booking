import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LuX } from "react-icons/lu";
import { formatCurrency } from "../../../utils/formatters";
import { AvailabilityCalendar, BookButton, OptionList, TravelersStepper, TrustList, bookingSummary } from "./TourBooking";
import { freeCancellationWindow } from "./tourSectionsData";

// Fixed bar at the bottom of the phone screen: From price and "Check availability".
export const MobileBookingBar = ({ booking, onOpen }) => {
  const window = freeCancellationWindow(booking.cancellationSummary);
  return (
    <div className="tp-mbar">
      <div className="tp-mbar-price">
        <small>From</small>
        {booking.startingPrice ? (
          <strong>{formatCurrency(booking.startingPrice.amount, booking.startingPrice.currency)}</strong>
        ) : (
          <span className="tp-skeleton tp-skeleton-bar" aria-label="Loading price" />
        )}
        <small>{booking.startingPrice?.label || "per adult"}{window ? " · Free cancellation" : ""}</small>
      </div>
      <button type="button" className="tp-mbar-btn" onClick={onOpen} aria-haspopup="dialog">Check availability</button>
    </div>
  );
};

// Bottom sheet: travellers, a month calendar, the options, and a footer with the total and Book now.
// Focus stays inside; Esc, the close button, the backdrop or a swipe down on the handle closes it.
export const MobileBookingSheet = ({ booking, onClose }) => {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const dragStart = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll("button:not([disabled]), a[href]")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onDragStart = (event) => { dragStart.current = event.touches[0].clientY; };
  const onDragMove = (event) => {
    if (dragStart.current === null || !panelRef.current) return;
    const delta = Math.max(0, event.touches[0].clientY - dragStart.current);
    panelRef.current.style.transform = `translateY(${delta}px)`;
  };
  const onDragEnd = (event) => {
    if (dragStart.current === null || !panelRef.current) return;
    const delta = event.changedTouches[0].clientY - dragStart.current;
    dragStart.current = null;
    panelRef.current.style.transform = "";
    if (delta > 90) onClose();
  };

  const total = booking.canBook ? formatCurrency(booking.selectedOption.total, booking.selectedOption.currency) : "";

  return createPortal(
    <div className="tp tp-sheet-layer">
      <button type="button" className="tp-sheet-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="tp-sheet" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="tp-sheet-title">
        <div className="tp-sheet-head" onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}>
          <span className="tp-sheet-handle" aria-hidden="true" />
          <h2 id="tp-sheet-title">Select date &amp; travelers</h2>
          <button ref={closeRef} type="button" className="tp-icon-btn" onClick={onClose} aria-label="Close">
            <LuX aria-hidden="true" />
          </button>
        </div>
        <div className="tp-sheet-body">
          <TravelersStepper categories={booking.categories} counts={booking.counts} onChange={booking.setCount} disabled={!booking.ready} />
          <div className="tp-sheet-calendar">
            <AvailabilityCalendar value={booking.travelDate} availability={booking.availability} months={1} onPick={booking.chooseDate} />
          </div>
          <OptionList booking={booking} />
        </div>
        <div className="tp-sheet-foot">
          <div className="tp-sheet-summary">
            <span>{bookingSummary(booking)}</span>
            {total ? <b>{total}</b> : null}
          </div>
          <BookButton booking={booking} withTotal={false} />
          <TrustList cancellationSummary={booking.cancellationSummary} compact />
        </div>
      </div>
    </div>,
    document.body
  );
};
