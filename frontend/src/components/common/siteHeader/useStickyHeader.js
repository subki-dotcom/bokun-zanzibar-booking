import { useEffect, useState } from "react";

// True once the page has scrolled past `offset` pixels (read once per frame).
const useStickyHeader = (offset = 80) => {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setStuck(window.scrollY > offset);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [offset]);
  return stuck;
};

export default useStickyHeader;
