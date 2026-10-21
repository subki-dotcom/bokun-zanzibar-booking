import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "react-bootstrap";
import {
  BsArrowClockwise,
  BsCalendar3,
  BsCalendarCheck,
  BsCheck2Circle,
  BsChevronLeft,
  BsChevronRight,
  BsClock,
  BsDownload,
  BsExclamationTriangle,
  BsFunnel,
  BsPersonDash,
  BsSearch,
  BsThreeDotsVertical
} from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import { fetchTourBookingProducts, fetchTourBookings } from "../../../api/tourOperationsApi";
import {
  BOOKING_STATUS_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  SUPPLIER_STATUS_OPTIONS,
  bokunSyncSummary,
  bookingAttention,
  originLabel,
  supplierLabel
} from "../../../config/tourOperations";
import { tourAdminErrorMessage } from "../../../components/admin/tourAdmin/TourAdminUi";
import {
  PAGE_SIZES,
  addDays,
  bookingStatusView,
  bookingsCsv,
  customerName,
  datePresets,
  fetchAllPages,
  formatTravelDate,
  initials,
  pageWindow,
  paxSummary,
  paxTotal,
  paymentStatusView,
  presetFor,
  zanzibarToday
} from "../../../components/admin/tourAdmin/tourBookingsView";

// Tour Bookings: website and Agent Portal tour bookings (ZNZ- references, enforced by the server). Every figure and
// row comes from the Tour Operations API; filters and the page live in the address bar, so a link or a refresh
// keeps them. Assignment is not tracked in Tour Admin yet, so every booking shows "Not assigned".
const FILTER_KEYS = ["search", "origin", "bookingStatus", "paymentStatus", "supplierStatus", "travelDateFrom", "travelDateTo", "productTitle", "attention"];
const emptyFilters = () => Object.fromEntries(FILTER_KEYS.map((key) => [key, ""]));
const readFilters = (searchParams) => Object.fromEntries(FILTER_KEYS.map((key) => [key, searchParams.get(key) || ""]));
const numberFormatter = new Intl.NumberFormat("en-US");

const StatusPill = ({ view }) => <span className={`tbk-pill is-${view.tone}`}>{view.label}</span>;

const KpiCard = ({ icon: Icon, tone, label, value, detail, to }) => (
  <article className={`tbk-kpi is-${tone}`}>
    <span className="tbk-kpi-icon"><Icon aria-hidden="true" /></span>
    <div>
      <h2>{label}</h2>
      <strong aria-live="polite">{value === undefined ? "…" : value === null ? "Unavailable" : to ? <Link to={to}>{numberFormatter.format(value)}</Link> : numberFormatter.format(value)}</strong>
      <p>{detail}</p>
    </div>
  </article>
);

const bookingLink = (booking) => `/admin/tour-admin/bookings/${encodeURIComponent(booking.bookingReference)}`;

