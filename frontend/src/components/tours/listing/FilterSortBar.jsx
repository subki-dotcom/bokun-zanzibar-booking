import { Form } from "react-bootstrap";
import { BsCalendar3, BsPeople, BsSearch } from "react-icons/bs";

const durationOptions = [
  { value: "all", label: "All durations" },
  { value: "short", label: "Up to 4 hours" },
  { value: "half_day", label: "Half day" },
  { value: "full_day", label: "Full day" },
  { value: "multi_day", label: "Multi-day" },
  { value: "flexible", label: "Flexible" }
];

const sortOptions = [
  { value: "recommended", label: "Recommended" },
  { value: "price_low_high", label: "Price: low to high" },
  { value: "price_high_low", label: "Price: high to low" },
  { value: "duration_short_long", label: "Duration: short to long" },
  { value: "duration_long_short", label: "Duration: long to short" },
  { value: "title_a_z", label: "Title: A to Z" }
];

const FilterSortBar = ({
  query = "",
  category = "all",
  duration = "all",
  travelDate = "",
  travelers = 2,
  sort = "recommended",
  categoryOptions = [],
  resultCount = 0,
  onFilterChange
}) => (
  <section className="listing-filter-bar">
    <div className="listing-filter-controls">
      <div className="listing-search-wrap">
        <BsSearch className="listing-search-icon" />
        <Form.Control
          value={query}
          onChange={(event) => onFilterChange("q", event.target.value)}
          placeholder="Search tours or keywords"
          aria-label="Search tours"
        />
      </div>

      <Form.Select
        value={category}
        onChange={(event) => onFilterChange("category", event.target.value)}
        aria-label="Filter by category"
      >
        <option value="all">All categories</option>
        {categoryOptions.map((item) => (
          <option value={item} key={item}>
            {item}
          </option>
        ))}
      </Form.Select>

      <div className="listing-search-wrap listing-date-filter">
        <BsCalendar3 className="listing-search-icon" />
        <Form.Control
          type="date"
          value={travelDate}
          onChange={(event) => onFilterChange("travelDate", event.target.value)}
          aria-label="Check availability for travel date"
        />
      </div>

      <div className="listing-search-wrap listing-traveler-filter">
        <BsPeople className="listing-search-icon" />
        <Form.Select
          value={travelers}
          onChange={(event) => onFilterChange("travelers", event.target.value)}
          aria-label="Travelers"
        >
          {[1, 2, 3, 4, 5, 6, 8, 10].map((count) => (
            <option key={count} value={count}>{count} traveler{count === 1 ? "" : "s"}</option>
          ))}
        </Form.Select>
      </div>

      <Form.Select
        value={duration}
        onChange={(event) => onFilterChange("duration", event.target.value)}
        aria-label="Filter by duration"
      >
        {durationOptions.map((item) => (
          <option value={item.value} key={item.value}>
            {item.label}
          </option>
        ))}
      </Form.Select>

      <Form.Select
        value={sort}
        onChange={(event) => onFilterChange("sort", event.target.value)}
        aria-label="Sort tours"
      >
        {sortOptions.map((item) => (
          <option value={item.value} key={item.value}>
            {item.label}
          </option>
        ))}
      </Form.Select>
    </div>

    <div className="listing-filter-result-count">
      <strong>{resultCount}</strong> results on this page
    </div>
  </section>
);

export default FilterSortBar;
