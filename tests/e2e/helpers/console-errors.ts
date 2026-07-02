import type {Page} from "@playwright/test";

// Shared console/pageerror collector for the e2e specs (react-boot, load-map).
// Attach it BEFORE the navigation whose errors you want to capture, then read
// the accumulator after the app settles. `critical()` filters out the expected
// external noise (fonts, analytics, failed third-party resource loads) that the
// app cannot control.
export function collectConsoleErrors(page: Page): {critical: () => string[]} {
  const errors: string[] = [];

  page.on("pageerror", error => {
    const message = error?.message || String(error);
    if (message) errors.push(`pageerror: ${message}`);
  });
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  const critical = () =>
    errors.filter(
      e =>
        !e.includes("fonts.googleapis.com") &&
        !e.includes("google-analytics") &&
        !e.includes("googletagmanager") &&
        !e.includes("Failed to load resource") &&
        // names-generator logs this as a handled fallback (it then picks a
        // random name); it fires nondeterministically during lazy name
        // materialization and is not a defect signal.
        !e.includes("Name is too short! Random name will be selected")
    );

  return {critical};
}
