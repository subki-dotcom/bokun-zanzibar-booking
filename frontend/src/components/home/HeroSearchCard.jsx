import { useState } from "react";
import { Button, Form } from "react-bootstrap";
import { BsCalendar3, BsGeoAlt, BsPeople } from "react-icons/bs";
import { buildHeroSearchPayload } from "./home.helpers";

const HeroSearchCard = ({ onSearch }) => {
  const [category, setCategory] = useState("all");
  const [date, setDate] = useState("");
  const [travelers, setTravelers] = useState(2);

  const handleSubmit = (event) => {
    event.preventDefault();
    onSearch?.(buildHeroSearchPayload({ category, date, travelers }));
  };

  return (
    <form className="z-home-search-card" onSubmit={handleSubmit}>
      <div className="z-home-search-title">Quick tour search</div>
      <div className="z-home-search-grid">
        <label className="z-home-search-field">
          <span>
            <BsGeoAlt />
          </span>
          <Form.Select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All experiences</option>
            <option value="Sea Tours">Sea Tours</option>
            <option value="Safari Trips">Safari Trips</option>
            <option value="Cultural Tours">Cultural Tours</option>
            <option value="Private Tours">Private Tours</option>
            <option value="Transfers">Transfers</option>
          </Form.Select>
        </label>

        <label className="z-home-search-field">
          <span>
            <BsCalendar3 />
          </span>
          <Form.Control
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label="Travel date"
          />
        </label>

        <label className="z-home-search-field">
          <span>
            <BsPeople />
          </span>
          <Form.Select
            value={travelers}
            onChange={(event) => setTravelers(Number(event.target.value || 2))}
            aria-label="Travelers"
          >
            {[1, 2, 3, 4, 5, 6, 8, 10].map((count) => (
              <option key={count} value={count}>
                {count} traveler{count > 1 ? "s" : ""}
              </option>
            ))}
          </Form.Select>
        </label>
      </div>

      <Button type="submit" className="premium-btn text-white w-100 mt-2">
        Find tours
      </Button>
    </form>
  );
};

export default HeroSearchCard;
