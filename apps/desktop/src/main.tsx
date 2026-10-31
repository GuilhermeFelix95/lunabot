import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./App.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
