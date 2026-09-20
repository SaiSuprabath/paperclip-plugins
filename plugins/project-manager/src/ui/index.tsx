import styles from "./styles.css";
export { ProjectManagerPage, ProjectScheduleTab, PmSidebarLink, PmDashboardWidget } from "./Widgets.js";

// Inject the stylesheet once. The UI bundle runs as same-origin JS inside the Paperclip app.
const STYLE_ID = "suprabath-project-manager-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = styles as unknown as string;
  document.head.appendChild(el);
}
