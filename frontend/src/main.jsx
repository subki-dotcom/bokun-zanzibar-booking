import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./app/styles.css";
import App from "./app/App";
import { AuthProvider } from "./context/AuthContext";
import { PaymentProvidersProvider } from "./context/PaymentProvidersContext";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PaymentProvidersProvider>
          <App />
        </PaymentProvidersProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
