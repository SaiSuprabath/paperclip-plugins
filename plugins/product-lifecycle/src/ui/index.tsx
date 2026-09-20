import styles from "./styles.css";
export { ProductLifecyclePage, ProjectSprintsTab, PlSidebarLink, PlDashboardWidget } from "./Widgets.js";

const STYLE_ID = "suprabath-product-lifecycle-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = styles as unknown as string;
  document.head.appendChild(el);
}
