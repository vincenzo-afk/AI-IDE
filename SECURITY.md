# Security Policy

## Supported versions

Forgehouse is currently in active early development. Security fixes are applied to the latest `main` branch.

| Version | Supported |
|---|---|
| `main` | Yes |
| Older commits and rollback branches | No |

## Reporting a vulnerability

Please do not disclose security vulnerabilities in a public issue. Use GitHub’s private [security advisory reporting flow](https://github.com/vincenzo-afk/AI-IDE/security/advisories/new) and include a clear description, affected file or route, reproduction steps, impact, and suggested mitigation. Do not include live credentials or private project contents.

## Security boundaries

The server keeps `GROQ_API_KEY` out of client bundles. Model-produced file changes are restricted to browser-safe paths and size limits. Preview content runs in a sandboxed iframe, and public pages set a restrictive content security policy. The current application has no authentication, authorization, rate limiting, or managed database; do not expose the development API to untrusted users until those controls are added.

## Credential hygiene

Use server-side environment variables or a hosting provider’s secret manager. Never commit `.env`, API tokens, generated project data, or credentials. If a credential is exposed, revoke it immediately and rotate it.
