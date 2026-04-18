import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchTourCategories, fetchTours } from "../../api/toursApi";
import { mapBokunTourForListing } from "../../components/tours/listing/listing.helpers";
import HeroSection from "../../components/home/HeroSection";
import FeaturedToursSection from "../../components/home/FeaturedToursSection";
import WhyBookUsSection from "../../components/home/WhyBookUsSection";
import TourCategoriesSection from "../../components/home/TourCategoriesSection";
import BestSellersSection from "../../components/home/BestSellersSection";
import HowItWorksSection from "../../components/home/HowItWorksSection";
import TestimonialsSection from "../../components/home/TestimonialsSection";
import InspirationSection from "../../components/home/InspirationSection";
import FinalCTASection from "../../components/home/FinalCTASection";
import {
  buildCategoryCards,
  homeFallbackTours,
  pickBestSellerTours,
  pickFeaturedTours
} from "../../components/home/home.helpers";

const HomePage = () => {
  const navigate = useNavigate();
  const [tourRows, setTourRows] = useState([]);
  const [categoryRows, setCategoryRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadHomeData = async () => {
      try {
        setLoading(true);
        const [toursResponse, categoriesResponse] = await Promise.all([
          fetchTours({ page: 1, limit: 18 }),
          fetchTourCategories()
        ]);

        if (!mounted) {
          return;
        }

        setTourRows(Array.isArray(toursResponse?.items) ? toursResponse.items : []);
        setCategoryRows(Array.isArray(categoriesResponse) ? categoriesResponse : []);
      } catch {
        if (!mounted) {
          return;
        }

        setTourRows([]);
        setCategoryRows([]);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadHomeData();
    return () => {
      mounted = false;
    };
  }, []);

  const mappedTours = useMemo(() => {
    const normalized = (tourRows || []).map(mapBokunTourForListing);
    return normalized.length > 0 ? normalized : homeFallbackTours;
  }, [tourRows]);

  const featuredTours = useMemo(() => pickFeaturedTours(mappedTours, 6), [mappedTours]);
  const bestSellerTours = useMemo(() => pickBestSellerTours(mappedTours, 8), [mappedTours]);
  const categories = useMemo(() => buildCategoryCards(categoryRows), [categoryRows]);

  const handleHeroSearch = (queryString = "") => {
    navigate(`/tours${queryString ? `?${queryString}` : ""}`);
  };

  return (
    <>
      <HeroSection onSearch={handleHeroSearch} />
      <FeaturedToursSection tours={featuredTours} loading={loading} />
      <WhyBookUsSection />
      <TourCategoriesSection categories={categories} />
      <BestSellersSection tours={bestSellerTours} />
      <HowItWorksSection />
      <TestimonialsSection />
      <InspirationSection />
      <FinalCTASection />
    </>
  );
};

export default HomePage;
