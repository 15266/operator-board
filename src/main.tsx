import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@kitlangton/rolling-number/styles.css";
import "./index.css";
import "./components/business-motion.css";
import "./rhine-refined.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
