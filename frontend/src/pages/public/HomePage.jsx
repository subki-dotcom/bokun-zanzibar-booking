import { useEffect, useMemo, useState } from "react";
import { fetchHomeData, fetchTours } from "../../api/toursApi";
import { mapBokunTourForListing } from "../../components/tours/listing/listing.helpers";
import "../../components/homePage/home.css";
import { SiteHeader, UtilityBar } from "../../components/homePage/SiteChrome";
import { Hero, HeroSearchCard } from "../../components/homePage/Hero";
import { CategoryTiles, FeaturedTours } from "../../components/homePage/HomeSections";
import WhyBookUsSection from "../../components/home/WhyBookUsSection";
import BestSellersSection from "../../components/home/BestSellersSection";
import HowItWorksSection from "../../components/home/HowItWorksSection";
import TestimonialsSection from "../../components/home/TestimonialsSection";
import InspirationSection from "../../components/home/InspirationSection";
import FinalCTASection from "../../components/home/FinalCTASection";
import SeoHead from "../../components/common/SeoHead";
import { homeFallbackTours, pickBestSellerTours } from "../../components/home/home.helpers";
import { BRAND } from "../../config/brand";

const HomePage = () => {
  const [tourRows, setTourRows] = useState([]);
  const [home, setHome] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadHomeData = async () => {
      try {
        const [toursResponse, homeResponse] = await Promise.all([
          fetchTours({ page: 1, limit: 18 }),
          fetchHomeData().catch(() => null)
        ]);

        if (!mounted) {
          return;
        }

        setTourRows(Array.isArray(toursResponse?.items) ? toursResponse.items : []);
        setHome(homeResponse || null);
      } catch {
        if (!mounted) {
          return;
        }

        setTourRows([]);
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

  const bestSellerTours = useMemo(() => pickBestSellerTours(mappedTours, 10), [mappedTours]);

  return (
    <>
      <SeoHead title={`${BRAND.name} | Zanzibar Tours & Activities`} description="Book Zanzibar tours, activities, transfers, and safaris with live availability and secure checkout." />
      <div className="hp">
        <UtilityBar />
        <SiteHeader />
        <div className="hp-main">
          <Hero />
          <HeroSearchCard />
          <CategoryTiles styles={home?.styles} />
          <FeaturedTours tours={home?.featured} />
        </div>
      </div>
      <WhyBookUsSection />
      <BestSellersSection tours={bestSellerTours} />
      <HowItWorksSection />
      <TestimonialsSection />
      <InspirationSection />
      <FinalCTASection />
    </>
  );
};

export default HomePage;
