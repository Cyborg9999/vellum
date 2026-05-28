import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initTheme } from "./lib/theme";
import "./index.css";

initTheme();

// grill M1: ErrorBoundary only catches render-phase errors. Async / event-
// handler errors (a missed await in a handler, a stray reject) silently
// disappear into the console. Surface them so the user at least sees a
// toast-equivalent in devtools and we can route them somewhere later.
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[unhandledrejection]", e.reason);
  });
  window.addEventListener("error", (e) => {
    console.error("[window.onerror]", e.error ?? e.message);
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
