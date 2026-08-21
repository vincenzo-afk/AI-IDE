# Contributing to Forgehouse

Contributions should make the conversational builder safer, clearer, and more useful without weakening the boundary between generated browser content and the server.

## Development setup

Use Node.js 22 or a compatible current release. From the repository root, run:

```bash
npm install
cp .env.example .env
npm run dev
```

The API starts on port `8787` and the Vite frontend on port `3000`. Keep `GROQ_API_KEY` empty when working on fallback behavior. Never commit `.env`, API keys, generated project data, or build artifacts.

## Branches and commits

Use branches such as `feat/revision-diff`, `fix/preview-csp`, or `docs/setup-guide`. Use Conventional Commits, for example `feat: add revision diff panel` or `fix: reject unsafe generated paths`.

## Pull requests

Describe the user-visible change, list verification commands, and explain any change to environment variables, API routes, generated-file validation, or public-site security headers. Verify with `npm install` and `npm run build`.

## Code style

Prefer small modules, explicit types at API boundaries, immutable revision writes, and clear error messages. Keep secrets on the server. Treat prompts, model responses, HTML, CSS, and JavaScript as untrusted input.

## Discussions and issues

Use feature requests for product improvements, bug reports for reproducible defects, and discussions for design questions. Security concerns should follow `SECURITY.md`.
