# Security

## Reporting

Please report security problems privately through GitHub's "Report a vulnerability" button on the Security tab of this repository, not in a public issue. You will get a reply within a week.

## What to know before you report

Digital Duck runs on your Mac and, by default, runs nothing on it. The risks grow with the access level you pick in Settings:

- **Chat only** (default): the duck talks and moves. Your messages go to Anthropic through your own Claude Code CLI or API key. Nothing else leaves your Mac.
- **Open apps, files and links**: the duck can launch things with `open`. It cannot change or delete files.
- **Look things up**: adds web search and reading web pages. A page it reads could try to steer it, so it still cannot run commands.
- **Full access**: the duck runs Claude Code with permission prompts off. It can run any command, read any file and control any app, without asking. Text it reads (a web page, an email, a file) can try to make it do things. This level is for people who accept that. It is never turned on by itself.

Things that would count as a security bug: any way for the duck to run commands or read files at a level that should not allow it; secrets written to disk (the API key belongs only in the Keychain).
