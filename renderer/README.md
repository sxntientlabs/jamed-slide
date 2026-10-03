# Koasis PPTX renderer

This service converts uploaded PPTX files to slide PNGs for the Koasis visual
preview. It is intentionally separate from the Firebase App Hosting web app so
LibreOffice and Poppler can run on a VPS without increasing the App Hosting
runtime image.

## Runtime configuration

- `PORT`: HTTP port; defaults to `8080`.
- `RENDERER_TOKEN`: required shared token. The service refuses `/render` until
  this is configured.
- `SOFFICE_PATH`: optional LibreOffice binary override; defaults to `soffice`.
- `PDFTOPPM_PATH`: optional Poppler binary override; defaults to `pdftoppm`.

## Endpoints

- `GET /healthz` — liveness check. The response includes `ready: false` until
  `RENDERER_TOKEN` is configured.
- `POST /render` — accepts `{ "pptxBase64": "..." }` and requires the same
  value in the `X-Renderer-Token` header.
