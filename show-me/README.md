# show-me

A pane that draws the mermaid diagrams of each answer as images.

<img src="../docs/show-me.png" alt="The show-me pane drawing a flowchart from an answer, with keys to step through, open and close" width="780">

## What it does

- **Any answer**: when an answer holds one or more ` ```mermaid ` fences, the pane opens and draws each one as a picture once the turn ends.
- **`/show-me <question>`**: sends the question with a request to answer in mermaid diagrams.
- **`/show-me`**: opens the pane again with the last diagrams and gives it the keyboard, so `x` and Esc work at once.
- **Keys** while the pane has focus: `p` and `n` step through the diagrams, `o` opens the PNG in the system viewer, `x` or Esc closes the pane.

If rendering fails, the pane shows the first error line and the diagram's source.

## Requirements

- [`mmdc`](https://github.com/mermaid-js/mermaid-cli) on `PATH`. On macOS with Google Chrome installed, skip puppeteer's browser download; the mod points `mmdc` at the installed Chrome:

  ```sh
  PUPPETEER_SKIP_DOWNLOAD=1 npm i -g @mermaid-js/mermaid-cli
  ```

  Elsewhere, install it normally so puppeteer brings its own browser.
- A terminal with the kitty graphics protocol, such as Ghostty or kitty. Other terminals show the diagram's title in place of the picture.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install show-me@claude-code-mods
```

Restart Claude Code and type `/show-me how does this request flow through the app`.

## Notes

- The pane opens by itself only when the terminal is at least 144 columns wide. Below that a toast says how many diagrams are ready; `/show-me` opens the pane.
- Images are written under `$TMPDIR/show-me/`, one folder per turn.
- Subagent answers are ignored; only the main conversation's diagrams are drawn.

## Develop

```sh
claude plugin validate .
claude plugin test .
```
