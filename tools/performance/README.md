# Performance scenarios

Run from the repository root with the Electron binary and native toolchain installed:

```sh
npm run test:helper
npm run build
npm run test:performance
```

## Output backpressure

`test:helper` builds and runs `output-scenario` against the real native `Output` queue.
The scenario blocks its writer, submits an open event, 8,000 moves, a release and a
cancel, then drains the queue. The expected output is five lines, including the
initial ready message and the latest position. Control messages and changes of
wheel identity separate move runs. Further scenarios exercise raw protocol lines,
queue capacity, repeated stop, writer failure and a replacement output instance.

Pending adjacent moves for the same wheel share one queue entry. Formatting runs
on the writer thread. A release carries its own final coordinates; the renderer
uses those coordinates to choose the action. Intermediate hover states and tick
sounds can be skipped during backpressure. The existing overflow policy
applies to a queue filled with distinct control messages.

The executable accepts `--measure` to report just the blocked-writer workload on
an earlier implementation. It prints producer enqueue time, delivered line count,
bytes including newlines, and overflow drops. Compare optimized builds on the same
machine with interleaved runs. The timing boundary covers producer enqueue work;
desktop input-to-display latency requires a separate measurement.

## Production assets and overlays

`test:performance` launches Electron with disposable application data. It uses the
real `lolping://` protocol and loads the built overlay and preload twice. The
scenario checks body-free HEAD probes, GET content, rejected paths, custom-emote
fallback and cache invalidation, wheel release, bundled animation decoding and
emote removal. Input hooks and room connections remain inactive. The parent process
removes temporary data after Electron exits. Any failed check returns a nonzero status.

Pass a packaged ASAR to check the shipped renderer files:

```sh
npm run dist:mac
npm run test:performance -- release/mac-arm64/lolPing.app/Contents/Resources/app.asar
```

On Windows, run `npm run dist`, then
`npm run test:performance -- release/win-unpacked/resources/app.asar`.
CI exercises both packaged paths and retains both installers as artifacts.

An optional `--measure` after the artifact path skips HEAD-specific checks when
loading an earlier renderer bundle. The protocol comes from the current checkout;
compare protocol revisions from their respective checkouts. Full application
startup, physical input hooks and installer interactions need their own platform
checks.

## Package size

Production bundles use the existing esbuild minifier. Electron retains English
and Chinese resources, matching the application's language choices. The locale
list includes Windows language tags and macOS `.lproj` names. The DMG uses UDBZ,
a format supported by the pinned electron-builder version. Original animation,
image and audio files remain unchanged.

For size comparisons, build both revisions with the same lockfile, platform and
architecture. Record total JavaScript bytes, ASAR bytes, app regular-file bytes
without following symlinks, and installer bytes separately. Compression changes
installer transfer size; app size determines the installed file footprint.
