import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Form, Table } from "react-bootstrap";
import { fetchAdminWebsiteProducts, updateAdminWebsiteProductFeatured, updateAdminWebsiteProductVisibility } from "../../api/toursApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { duplicateGroupKey } from "../../utils/productDuplicates";

// Show or hide Bókun products on the public website (listings, "You may also like", sitemap). A hidden product's page
// still opens from its link, so ads and existing bookings keep working.
const AdminWebsiteToursPage = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = async () => {
    try {
      setError("");
      setProducts(await fetchAdminWebsiteProducts());
    } catch (err) {
      setError(err.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const duplicateCounts = useMemo(() => {
    const counts = new Map();
    products.forEach((product) => {
      const key = duplicateGroupKey(product.title);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [products]);

  const isDuplicate = (product) => (duplicateCounts.get(duplicateGroupKey(product.title)) || 0) > 1;
  const needsText = (product) => !product.hasShortDescription;

  const visible = products
    .filter((product) => {
      if (filter === "duplicates") return isDuplicate(product);
      if (filter === "hidden") return product.hiddenFromPublic;
      if (filter === "missing-text") return needsText(product);
      if (filter === "featured") return product.featuredOnHome;
      return true;
    })
    .sort((a, b) => duplicateGroupKey(a.title).localeCompare(duplicateGroupKey(b.title)) || a.title.localeCompare(b.title));

  const toggle = async (product) => {
    const hidden = !product.hiddenFromPublic;
    if (hidden && !window.confirm(`Hide "${product.title}" from the website? Its page stays reachable by link.`)) return;
    setSavingId(product.bokunProductId);
    setError("");
    try {
      const updated = await updateAdminWebsiteProductVisibility(product.bokunProductId, hidden);
      setProducts((current) => current.map((item) => (item.bokunProductId === updated.bokunProductId ? { ...item, ...updated } : item)));
    } catch (err) {
      setError(err.message || "Could not update the product");
    } finally {
      setSavingId("");
    }
  };

  // The home page shows six handpicked tours; with none chosen it picks the most booked ones itself.
  const featuredCount = products.filter((product) => product.featuredOnHome).length;
  const toggleFeatured = async (product) => {
    const featured = !product.featuredOnHome;
    if (featured && featuredCount >= 6) {
      setError("The home page shows six handpicked tours. Remove one before adding another.");
      return;
    }
    setSavingId(product.bokunProductId);
    setError("");
    try {
      const updated = await updateAdminWebsiteProductFeatured(product.bokunProductId, featured);
      setProducts((current) => current.map((item) => (item.bokunProductId === updated.bokunProductId ? { ...item, ...updated } : item)));
    } catch (err) {
      setError(err.message || "Could not update the product");
    } finally {
      setSavingId("");
    }
  };

  // One tour is shown in the header's "Tours & activities" menu; choosing another replaces it.
  const toggleMenuTour = async (product) => {
    const featured = !product.featuredInMenu;
    setSavingId(product.bokunProductId);
    setError("");
    try {
      const updated = await updateAdminWebsiteProductFeatured(product.bokunProductId, featured, "menu");
      setProducts((current) =>
        current.map((item) =>
          item.bokunProductId === updated.bokunProductId ? { ...item, ...updated } : featured ? { ...item, featuredInMenu: false } : item
        )
      );
    } catch (err) {
      setError(err.message || "Could not update the product");
    } finally {
      setSavingId("");
    }
  };

  if (loading) return <Loader message="Loading website tours..." />;

  return (
    <div className="admin-website-tours">
      <div className="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
        <div>
          <h2 className="mb-1">Website Tours</h2>
          <p className="text-muted mb-0">
            Hide duplicates or products you do not sell online. Hidden products leave listings and the sitemap; their page still opens from a link.
            Choose up to six tours for "Handpicked Zanzibar experiences" on the home page ({featuredCount}/6 chosen; with none, the most booked tours are shown).
            "Menu" picks the one tour shown in the header's Tours & activities menu (with none, the most booked tour is shown).
          </p>
        </div>
        <Form.Select style={{ maxWidth: 240 }} value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter products">
          <option value="all">All products ({products.length})</option>
          <option value="duplicates">Possible duplicates ({products.filter(isDuplicate).length})</option>
          <option value="missing-text">No short description ({products.filter(needsText).length})</option>
          <option value="hidden">Hidden ({products.filter((product) => product.hiddenFromPublic).length})</option>
          <option value="featured">Featured on home ({featuredCount}/6)</option>
        </Form.Select>
      </div>
      <ErrorAlert error={error} />
      <Card className="surface-card">
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th>Product</th>
                <th>Bókun ID</th>
                <th className="text-end">From</th>
                <th>Notes</th>
                <th>Website</th>
                <th>Home page</th>
                <th>Menu</th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? visible.map((product) => (
                <tr key={product.bokunProductId}>
                  <td>
                    <a href={`/tours/${product.slug}`} target="_blank" rel="noopener noreferrer">{product.title}</a>
                  </td>
                  <td>{product.bokunProductId}</td>
                  <td className="text-end">{Number(product.fromPrice) > 0 ? `${product.currency || "USD"} ${product.fromPrice}` : "-"}</td>
                  <td className="d-flex flex-wrap gap-1">
                    {isDuplicate(product) ? <Badge bg="warning" text="dark">Possible duplicate</Badge> : null}
                    {needsText(product) ? <Badge bg="info" text="dark">No short description</Badge> : null}
                    {!product.hasDescription ? <Badge bg="secondary">No description</Badge> : null}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant={product.hiddenFromPublic ? "outline-success" : "outline-secondary"}
                      disabled={savingId === product.bokunProductId}
                      onClick={() => toggle(product)}
                    >
                      {product.hiddenFromPublic ? "Show on website" : "Hide from website"}
                    </Button>
                    {product.hiddenFromPublic ? <small className="d-block text-muted mt-1">Hidden</small> : null}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant={product.featuredOnHome ? "success" : "outline-secondary"}
                      disabled={savingId === product.bokunProductId || product.hiddenFromPublic}
                      onClick={() => toggleFeatured(product)}
                      aria-pressed={Boolean(product.featuredOnHome)}
                    >
                      {product.featuredOnHome ? "Featured ✓" : "Feature"}
                    </Button>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant={product.featuredInMenu ? "success" : "outline-secondary"}
                      disabled={savingId === product.bokunProductId || product.hiddenFromPublic}
                      onClick={() => toggleMenuTour(product)}
                      aria-pressed={Boolean(product.featuredInMenu)}
                    >
                      {product.featuredInMenu ? "In menu ✓" : "Show in menu"}
                    </Button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="text-center text-muted py-4">No products match this filter.</td></tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
};

export default AdminWebsiteToursPage;
