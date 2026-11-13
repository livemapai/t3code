import { APP_DISPLAY_NAME } from "./branding";

let appName = APP_DISPLAY_NAME;
let pageTitle: string | null = null;

function apply(): void {
  document.title = pageTitle ?? appName;
}

export function setDocumentAppName(name: string): void {
  appName = name;
  apply();
}

export function setDocumentPageTitle(title: string | null): void {
  pageTitle = title;
  apply();
}
