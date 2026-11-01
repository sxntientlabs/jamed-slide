---
name: koasis-artifacts
description: Reliable file and artifact workflow for Koasis Agent tasks.
---

# Koasis artifact workflow

When a user asks for a document, image, spreadsheet, slide, or other file:

1. Identify the requested output format from the user's words and requested
   filename or extension. Never substitute DOCX for PNG, PDF, PPTX, or another
   explicitly requested type.
2. Inspect any linked or attached source before editing it. Preserve the
   original and work in a task-specific output path.
3. Use the smallest suitable tool and validate that the output exists, has the
   requested MIME type/extension, and can be opened or rendered.
4. Return the actual artifact as an attachment or a working download link, not
   merely a description or a fake URL.
5. If the task needs Computer approval or an external login, say so before the
   side effect and keep the user-visible progress state accurate.
