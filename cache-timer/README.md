# cache-timer

Counts down to when the prompt cache expires, so you can send your next message while it is still warm.

![cache-timer's band above the prompt](../docs/cache-timer.png)

## Why it matters

Claude Code caches the start of the conversation. The next message reads that part from the cache, which costs a fraction of normal input. If you wait too long, the cache expires and the next message writes the whole conversation to the cache again, at a higher rate than normal input. In a long session that is a large one-time charge.

How long the cache lives depends on how you use Claude Code:

| You use | Cache lives | What an expired cache costs you |
| --- | --- | --- |
| An API key, Bedrock, Vertex or Foundry | 5 minutes | Money: the whole context billed at the cache-write rate |
| A Claude subscription, within its limits | 1 hour | No money; the re-write likely counts toward your 5-hour and 7-day windows |
| A Claude subscription past its limits (extra usage) | 5 minutes | Money, as with an API key |

So the timer helps most on 5 minutes, where a coffee break is enough to lose the cache. On a subscription it matters after long breaks, and for big contexts that eat into your limits.

## What it shows

A line just above the prompt, counting from the last request of the main conversation. It sits apart from the status lines under the prompt, so its tick every second does not shuffle them:

- 🟢 `cache 54:12`: the cache is warm.
- 🟡 `cache 0:48 · send soon`: less than a fifth of its life is left.
- 🔴 `cache cold · next message re-writes 182k tokens`: it has expired; the number is how much the next message caches again.

Subagent requests do not count; they do not keep the main conversation's cache alive. The line clears after `/clear` and `/compact`, since the next message writes a new cache either way.

## Limits

- Claude Code does not tell mods which lifetime it picked. The mod follows the engine's own order: `FORCE_PROMPT_CACHING_5M`, then `CLAUDE_CODE_PROMPT_CACHE_TTL`, then the `promptCacheTtl` setting, then `ENABLE_PROMPT_CACHING_1H`, then 1 hour on a subscription within its limits and 5 minutes otherwise. Until the first reply reports your limits it assumes 5 minutes.
- "Past its limits" is read as a 5-hour or 7-day window at 100%. The engine's own flag for extra usage is not visible to mods.
- Some accounts have a server-side feature that renews the cache while you are away. When it is on, the cache lives longer than the timer shows. A mod cannot see whether it is on.
- Switching models with `/model` drops the cache; the timer does not know until the next reply.
- After `claude --resume` the line stays empty until the first reply.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install cache-timer@claude-code-mods
```

Restart Claude Code. The timer appears above the prompt after the first reply.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh cache-timer
```
