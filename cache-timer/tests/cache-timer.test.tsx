import { expect, mock, test } from 'claude-code/testing'

import { cacheTtl, limitState, statusText } from '../hooks/register'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const base = { force5m: false, enable1h: false, subscribed: false, overLimit: false }

test('the TTL follows the engine order', () => {
  expect(cacheTtl(base)).toBe('5m')
  expect(cacheTtl({ ...base, subscribed: true })).toBe('1h')
  expect(cacheTtl({ ...base, subscribed: true, overLimit: true })).toBe('5m')
  expect(cacheTtl({ ...base, enable1h: true })).toBe('1h')
  expect(cacheTtl({ ...base, subscribed: true, settingTtl: '5m' })).toBe('5m')
  expect(cacheTtl({ ...base, settingTtl: '5m', envTtl: '1h' })).toBe('1h')
  expect(cacheTtl({ ...base, envTtl: '1h', force5m: true })).toBe('5m')
  expect(cacheTtl({ ...base, subscribed: true, envTtl: 'bogus' })).toBe('1h')
})

test('only the subscription windows count as a subscription', () => {
  expect(limitState([{ kind: 'five_hour', percentUsed: 40 }])).toEqual({ subscribed: true, overLimit: false })
  expect(limitState([{ kind: 'seven_day', percentUsed: 100 }])).toEqual({ subscribed: true, overLimit: true })
  expect(limitState([{ kind: 'spend_limit', percentUsed: 120 }])).toEqual({ subscribed: false, overLimit: false })
})

test('the status counts down, warns near the end and goes cold', () => {
  expect(statusText(0, undefined, '5m', 0)).toBeUndefined()
  expect(statusText(1_000, 0, '1h', 50_000)).toBe('🟢 cache 59:59')
  expect(statusText(250_000, 0, '5m', 50_000)).toBe('🟡 cache 0:50 · send soon')
  expect(statusText(300_000, 0, '5m', 182_400)).toBe('🔴 cache cold · next message re-writes 182k tokens')
  expect(statusText(3_600_001, 0, '1h', 800)).toBe('🔴 cache cold · next message re-writes 800 tokens')
})

test('the band counts down from the last main-thread reply', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { FORCE_PROMPT_CACHING_5M: '1' })
  on('settings.read', () => ({ value: {} }))
  on('ui.status', () => ({ value: undefined }))
  // Another plugin's band (next-steps) beneath this one must stay drawn.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>next steps</Text>
  })
  const band = async () => {
    const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND })
    expect(await ui.find({ type: 'Text', text: 'next steps' })).toBeDefined()
    const text = (await ui.find({ type: 'Text', text: /cache/ }))?.text
    await ui.unmount()
    return text
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, model: 'm' }
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })

  await $.session.start({ cwd: '/x', surface: null, isInteractive: true })
  const step = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  while (!(await step.next()).done);

  await clock.advance(1000)
  expect(await band()).toBe('🟢 cache 4:59')
  await clock.advance(240_000)
  expect(await band()).toBe('🟡 cache 0:59 · send soon')
  await clock.advance(60_000)
  expect(await band()).toBe('🔴 cache cold · next message re-writes 1k tokens')
})
