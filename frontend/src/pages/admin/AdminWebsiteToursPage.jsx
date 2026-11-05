import { useEffect, useMemo, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { BsGrid3X3Gap } from "react-icons/bs";
import { fetchAdminWebsiteProducts, updateAdminWebsiteProductFeatured, updateAdminWebsiteProductVisibility } from "../../api/toursApi";
import { AdminPage, DataTable, EmptyState, ErrorState, FilterBar, PageHeader, SectionCard, StatusBadge } from "../../components/admin/ui";
import { formatAdminMoney } from "../../utils/adminFormat";
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

  const columns = [
    {
      key: "title",
      header: "Product",
      render: (product) => <a href={`/tours/${product.slug}`} target="_blank" rel="noopener noreferrer">{product.title}</a>
    },
    { key: "bokunProductId", header: "Bókun ID" },
    { key: "from", header: "From", money: true, render: (product) => (Number(product.fromPrice) > 0 ? formatAdminMoney(product.fromPrice, product.currency || "USD") : "—") },
    {
      key: "notes",
      header: "Notes",
      render: (product) => (
        <div className="d-flex flex-wrap gap-1">
          {isDuplicate(product) ? <StatusBadge value="warning" label="Possible duplicate" /> : null}
          {needsText(product) ? <StatusBadge value="info" label="No short description" /> : null}
          {!product.hasDescription ? <StatusBadge value="neutral" tone="neutral" label="No description" /> : null}
        </div>
      )
    },
    {
      key: "website",
      header: "Website",
      render: (product) => (
        <>
          <Button size="sm" variant="outline-secondary" disabled={savingId === product.bokunProductId} onClick={() => toggle(product)}>
            {product.hiddenFromPublic ? "Show on website" : "Hide from website"}
          </Button>
          {product.hiddenFromPublic ? <small className="d-block text-muted mt-1">Hidden</small> : null}
        </>
      )
    },
    {
      key: "home",
      header: "Home page",
      render: (product) => (
        <Button
          size="sm"
          variant={product.featuredOnHome ? "primary" : "outline-secondary"}
          disabled={savingId === product.bokunProductId || product.hiddenFromPublic}
          onClick={() => toggleFeatured(product)}
          aria-pressed={Boolean(product.featuredOnHome)}
        >
          {product.featuredOnHome ? "Featured ✓" : "Feature"}
        </Button>
      )
    },
    {
      key: "menu",
      header: "Menu",
      render: (product) => (
        <Button
          size="sm"
          variant={product.featuredInMenu ? "primary" : "outline-secondary"}
          disabled={savingId === product.bokunProductId || product.hiddenFromPublic}
          onClick={() => toggleMenuTour(product)}
          aria-pressed={Boolean(product.featuredInMenu)}
        >
          {product.featuredInMenu ? "In menu ✓" : "Show in menu"}
        </Button>
      )
    }
  ];

  return (
    <AdminPage className="admin-website-tours">
      <PageHeader
        eyebrow="Operations"
        title="Website Tours"
        description={`Hide duplicates or products you do not sell online (hidden products leave listings and the sitemap; their page still opens from a link). Feature up to six tours on the home page (${featuredCount}/6 chosen) and one in the header menu; with none chosen, the most booked tours are shown.`}
      />
      {error && products.length ? <ErrorState title="That change was not saved" message={error} /> : null}
      <SectionCard
        title="Products"
        description={loading ? "" : `${visible.length} of ${products.length} shown`}
        actions={
          <FilterBar>
            <Form.Select size="sm" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter products">
              <option value="all">All products ({products.length})</option>
              <option value="duplicates">Possible duplicates ({products.filter(isDuplicate).length})</option>
              <option value="missing-text">No short description ({products.filter(needsText).length})</option>
              <option value="hidden">Hidden ({products.filter((product) => product.hiddenFromPublic).length})</option>
              <option value="featured">Featured on home ({featuredCount}/6)</option>
            </Form.Select>
          </FilterBar>
        }
      >
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(product) => product.bokunProductId}
          loading={loading}
          error={!products.length ? error : ""}
          caption="Website products"
          empty={<EmptyState icon={BsGrid3X3Gap} title="No products match this filter" message="Choose another filter, or sync products from Bókun." />}
        />
      </SectionCard>
    </AdminPage>
  );
};

export default AdminWebsiteToursPage;
