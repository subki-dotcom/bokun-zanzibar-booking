import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LuCheck, LuMessageCircle, LuSearch } from "react-icons/lu";
import { HOTEL_NOT_LISTED, filterHotels } from "./checkoutData";

const MAX_ROWS = 60;

// Pickup hotel: search the option's pickup places, choose one, or say the hotel isn't listed (sent on WhatsApp).
const PickupHotelSearch = ({ checkout, error = "", onBlur }) => {
  const { form, setField, hotels, pickupArea, pickupLabel, needsNearestHotel } = checkout;
  const nearestMode = form.hotelNotListed && needsNearestHotel;
  const listId = useId();
  const listRef = useRef(null);
  const [active, setActive] = useState(-1);
  const query = form.hotelQuery || "";
  const matches = useMemo(() => filterHotels(hotels || [], form.hotelName && query === form.hotelName ? "" : query), [hotels, query, form.hotelName]);
  const shown = matches.slice(0, MAX_ROWS);
  const rows = [...shown.map((place) => ({ id: String(place.id || pickupLabel(place)), place })), { id: "not-listed", place: null }];

  // The chosen hotel is in view when the step reopens.
  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector(".is-selected");
    if (list && selected) list.scrollTop = selected.offsetTop - list.offsetTop - 8;
    // Only when the list first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotels === null]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (row) => {
    if (!row.place) {
      // A second tap takes it back.
      const next = !form.hotelNotListed;
      setField("hotelNotListed", next);
      if (next) {
        setField("hotelTyped", form.hotelName ? "" : query.trim());
        setField("hotelName", "");
        setField("pickupPlaceId", "");
        setField("hotelQuery", "");
      }
      return;
    }
    const label = pickupLabel(row.place);
    // With no "not listed" place in the supplier system, the hotel chosen now is the nearest one for the pickup.
    if (!needsNearestHotel) setField("hotelNotListed", false);
    setField("hotelName", label);
    setField("hotelQuery", label);
    // Places from the general Zanzibar list are not this product's own, so only the name is sent.
    setField("pickupPlaceId", row.place.productScoped === false ? "" : String(row.place.id || ""));
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && rows[active]) {
      event.preventDefault();
      choose(rows[active]);
    }
  };

  const isSelected = (row) => (row.place ? form.hotelName === pickupLabel(row.place) : form.hotelNotListed);
  const helper = nearestMode
    ? "Now choose the hotel nearest to you so we can reserve your pickup, and send us your hotel's name on WhatsApp – we'll confirm the exact pickup."
    : pickupArea
    ? "Only hotels in your option's pickup area are shown. Exact pickup time is confirmed the day before."
    : "Exact pickup time is confirmed the day before.";

  return (
    <div className={`ck-field is-wide ck-hotels ${error ? "has-error" : ""}`}>
      <label htmlFor="ck-hotel">Pickup hotel</label>
      <div className="ck-search">
        <LuSearch aria-hidden="true" />
        <input
          id="ck-hotel"
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "ck-hotel-error" : "ck-hotel-help"}
          autoComplete="off"
          value={query}
          placeholder={nearestMode ? "Search the hotel nearest to you" : `Search your hotel in ${pickupArea || "Zanzibar"}`}
          onChange={(event) => {
            setField("hotelQuery", event.target.value);
            if (form.hotelName) {
              setField("hotelName", "");
              setField("pickupPlaceId", "");
            }
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </div>
      <ul id={listId} ref={listRef} role="listbox" aria-label="Pickup hotels" className="ck-hotel-list">
        {hotels === null ? <li className="ck-hotel-status" aria-live="polite">Loading hotels…</li> : null}
        {hotels && !shown.length ? <li className="ck-hotel-status">No hotel matches “{query}”.</li> : null}
        {(hotels === null ? rows.slice(-1) : rows).map((row) => {
          const index = rows.indexOf(row);
          const selected = isSelected(row);
          return (
            <li
              key={row.id}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={selected}
              className={[row.place ? "" : "is-not-listed", selected ? "is-selected" : "", index === active ? "is-active" : ""].filter(Boolean).join(" ")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(row)}
            >
              {row.place ? (
                <span>
                  <strong>{row.place.title}</strong>
                  {row.place.address ? <small>{row.place.address}</small> : null}
                </span>
              ) : (
                <span className="ck-hotel-missing">
                  <LuMessageCircle aria-hidden="true" /> {HOTEL_NOT_LISTED}
                </span>
              )}
              {selected && nearestMode && row.place ? <small className="ck-hotel-tag">Nearest</small> : null}
              {selected ? <LuCheck aria-hidden="true" className="ck-hotel-check" /> : null}
            </li>
          );
        })}
      </ul>
      {matches.length > MAX_ROWS ? <small className="ck-help">Showing {MAX_ROWS} of {matches.length} hotels – type to narrow the list.</small> : null}
      {error ? (
        <small id="ck-hotel-error" className="ck-error">{error}</small>
      ) : (
        <small id="ck-hotel-help" className="ck-help">{helper}</small>
      )}
    </div>
  );
};

export default PickupHotelSearch;
