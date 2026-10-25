# Digital Duck

An unofficial desktop pet inspired by Pollen's Microduck.

![Digital Duck talking, falling and getting up, roller skating, changing colours, then opening Calculator on a Mac desktop](docs/demo.gif)

A small robot duck that lives along the bottom of your Mac screen. It walks, hops onto your windows, falls over, gets back up, and talks back.

Under the feathers it is [Pollen Robotics](https://www.pollen-robotics.com/)' Microduck robot in simulation: their MuJoCo model and their trained walking policies, from the open source [Microduck simulator](https://huggingface.co/spaces/pollen-robotics/microduck-simulator) by Pollen Robotics and Hugging Face. Every step is a trained robot policy driving a physics simulation, not a canned animation.

Free, open source, Mac. [Download](https://github.com/gurmundi7/digital-duck/releases/latest) · [Website](https://gurmundi7.github.io/digital-duck/) · [Report a bug or ask for a trick](https://github.com/gurmundi7/digital-duck/issues)

Follow the duck: [@gurbuilds on Instagram](https://www.instagram.com/gurbuilds/) · [@gurbuilds on X](https://x.com/gurbuilds)

## Install

Download the `.dmg` from [Releases](https://github.com/gurmundi7/digital-duck/releases), drag Digital Duck to Applications, and open it. Apple Silicon and Intel builds are both there.

A 🦆 appears in the menu bar. That is the whole setup.

## What it does

- **Walks your desktop.** It wanders the bottom of the screen, looks at your cursor when you come near, and ignores the mouse everywhere else, so clicks go through to your apps.
- **Climbs your windows.** The top edge of each window is a ledge. It hops up, walks along it, rides along when you drag the window, and falls when you close it. "Jump up" and "get down" work in chat.
- **Falls and gets up.** Pick it up and drop it. It tumbles and stands back up on its own, the way the robot does.
- **Talks.** Click it to chat. It answers in a speech bubble and out loud, in character, and does what you ask: sit, roll, peck, dance, come here, put on roller skates, play ball, "nap for 5 minutes".
- **Has moods.** It gets tired and naps, gets bored and asks for attention, sulks if ignored, and likes being petted (stroke its head with the mouse). It dances when music plays and goes quiet during calls.
- **Helps a bit.** "Remind me at 3 to call Sam", "in 20 minutes", "focus for 45 minutes". Reminders stay on your Mac.
- **Does things on your Mac, if you let it.** Opens apps and links, looks things up on the web, or with full access runs anything Claude Code can. See [What the duck can do](#what-the-duck-can-do).
- **Four colours.** Classic, charcoal, purple and blue, the four printed robots.
- **Sleeps.** Left alone it sits, then sleeps with the physics paused and near zero CPU.

Right-click the duck, or click 🦆 in the menu bar, for everything else. **Settings…** (⌘,) has every option in one window.

## Chat

Chat needs a Claude brain. Either works:

- **Claude Code.** If the `claude` CLI is installed and logged in, the duck uses it. Nothing to set up. Replies use your Claude account.
- **An Anthropic API key.** Without the CLI, open Settings → Anthropic API key… and paste a key from [console.anthropic.com](https://console.anthropic.com). It is stored in your login Keychain, never in a file.

Without either, the duck still walks, climbs and plays. It just can't talk back.

Settings → Model picks Haiku (quickest), Sonnet or Opus.

## What the duck can do

A new duck can only talk. Settings → **What the duck can do** has four levels (they need Claude Code; the API key brain only chats):

1. **Chat only.** The default. Runs nothing on your Mac.
2. **Open apps, files and links.** "Open Safari", "open google.com", "open my Downloads". It can launch things but cannot change or delete anything.
3. **Look things up.** Opening, plus web search and reading web pages, for news, weather and facts.
4. **Full access.** Anything Claude Code can do: run commands and scripts, control apps with AppleScript, change files, with no confirmation. Pick this only if you trust everything you say to it, and everything it reads, since a web page or email it reads could try to steer it.

Advanced: flags in `extraArgs` in the config go to the `claude` CLI as they are.

## Off until you turn them on

Each of these is a switch in Settings:

- **Voice input.** Press `Alt+D` and talk. Needs `brew install whisper.cpp` and a speech model in `models/` inside the config folder (`ggml-base.en.bin` from [whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)). Transcribed on your Mac.
- **Meeting reminders.** Reads your calendar and walks over a few minutes before a meeting.
- **Nudges.** Meeting reminders, stretch breaks, and lines another tool appends to a JSONL file (pick the file in Settings; one `{"message", "source"}` object per line).
- **Pull request watch.** Uses your `gh` CLI to tell you when checks go red or green, or a review lands.
- **Morning briefing and end-of-day recap.**
- **Connectors and MCP servers.** Lets Claude Code use whatever your Claude account has linked (Calendar, Gmail, Slack, Jira and so on) and any servers under `mcpServers` in the config, so the duck can answer from them. Needs Claude Code.

Everything is saved to `~/Library/Application Support/Digital Duck/config.json`. **Edit raw config…** at the bottom of Settings opens it.

## Privacy

What it reads, all on your Mac:

- The position and app name of your on-screen windows, to find ledges. No window titles or contents.
- How long you have been idle and whether the screen is locked, to greet you and pace itself.
- Your first name from your macOS account, to call you by it. Change it under Settings → Your name.
- Whether Music or Spotify is playing, so it can dance. macOS asks first.
- Your calendar, only with meeting reminders on. macOS asks first.
- Your open pull requests through `gh`, only with pull request watch on.
- The microphone, only with voice input on, only while you hold the talk key. Audio is transcribed locally and not kept.

What it sends:

- **Chat** goes to Anthropic, through your Claude Code CLI or your API key: what you type or say, a short context line (date, time, how the duck feels), its character description, and its notebook of things you asked it to remember. Nothing else.
- **Look things up and Full access** let it search the web through Claude Code, and with Full access, read anything on your Mac it decides it needs to answer you.
- **Connectors**, only with that switch on: Claude Code can read whatever your linked connectors can reach, and the morning briefing asks it about your mail and meetings.

No analytics, no telemetry, no accounts. Its notebook, reminders and chat history stay in the config folder.

## Build from source

Needs Node 20+, macOS and Xcode command line tools.

```
git clone https://github.com/gurmundi7/digital-duck
cd digital-duck
npm install
npm start
```

`npm test` runs the tests. `npm run dist` builds the `.dmg` files into `release/`. Signing and notarizing use the Apple Developer ID in your Keychain and a `notarytool` profile set in `APPLE_KEYCHAIN_PROFILE`.

Debugging: `kill -USR2 <pid>` writes `snap.png` (the duck's own render) to the config folder and logs its pose. `kill -USR1 <pid>` runs `debug.js` from that folder inside the renderer (`duck.sim`, `duck.behaviour`, `duck.bubble` are global).

```
electron/   window, menu, brain, speech, helpers (Swift)
renderer/   physics and policy loop, behaviour, bubble, audio
sim/        Pollen's simulator source and assets, unchanged (Apache 2.0)
```

## Roadmap

- **Windows build (fast follow).** The physics, policies, rendering and chat already run anywhere Electron does. These parts are Mac only today and need a Windows version:
  - `electron/winlist.swift`, the window list that becomes ledges (CoreGraphics)
  - `electron/agenda.swift`, meeting reminders (EventKit)
  - spoken replies through macOS `say` voices
  - start at login through a LaunchAgent (checkouts) or a macOS login item
  - voice input through `brew install whisper.cpp`
  - Music and Spotify detection through AppleScript

## Contributing

Bug reports, "can it do X?" ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and license

The robot, its model, policies, meshes, voices and the simulator are by [Pollen Robotics](https://www.pollen-robotics.com/) and [Hugging Face](https://huggingface.co/spaces/pollen-robotics/microduck-simulator), under Apache 2.0 (`sim/LICENSE-pollen-simulator`). The model and the walking policies come from [pollen-robotics/microduck](https://github.com/pollen-robotics/microduck) and [pollen-robotics/microduck_rl](https://github.com/pollen-robotics/microduck_rl). Physics by [MuJoCo](https://github.com/google-deepmind/mujoco), rendering by [three.js](https://threejs.org/), policies run on [ONNX Runtime Web](https://onnxruntime.ai/), all inside [Electron](https://www.electronjs.org/). Microduck is Pollen Robotics' robot. Digital Duck is not affiliated with or endorsed by Pollen Robotics or Hugging Face. If you like the duck, get the real one.

Digital Duck is Apache 2.0. See `LICENSE` and `NOTICE`.
