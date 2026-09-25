# Security policy

This is a single-user local desktop tool, not a hosted multi-user service.

- Keep the backend bound to `127.0.0.1`. Do not expose port 8787 through a tunnel or reverse proxy.
- Requests with foreign browser origins or non-loopback Host headers are rejected. Local processes are trusted; there is no local-user authentication boundary.
- Model API keys are stored in the local settings file, not in an OS credential vault. Protect the data directory and do not attach it to public issues.
- Model providers receive the prompts and project context necessary for generation. Review your provider's policies before using confidential material.
- Generated text is untrusted. Do not execute instructions or commands contained in model output.
- Never commit `.env`, settings, session files, logs, certificates or private work histories.

## Reporting

Do not post keys or sensitive project files in public issues. Once the repository is created, enable GitHub private vulnerability reporting and use its **Security → Report a vulnerability** entry. Until that channel is enabled, contact the repository owner privately. No public security contact is configured yet.

Dependency auditing and regression tests reduce risk; they are not a guarantee that the application has no vulnerabilities.
