# Hermes skills for HermesOffice

Skills that teach the **Hermes Agent** (Nous Research) how to work with the
HermesOffice suite. HermesOffice's AI panels talk to the local Hermes
gateway (`http://127.0.0.1:8642/v1`, see `docs/hermes-integration.md`);
these skills close the loop on the gateway side so the agent uses the
suite's tools and conventions correctly.

## Install

Copy (or symlink) each skill directory into your Hermes skills folder so the
agent can load them by name:

```bash
cp -r hermes/skills/* ~/.hermes/skills/
hermes gateway restart
```

The skills reference the repository's `templates/` directory; adjust the
paths inside if your checkout lives elsewhere, or ship the templates next to
the skills.

## Skills

| Skill                    | Purpose                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `hermesoffice`           | Core conventions: session continuity, in-app tools vs file-level tools, the save-and-reload contract |
| `hermesoffice-documents` | Producing and editing Word documents, using the `templates/docs` library                             |
| `hermesoffice-decks`     | Producing presentations with `plan_deck`/`generate_deck`, using the `templates/decks` style specs    |
