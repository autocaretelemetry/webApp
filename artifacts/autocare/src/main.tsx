import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { configureApiBaseUrl } from "./lib/api-base";

configureApiBaseUrl();

createRoot(document.getElementById("root")!).render(<App />);
