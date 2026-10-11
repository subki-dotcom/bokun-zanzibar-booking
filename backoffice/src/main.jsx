import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "../../shared/src/styles/app.css";
import { AuthProvider } from "../../shared/src/context/AuthContext";
import BackOfficeRoutes from "./routes/BackOfficeRoutes";
import { markRunningInBackOffice } from "./config/appContext";

markRunningInBackOffice();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BackOfficeRoutes />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
