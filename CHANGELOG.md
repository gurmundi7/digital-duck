# Changelog

## Unreleased

- The duck is a pet first. Pull request watch, the morning briefing, the end-of-day recap and the nudges file are gone, along with the `[mail]` tag and Deliver my briefing now. Ask about your mail or your day in chat instead; connectors still answer. Settings → Work is now Your day.

## 0.3.1

- The welcome tour now helps when no AI is set up yet. Pick Claude Code, Codex, a free Gemini key, Ollama on this Mac, or an API key you already have. The duck walks you through the steps, checks them, and asks a test question. You can still skip it.
- Tells you once when a new version is out, and adds Get version X… to the 🦆 menu. It asks GitHub for the latest version number once a day. Turn it off in Settings → Pet.
- SECURITY.md and the README say what each brain can reach at each access level, and the README says how to remove the duck.

## 0.3.0 (not released, ships in 0.3.1)

- A short welcome tour opens on first launch: what the duck does, pick it up, talk to it, things to try, and where everything lives. It picks or sets up a brain if none is ready. Skip it any time; it stays in the 🦆 menu as Welcome tour.
- Chat through more brains: Codex CLI, Gemini CLI, the OpenAI API (or any OpenAI-compatible server such as Ollama or LM Studio) and the Gemini API, as well as Claude Code and the Anthropic API. Pick one in Settings → Brain → Who answers.
- API keys for Anthropic, OpenAI and Gemini are kept in the macOS Keychain. Codex and Gemini CLI use the saved key only when they have no login of their own.

## 0.2.1

- The duck stays on the whole width of a window. Before, on a wide window it fell through the top edge when it walked more than a short way from the middle.

## 0.2.0

- Knows when you're on a call: a call app in front, or another app using the microphone. Puts on headphones, pauses the music and stays quiet until the call ends.
- Controls your music in any Now Playing player (YouTube Music, Spotify, Music) by chat, voice or global keys, through `media-control`. Volume up, down or to a level. Settings → Music changes the keys.
- Pauses the music while you talk to it, and for its announcements, then plays it again.
- Music notes float up from its head while music plays.
- Keeps the Mac awake from the menu, chat or voice, for a set time or until you say otherwise.
- Says at most two sentences out loud; the bubble shows the whole reply.
- Answers faster: one Claude Code process stays running between questions instead of one per question.
- Keeps a log, `app.log`, in the config folder.

## 0.1.0

First release.

- A robot duck that walks along the bottom of your Mac screen, climbs onto windows, falls over and gets back up.
- Chat through Claude Code or an Anthropic API key. Replies in a speech bubble and out loud.
- Four access levels: chat only (default), open apps, look things up, full access.
- Moods: naps, boredom, sulking, petting. Timed naps on request.
- Roller skates, a beach ball, pecking, dancing to Music or Spotify.
- Four colours: classic, charcoal, purple, blue.
- Optional: voice input, meeting reminders, nudges, pull request watch, morning briefing, end-of-day recap.
- A Settings window for all of it.
- Runs Pollen Robotics' Microduck simulator (MuJoCo model and trained policies) unchanged, under Apache 2.0.
