# Security

## Reporting

Please report security problems privately through GitHub's "Report a vulnerability" button on the Security tab of this repository, not in a public issue. You will get a reply within a week.

## What to know before you report

Digital Duck runs on your Mac and, by default, runs nothing on it. Chat goes to the brain you pick in Settings: Claude Code, Codex CLI or Gemini CLI on your Mac, or the Anthropic, OpenAI or Gemini API with your own key, or an OpenAI-compatible server you set (such as Ollama). The risks grow with the access level you pick:

- **Chat only** (default): the duck talks and moves. Your messages go to the company behind your brain, or to your own server.
- **Open apps, files and links**: the duck can launch things with `open`. It cannot change or delete files.
- **Look things up**: adds web search and reading web pages. A page it reads could try to steer it, so it still cannot run commands.
- **Full access**: the CLI brain runs with its own safety checks off. Claude Code skips permission prompts, Codex runs with `--dangerously-bypass-approvals-and-sandbox`, and Gemini CLI runs in `yolo` mode. It can run any command, read any file and control any app, without asking. Text it reads (a web page, an email, a file) can try to make it do things. This level is for people who accept that. It is never turned on by itself. The APIs have no shell, so for them Full access is the same as Look things up.

Below Full access, the CLI brains rely on their own limits, which differ:

- **Claude Code** runs in the duck's config folder, and is granted no tools beyond the level.
- **Codex CLI** runs in its `read-only` sandbox. It cannot change anything, but it can read files and run read-only commands, and what it reads can end up in its answer and go to OpenAI.
- **Gemini CLI** runs in `plan` mode, which allows only read-only tools. It can read files, and what it reads can go to Google.

API keys are stored in your login Keychain under "Digital Duck", never in a file.

## Updates

A built app asks `api.github.com` for this repository's latest release once a day. The request carries no account or ID. When a newer version is out, the duck points you to the release page. It never downloads or installs anything by itself. Turn it off in Settings → Pet.

Things that would count as a security bug: any way for the duck to run commands or read files at a level that should not allow it; secrets written to disk (API keys belong only in the Keychain).
