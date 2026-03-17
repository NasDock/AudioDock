import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.less";
import "./styles/popover.less";
import { setupScrollbarAutoVisibility } from "./utils/scrollbar";

import { HashRouter } from "react-router-dom";

setupScrollbarAutoVisibility();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <App />
  </HashRouter>
);
