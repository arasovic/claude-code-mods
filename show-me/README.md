# show-me

A pane that draws the mermaid diagrams of each answer as images.

<img src="../docs/show-me.png" alt="The show-me pane drawing a flowchart from an answer, with keys to step through, open and close" width="780">

## What it does

- **Any answer**: when an answer holds one or more ` ```mermaid ` fences, the pane opens and draws each one as a picture once the turn ends.
- **`/show-me <question>`**: sends the question with a request to answer in mermaid diagrams.
- **History**: the pane keeps the last 30 diagrams across turns. A new answer jumps to its first diagram; `p` and `n` step back into earlier turns. The header shows which turn a diagram came from. A diagram whose source is already in the history shows at once, without a new render.
- **`/show-me`**: opens the pane again with the history.
- **Keys**: the pane never takes the keyboard by itself, so typing and Claude Code's own keys keep working. Click the pane or press ctrl+x tab, then `p` and `n` step through the diagrams, `o` opens the PNG in the system viewer, and `x` or Esc closes the pane.

If rendering fails, the pane shows the first error line and the diagram's source. If `mmdc` is not installed, a toast and the pane give the install command.

## Requirements

- [`mmdc`](https://github.com/mermaid-js/mermaid-cli) on `PATH`. On macOS with Google Chrome installed, skip puppeteer's browser download; the mod points `mmdc` at the installed Chrome:

  ```sh
  PUPPETEER_SKIP_DOWNLOAD=1 npm i -g @mermaid-js/mermaid-cli
  ```

  Elsewhere, install it normally so puppeteer brings its own browser.
- A terminal with the kitty graphics protocol, such as Ghostty or kitty. Other terminals show the diagram's title in place of the picture.
- The Claude desktop app does not need kitty: the pane shows the same picture there. Until the picture is ready, it shows the mermaid source.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install show-me@claude-code-mods
```

Restart Claude Code and type `/show-me how does this request flow through the app`.

## Notes

- The pane opens by itself only when the terminal is at least 144 columns wide. Below that a toast says how many diagrams are ready; `/show-me` opens the pane.
- Images are written under `$TMPDIR/show-me/`, one folder per turn. Each render deletes the turn folders older than a day, except the ones the history still shows.
- Subagent answers are ignored; only the main conversation's diagrams are drawn.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh show-me
```
