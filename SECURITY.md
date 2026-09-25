# Security

BI Notebook Lab runs entirely in the browser: no backend, no accounts, no telemetry. Data you import stays in your browser's IndexedDB until you export it as a `.bilab.json` bundle.

Imported bundles and CSV/Excel files are treated as untrusted input and validated before they are loaded (see [`docs/PROJECT_BUNDLE.md`](./docs/PROJECT_BUNDLE.md) and [`docs/WORKSPACE_INTEGRITY.md`](./docs/WORKSPACE_INTEGRITY.md)).

To report a vulnerability, please open a private security advisory on this repository rather than a public issue.
