import { useEffect, useState } from "react";
import { fetchHomeData } from "../../api/toursApi";
import "../../components/homePage/home.css";
import { SiteHeader, UtilityBar } from "../../components/homePage/SiteChrome";
import { Hero, HeroSearchCard } from "../../components/homePage/Hero";
import {
  BestSellers,
  CategoryTiles,
  CtaBand,
  FeaturedTours,
  ReviewsSection,
  SafariBanner,
  StepsStrip
} from "../../components/homePage/HomeSections";
import SeoHead from "../../components/common/SeoHead";
import { BRAND } from "../../config/brand";

const HomePage = () => {
  const [home, setHome] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetchHomeData()
      .then((data) => {
        if (mounted) setHome(data || null);
      })
      .catch(() => {
        // The hero, search and booking steps still work without the tour lists.
      });
    return () => {
      mounted = false;
    };
  }, []);

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
          <SafariBanner safari={home?.safari} />
          <BestSellers tours={home?.bestSellers} />
          <StepsStrip />
          <ReviewsSection reviews={home?.reviews} />
          <CtaBand />
        </div>
      </div>
    </>
  );
};

export default HomePage;
