# Changelog

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
