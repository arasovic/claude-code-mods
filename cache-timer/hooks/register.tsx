import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

type Ttl = '5m' | '1h'
const TTL_MS: Record<Ttl, number> = { '5m': 300_000, '1h': 3_600_000 }
const isTtl = (v: unknown): v is Ttl => v === '5m' || v === '1h'
const isOn = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v ?? '').toLowerCase())

type TtlInputs = { force5m: boolean; envTtl?: string; settingTtl?: unknown; enable1h: boolean; subscribed: boolean; overLimit: boolean }

// The engine's own order as of 2.1.288; the mod API does not expose the TTL it picked.
export function cacheTtl(o: TtlInputs): Ttl {
  if (o.force5m) return '5m'
  if (isTtl(o.envTtl)) return o.envTtl
  if (isTtl(o.settingTtl)) return o.settingTtl
  if (o.enable1h) return '1h'
  return o.subscribed && !o.overLimit ? '1h' : '5m'
}

// ponytail: "over a limit" stands in for the engine's overage flag, which no mod can read.
export function limitState(limits: readonly SessionRateLimit[]) {
  const windows = limits.filter(l => l.kind === 'five_hour' || l.kind === 'seven_day')
  return { subscribed: windows.length > 0, overLimit: windows.some(l => l.percentUsed >= 100) }
}

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

export function statusText(now: number, requestAt: number | undefined, ttl: Ttl, context: number): string | undefined {
  if (requestAt === undefined) return undefined
  const left = requestAt + TTL_MS[ttl] - now
  if (left <= 0) return `🔴 cache cold · next message re-writes ${tokens(context)} tokens`
  const secs = Math.ceil(left / 1000)
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  return left <= TTL_MS[ttl] / 5 ? `🟡 cache ${clock} · send soon` : `🟢 cache ${clock}`
}

const inputs: TtlInputs = { force5m: false, enable1h: false, subscribed: false, overLimit: false }
let requestAt: number | undefined
let context = 0
let shown: string | undefined

async function tick($: EngineInterface) {
  const text = statusText(await $.clock.now(), requestAt, cacheTtl(inputs), context)
  if (text !== shown) {
    shown = text
    $.ui.invalidate('ui.render')
  }
}

async function start($: EngineInterface) {
  inputs.force5m = isOn(await $.env.get('FORCE_PROMPT_CACHING_5M'))
  inputs.envTtl = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')
  inputs.enable1h = isOn(await $.env.get('ENABLE_PROMPT_CACHING_1H'))
  inputs.settingTtl = (await $.settings.read()).promptCacheTtl
  // A version that drew a status row may have left it behind on reload.
  $.ui.status(undefined)
  // A timer started inside a turn.step dispatch dies with it; session.start's runs until the module reloads.
  $.clock.every(1000, () => void tick($))
}

async function forget($: EngineInterface) {
  requestAt = undefined
  await tick($)
}

export const register: Register = on => {
  on('turn.step', async function* ($, e, next) {
    // A subagent's requests carry their own prefix; only the main thread's keep its cache alive.
    if (e.agentId !== undefined) return yield* next(e)
    // The cache entry is refreshed when the request is served, so the clock starts before the reply streams.
    const at = await $.clock.now()
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      requestAt = at
      context = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    Object.assign(inputs, limitState(e.rateLimits))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is shared: other plugins (next-steps) draw beneath this hook, so keep what they drew.
    const below = await next(e)
    if (e.props.hasSurvey || shown === undefined) return below
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Text>{shown}</Text>
      </Box>
    )
  })

  on('session.start', async ($, e, next) => (await start($), next(e)))

  // After /clear, /resume or a compaction the next request writes a new prefix whatever the clock says.
  on('session.end', async ($, e, next) => (await forget($), next(e)))
  on('session.compact', async ($, e, next) => (await forget($), next(e)))
}
