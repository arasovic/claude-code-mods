# recall-cue

Reminds Claude of a saved note when your prompt is about it.

## What it does

Before each prompt you send, recall-cue matches its words against your saved notes. When a note fits, it adds a short note to the prompt that only the model reads: the note's path and what it is about. The model reads the note when it fits and skips it when it does not.

```text
recall-cue: an automatic note the user does not see. These saved notes may fit this prompt. ...
- ~/.claude/projects/my-app/memory/release-flow.md: Bump the version, then tag
```

- It reads Claude Code's auto-memory folder for the project, and any folders you add with `extraFolders`.
- A note is known by its file name, its frontmatter `name` and `description`, and its line in an index such as `MEMORY.md` or `INDEX.md`: a list item that opens with a link to it.
- A prompt must share at least two words with a note. A word that many notes hold counts for less.
- Accents fold away and a shared stem counts, so "şarkı" matches "sarki" and "compaction" matches "compact".
- Pasted text and code blocks are left out of the match.
- At most two notes go out per prompt, and each note once per session. `/clear` starts over.

## Extra folders

Add folders of Markdown notes in `/config` (the `extraFolders` option), comma-separated, or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "recall-cue@claude-code-mods": {
    "options": { "extraFolders": "~/notes, ~/work/docs" }
  }
}
```

The option is empty by default, so only auto-memory is read. Folders are read with their subfolders. A folder whose name starts with a dot, such as `.obsidian`, is skipped, and a linked folder is not entered.

## Limits

- It matches words, not meaning. A prompt that says the same thing in other words gets no hint. A prompt that shares two rare words with an unrelated note can get a wrong one; the model is told to skip it.
- Only prompts you type get a hint: in the terminal, over Remote Control, in the desktop app and in `claude -p`. Slash commands, hidden prompts and other plugins' prompts get none.
- It makes no model calls. Each prompt lists the folders again, and reads again only the files that changed. It reads at most 2,000 files.
- When auto-memory is off, it stops looking for the memory folder after three prompts.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install recall-cue@claude-code-mods
```

Restart Claude Code.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh recall-cue
```
