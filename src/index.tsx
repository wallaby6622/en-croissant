import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { createRoot } from "react-dom/client";
import App from "./App";

import "./translation/setup";
import { setAutoFreeze } from "immer";

dayjs.extend(customParseFormat);

setAutoFreeze(false);

const container = document.getElementById("app");
const root = createRoot(container!);
root.render(<App />);
