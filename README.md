# Forgehouse AI Website Studio

Forgehouse is a Lovable/Bolt-style conversational website builder rebuilt from the original AI-IDE client. It combines an AI build workspace, immutable revisions, a live preview, and public site URLs under `/sites/:slug`.

## Run locally

Install dependencies with `npm install`. Add a Groq key later as `GROQ_API_KEY` and select a model with `GROQ_MODEL`. Start the workspace with `npm run dev`; the API uses port 8787 and the frontend uses port 3000.

Build with `npm run build` and serve with `npm start`. Projects and revisions are persisted in `data/projects.json`, which is ignored from version control.

## Product model

Every instruction creates an immutable revision. The current revision renders in a sandboxed iframe. Publish records the revision that powers `/sites/:slug`. Restoring a revision creates a new revision, so history is never destroyed.

## Groq configuration

The generation endpoint includes a deterministic safe-preview fallback before a key is configured. The server-side Groq adapter will use `GROQ_API_KEY`; never place it in Vite defines, client code, or committed files.

## Rollback

The original repository source is preserved on `backup-before-ai-builder-2026-08-21`.