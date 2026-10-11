import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Loader from "../../../shared/src/components/common/Loader";
import BackOfficeHome from "../pages/BackOfficeHome";
import BackOfficeLoginPage from "../pages/BackOfficeLoginPage";
import adminRoutes from "./AdminRoutes";

const BackOfficeRoutes = () => (
  <Suspense fallback={<Loader message="Loading page..." />}>
    <Routes>
      <Route path="/login" element={<BackOfficeLoginPage />} />
      <Route path="/" element={<BackOfficeHome />} />
      {adminRoutes()}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
);

export default BackOfficeRoutes;
