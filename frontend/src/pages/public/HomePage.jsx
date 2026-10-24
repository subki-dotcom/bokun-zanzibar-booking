import { useEffect, useState } from "react";
import { fetchHomeData } from "../../api/toursApi";
import "../../components/homePage/home.css";
import HomeView, { HOME_DESCRIPTION, HOME_TITLE, readPrerenderedHome } from "../../components/homePage/HomeView";
import SeoHead from "../../components/common/SeoHead";
import { BRAND } from "../../config/brand";

const HomePage = () => {
  const [home, setHome] = useState(readPrerenderedHome);

  useEffect(() => {
    let mounted = true;
    fetchHomeData()
      .then((data) => {
        if (mounted && data) setHome(data);
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
      <SeoHead title={HOME_TITLE} description={HOME_DESCRIPTION} image={`${BRAND.website}/images/home/hero-dhow-1280.jpg`} reviews={home?.reviews} />
      <HomeView home={home} />
    </>
  );
};

export default HomePage;
