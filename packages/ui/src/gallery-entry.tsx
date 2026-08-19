import * as React from "react";
import { createRoot } from "react-dom/client";
import { Gallery } from "./gallery";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<Gallery />);
}