const RowActions = ({ booking }) => {
  const copy = () => navigator.clipboard?.writeText(booking.bookingReference).catch(() => {});
  return (
    <div className="tbk-actions">
      <Link className="tbk-view" to={bookingLink(booking)} aria-label={`View booking ${booking.bookingReference}`}>View</Link>
      <Dropdown align="end">
        <Dropdown.Toggle as="button" type="button" className="tbk-more" aria-label={`More actions for ${booking.bookingReference}`}>
          <BsThreeDotsVertical aria-hidden="true" />
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.Item as={Link} to={bookingLink(booking)}>Open booking details</Dropdown.Item>
          <Dropdown.Item as="button" type="button" onClick={copy}>Copy booking reference</Dropdown.Item>
          {booking.customer?.email ? <Dropdown.Item href={`mailto:${booking.customer.email}?subject=${encodeURIComponent(`Your booking ${booking.bookingReference}`)}`}>Email customer</Dropdown.Item> : null}
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
};

// What the operator needs beside the booking status: the supplier's answer and, when there is one, what to do.
const StatusDetail = ({ booking }) => {
  const attention = bookingAttention(booking);
  return (
    <>
      <StatusPill view={bookingStatusView(booking.status?.booking)} />
      <small className="tbk-sub">{supplierLabel(booking.status?.supplier)}</small>
      {["awaiting_supplier", "supplier_sync_in_progress", "supplier_failed", "review"].includes(attention.key) ? <small className={`tbk-sub tbk-attention is-${attention.tone}`}>{attention.label}</small> : null}
    </>
  );
};

const PaymentDetail = ({ booking }) => (
  <>
    <StatusPill view={paymentStatusView(booking.status?.payment)} />
    <small className="tbk-sub">{bokunSyncSummary(booking.supplierSync).label}</small>
  </>
);

const NotAssigned = () => <span className="tbk-unassigned"><BsPersonDash aria-hidden="true" /> Not assigned</span>;

const TourAdminBookingsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const applied = readFilters(searchParams);
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = PAGE_SIZES.includes(Number(searchParams.get("limit"))) ? Number(searchParams.get("limit")) : PAGE_SIZES[0];
  const [draft, setDraft] = useState(applied);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(applied.origin || applied.supplierStatus || applied.attention));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [kpis, setKpis] = useState({});
  const [products, setProducts] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const latest = useRef(0);
  const queryKey = searchParams.toString();
  const today = zanzibarToday();
  const presets = useMemo(() => datePresets(today), [today]);

  // The list: only the newest response is shown, so quick filter changes cannot display stale rows.
  useEffect(() => {
    setDraft(readFilters(searchParams));
    const call = ++latest.current;
    setLoading(true);
    setError("");
    fetchTourBookings({ ...readFilters(searchParams), page, limit })
      .then((result) => { if (call === latest.current) setData(result); })
      .catch((err) => { if (call === latest.current) { setData(null); setError(tourAdminErrorMessage(err, "Tour bookings could not be loaded.")); } })
      .finally(() => { if (call === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, reloadKey]);

  // The summary cards: server totals for the selected travel dates; a figure that fails shows "Unavailable".
  const rangeFrom = applied.travelDateFrom;
  const rangeTo = applied.travelDateTo;
  useEffect(() => {
    const yesterday = addDays(today, -1);
    const completedTo = rangeTo && rangeTo < yesterday ? rangeTo : yesterday;
    const range = { travelDateFrom: rangeFrom, travelDateTo: rangeTo };
    const jobs = {
      total: range,
      upcoming: { bookingStatus: "confirmed", travelDateFrom: today, travelDateTo: addDays(today, 30) },
      attention: { attention: "true" },
      completed: rangeFrom && rangeFrom > completedTo ? null : { bookingStatus: "confirmed", travelDateFrom: rangeFrom, travelDateTo: completedTo }
    };
    let active = true;
    setKpis({});
    Promise.allSettled(Object.values(jobs).map((params) => (params ? fetchTourBookings({ ...params, limit: 1 }) : Promise.resolve({ total: 0 })))).then((results) => {
      if (!active) return;
      setKpis(Object.fromEntries(Object.keys(jobs).map((key, index) => {
        const result = results[index];
        return [key, result.status === "fulfilled" && Number.isFinite(Number(result.value?.total)) ? Number(result.value.total) : null];
      })));
    });
    return () => { active = false; };
  }, [rangeFrom, rangeTo, today, reloadKey]);

  useEffect(() => {
    fetchTourBookingProducts().then((list) => setProducts(Array.isArray(list) ? list : [])).catch(() => setProducts([]));
  }, []);

  const writeParams = (filters, { nextPage = 1, nextLimit = limit } = {}) => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) if (filters[key]) next.set(key, filters[key]);
    if (nextPage > 1) next.set("page", String(nextPage));
    if (nextLimit !== PAGE_SIZES[0]) next.set("limit", String(nextLimit));
    setSearchParams(next);
  };

  const applyFilters = (event) => {
    event.preventDefault();
    const search = draft.search.trim();
    if (search && search.length < 3) {
      setFormError("Enter at least 3 characters: a booking reference, customer name, email or tour.");
      return;
    }
    if (draft.travelDateFrom && draft.travelDateTo && draft.travelDateFrom > draft.travelDateTo) {
      setFormError("The travel date range ends before it starts.");
      return;
    }
    setFormError("");
    writeParams({ ...draft, search });
  };

  const resetFilters = () => {
    setDraft(emptyFilters());
    setFormError("");
    setSearchParams(new URLSearchParams());
  };

  const choosePreset = (id) => {
    if (id === "custom") {
      setShowAdvanced(true);
      document.getElementById("tour-bookings-from")?.focus();
      return;
    }
    const preset = presets.find((item) => item.id === id);
    writeParams({ ...applied, travelDateFrom: preset.from, travelDateTo: preset.to });
  };

  const goToPage = (nextPage) => writeParams(applied, { nextPage });
  const changeLimit = (nextLimit) => writeParams(applied, { nextPage: 1, nextLimit });
  const reload = () => setReloadKey((value) => value + 1);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    setExportNote("");
    try {
      const { rows, truncated } = await fetchAllPages(fetchTourBookings, applied);
      const blob = new Blob([`﻿${bookingsCsv(rows)}`], { type: "text/csv;charset=utf-8" });
      if (typeof URL.createObjectURL === "function") {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `tour-bookings-${today}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }
      setExportNote(`Exported ${numberFormatter.format(rows.length)} booking${rows.length === 1 ? "" : "s"}${truncated ? " (the first 5,000; narrow the filters for the rest)" : ""}.`);
    } catch (err) {
      setExportNote(tourAdminErrorMessage(err, "The export could not be created."));
    } finally {
      setExporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, today]);

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const first = total ? (page - 1) * limit + 1 : 0;
  const last = Math.min(page * limit, total);
  const preset = presetFor(rangeFrom, rangeTo, today);
  const rangeLabel = preset === "custom" ? `${rangeFrom ? formatTravelDate(rangeFrom) : "Any date"} – ${rangeTo ? formatTravelDate(rangeTo) : "any date"}` : presets.find((item) => item.id === preset).label;

  const select = (id, label, key, options, format, { disabled = false } = {}) => (
    <div className="tbk-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="tbk-control" value={draft[key] ?? ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} disabled={disabled}>
        <option value="">All statuses</option>
        {options.map((option) => <option key={option} value={option}>{format(option)}</option>)}
      </select>
    </div>
  );

  return (
    <div className="tour-admin-bookings tbk-page">
      <header className="tbk-head">
        <h1>Tour Bookings</h1>
        <div className="tbk-head-actions">
          <label className="tbk-range" htmlFor="tour-bookings-range">
            <BsCalendar3 aria-hidden="true" />
            <span className="visually-hidden">Travel dates</span>
            <select id="tour-bookings-range" value={preset} onChange={(event) => choosePreset(event.target.value)}>
              {presets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              <option value="custom">{preset === "custom" ? rangeLabel : "Custom range…"}</option>
            </select>
          </label>
          <button type="button" className="tbk-btn" onClick={reload} disabled={loading}><BsArrowClockwise aria-hidden="true" /> Refresh</button>
          <button type="button" className="tbk-btn" onClick={exportCsv} disabled={exporting || loading || !total}><BsDownload aria-hidden="true" /> {exporting ? "Exporting…" : "Export"}</button>
        </div>
      </header>
      {exportNote ? <p className="tbk-note" role="status">{exportNote}</p> : null}

      <section className="tbk-kpis" aria-label="Summary">
        <KpiCard icon={BsCalendarCheck} tone="blue" label="Total Tours" value={kpis.total} detail={preset === "all" ? "All direct tour bookings" : `Travel ${rangeLabel.toLowerCase()}`} />
        <KpiCard icon={BsClock} tone="green" label="Upcoming Tours" value={kpis.upcoming} detail="Confirmed, next 30 days" />
        <KpiCard icon={BsExclamationTriangle} tone="orange" label="Needs Attention" value={kpis.attention} detail="Pending, change requested or supplier issues" />
        <KpiCard icon={BsCheck2Circle} tone="purple" label="Completed Tours" value={kpis.completed} detail={preset === "all" ? "Confirmed, travel date passed" : "Confirmed, travel date passed, in selected period"} />
      </section>

      <form className="tbk-card tbk-filters tour-admin-filters" onSubmit={applyFilters} aria-label="Filter tour bookings">
        <div className="tbk-filters-head">
          <h2><BsSearch aria-hidden="true" /> Search &amp; Filters</h2>
          <button type="button" className="tbk-btn" aria-expanded={showAdvanced} aria-controls="tour-bookings-advanced" onClick={() => setShowAdvanced((value) => !value)}>
            <BsFunnel aria-hidden="true" /> Advanced Filters
          </button>
        </div>
        <div className="tbk-search">
          <BsSearch aria-hidden="true" />
          <label htmlFor="tour-bookings-search" className="visually-hidden">Search booking reference, customer or tour</label>
          <input id="tour-bookings-search" type="search" maxLength={254} placeholder="Search booking reference, customer name, email or tour…" value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} />
        </div>
        <div className="tbk-filter-row">
          <div className="tbk-field tbk-field-dates">
            <span className="tbk-label" id="tour-bookings-dates-label">Travel Date</span>
            <div className="tbk-dates" role="group" aria-labelledby="tour-bookings-dates-label">
              <input id="tour-bookings-from" className="tbk-control" type="date" aria-label="Travel from" value={draft.travelDateFrom} onChange={(event) => setDraft({ ...draft, travelDateFrom: event.target.value })} />
              <span aria-hidden="true">–</span>
              <input id="tour-bookings-to" className="tbk-control" type="date" aria-label="Travel to" value={draft.travelDateTo} onChange={(event) => setDraft({ ...draft, travelDateTo: event.target.value })} />
            </div>
          </div>
          {select("tour-bookings-status", "Booking Status", "bookingStatus", BOOKING_STATUS_OPTIONS, (value) => bookingStatusView(value).label)}
          {select("tour-bookings-payment", "Payment Status", "paymentStatus", PAYMENT_STATUS_OPTIONS, (value) => paymentStatusView(value).label)}
          <div className="tbk-field">
            <label htmlFor="tour-bookings-product">Tour Product</label>
            <select id="tour-bookings-product" className="tbk-control" value={draft.productTitle} onChange={(event) => setDraft({ ...draft, productTitle: event.target.value })}>
              <option value="">All tours</option>
              {products.map((title) => <option key={title} value={title}>{title}</option>)}
            </select>
          </div>
          <div className="tbk-filter-actions">
            <button type="button" className="tbk-btn" onClick={resetFilters}>Reset</button>
            <button type="submit" className="tbk-btn tbk-btn-primary" disabled={loading}><BsSearch aria-hidden="true" /> Apply</button>
          </div>
        </div>
        {showAdvanced ? (
          <div className="tbk-filter-row tbk-advanced" id="tour-bookings-advanced">
            {select("tour-bookings-origin", "Origin", "origin", ["WEBSITE", "AGENT_PORTAL"], (value) => (value === "WEBSITE" ? "Website" : "Agent Portal"))}
            {select("tour-bookings-supplier", "Supplier", "supplierStatus", SUPPLIER_STATUS_OPTIONS, supplierLabel)}
            <div className="tbk-field">
              <label htmlFor="tour-bookings-attention">Attention</label>
              <select id="tour-bookings-attention" className="tbk-control" value={draft.attention} onChange={(event) => setDraft({ ...draft, attention: event.target.value })}>
                <option value="">All bookings</option>
                <option value="true">Needs attention</option>
              </select>
            </div>
            <div className="tbk-field">
              <label htmlFor="tour-bookings-assignment">Assignment Status</label>
              <select id="tour-bookings-assignment" className="tbk-control" disabled aria-describedby="tour-bookings-assignment-help">
                <option>All statuses</option>
              </select>
              <small id="tour-bookings-assignment-help" className="tbk-sub">Assignment is not tracked in Tour Admin yet.</small>
            </div>
          </div>
        ) : null}
        {formError ? <p className="tbk-form-error" role="alert">{formError}</p> : null}
      </form>

      <section className="tbk-card tbk-results" aria-label="Tour bookings">
        {error ? <div className="alert alert-danger mb-0" role="alert">{error}</div> : null}
        {loading ? <div className="tbk-state" role="status">Loading tour bookings…</div> : null}
        {!loading && !error && !items.length ? <div className="tbk-state">No tour bookings match these filters.</div> : null}
        {!loading && items.length ? (
          <>
            <div className="tbk-results-head">
              <span>Showing {numberFormatter.format(first)}–{numberFormatter.format(last)} of {numberFormatter.format(total)} bookings</span>
              <label className="tbk-show" htmlFor="tour-bookings-limit">
                Show
                <select id="tour-bookings-limit" className="tbk-control" value={limit} onChange={(event) => changeLimit(Number(event.target.value))}>
                  {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
            </div>

            <div className="tbk-table-wrap">
              <table className="tbk-table tour-admin-bookings-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Tour / Product</th>
                    <th scope="col">Travel Date &amp; Time</th>
                    <th scope="col">Pax</th>
                    <th scope="col">Booking Status</th>
                    <th scope="col">Payment Status</th>
                    <th scope="col">Assignment</th>
                    <th scope="col" className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((booking, index) => (
                    <tr key={booking.id}>
                      <td className="tbk-num">{first + index}</td>
                      <td>
                        <Link className="tbk-ref" to={bookingLink(booking)}>{booking.bookingReference}</Link>
                        <small className="tbk-sub">{originLabel(booking.origin)}{booking.originBasis === "historical" ? " · from booking history" : ""}</small>
                      </td>
                      <td>
                        <div className="tbk-customer">
                          <span className="tbk-avatar" aria-hidden="true">{initials(booking.customer)}</span>
                          <div>
                            <strong>{customerName(booking.customer)}</strong>
                            <small className="tbk-sub">{paxSummary(booking.tour?.pax)}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong className="tbk-tour">{booking.tour?.productTitle || "-"}</strong>
                        {booking.tour?.optionTitle ? <small className="tbk-sub">{booking.tour.optionTitle}</small> : null}
                      </td>
                      <td>
                        <div className="tbk-date">
                          <BsCalendar3 aria-hidden="true" />
                          <div>
                            <span>{formatTravelDate(booking.tour?.travelDate)}</span>
                            <small className="tbk-sub">{booking.tour?.startTime || "Time not set"}</small>
                          </div>
                        </div>
                      </td>
                      <td className="tbk-num">{paxTotal(booking.tour?.pax) || "-"}</td>
                      <td><StatusDetail booking={booking} /></td>
                      <td><PaymentDetail booking={booking} /></td>
                      <td><NotAssigned /></td>
                      <td className="text-end"><RowActions booking={booking} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="tbk-cards" aria-label="Tour bookings">
              {items.map((booking, index) => (
                <li key={booking.id} className="tbk-card-item">
                  <div className="tbk-card-top">
                    <span className="tbk-num">{first + index}</span>
                    <Link className="tbk-ref" to={bookingLink(booking)}>{booking.bookingReference}</Link>
                    <RowActions booking={booking} />
                  </div>
                  <div className="tbk-customer">
                    <span className="tbk-avatar" aria-hidden="true">{initials(booking.customer)}</span>
                    <div>
                      <strong>{customerName(booking.customer)}</strong>
                      <small className="tbk-sub">{paxSummary(booking.tour?.pax)}</small>
                    </div>
                  </div>
                  <p className="tbk-card-tour"><strong>{booking.tour?.productTitle || "-"}</strong>{booking.tour?.optionTitle ? ` · ${booking.tour.optionTitle}` : ""}</p>
                  <p className="tbk-card-date"><BsCalendar3 aria-hidden="true" /> {formatTravelDate(booking.tour?.travelDate)} {booking.tour?.startTime || ""} · {paxTotal(booking.tour?.pax)} pax</p>
                  <div className="tbk-card-status">
                    <div><StatusDetail booking={booking} /></div>
                    <div><PaymentDetail booking={booking} /></div>
                    <div><NotAssigned /></div>
                  </div>
                </li>
              ))}
            </ul>

            <nav className="tbk-pager" aria-label="Tour bookings pages">
              <span>{numberFormatter.format(total)} bookings · page {page} of {totalPages}</span>
              <div className="tbk-pages">
                <button type="button" className="tbk-pagebtn" onClick={() => goToPage(page - 1)} disabled={page <= 1 || loading}><BsChevronLeft aria-hidden="true" /><span className="visually-hidden">Previous</span></button>
                {pageWindow(page, totalPages).map((number) => (
                  <button key={number} type="button" className={`tbk-pagebtn ${number === page ? "is-current" : ""}`} aria-current={number === page ? "page" : undefined} onClick={() => goToPage(number)} disabled={loading}>{number}</button>
                ))}
                <button type="button" className="tbk-pagebtn" onClick={() => goToPage(page + 1)} disabled={page >= totalPages || loading}><BsChevronRight aria-hidden="true" /><span className="visually-hidden">Next</span></button>
              </div>
            </nav>
          </>
        ) : null}
      </section>
    </div>
  );
};

export default TourAdminBookingsPage;
