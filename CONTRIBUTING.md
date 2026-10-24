# Contributing

Thanks for looking. Bug reports, ideas and pull requests are all welcome.

## Run it from source

```
git clone https://github.com/gurmundi7/digital-duck
cd digital-duck
npm install
npm start
```

`npm test` runs the tests. `npm run start:log` keeps a log in `state/duck.log`.

## Pull requests

- Keep each pull request to one change.
- Every fix ships with a test that fails without it. Tests live in `test/` and run with `npm test`.
- Run the duck and try your change before opening the pull request.
- Match the file you are in: naming, structure, comment style. The file wins over your preference.
- Comments explain why, not what. Most code needs none.
- Do not change anything in `sim/`. That is Pollen Robotics' simulator, kept unchanged under its own license. If the simulator needs a fix, send it upstream.

## Where things are

```
electron/   window, menu, brain (Claude), speech, Swift helpers
renderer/   physics and policy loop, behaviour, speech bubble, audio
sim/        Pollen's simulator source and assets, unchanged
test/       node:test files
```

## Ideas that fit

New tricks, new moods, better falls, a Windows build, smaller and quicker. Things that make the duck feel more alive on a desktop.

## Ideas that do not fit

Anything that sends data off the user's Mac without a switch in Settings, analytics, accounts, or a duck that nags.

## License

By contributing you agree your work is released under the Apache License 2.0, like the rest of Digital Duck.
