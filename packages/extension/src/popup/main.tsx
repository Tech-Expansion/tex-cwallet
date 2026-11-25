import { createRoot } from "react-dom/client";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/jetbrains-mono/400.css";
import { App } from "./App";
import "./style.css";

createRoot(document.getElementById("root")!).render(<App />);
