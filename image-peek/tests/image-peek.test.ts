import { expect, test } from 'claude-code/testing'

import { fit, imageTags, pngSize } from '../hooks/register'

// The 24-byte head of a 1600×900 PNG: signature, IHDR length and type, width, height.
const HEAD = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x06, 0x40, 0, 0, 0x03, 0x84))

test('tags are read once each, in order', () => {
  expect(imageTags('see [Image #3] and [Image #1], again [Image #3]')).toEqual([3, 1])
  expect(imageTags('no images')).toEqual([])
})

test('the PNG header gives the size, anything else nothing', () => {
  expect(pngSize(HEAD)).toEqual({ width: 1600, height: 900 })
  expect(pngSize(btoa('GIF89a, not a png at all, really'))).toBeUndefined()
})

test('a picture keeps its shape inside the box', () => {
  // Wide: limited by the columns.
  expect(fit({ width: 1600, height: 900 }, 40, 20)).toEqual({ columns: 40, rows: 11 })
  // Tall: limited by the rows.
  expect(fit({ width: 900, height: 1600 }, 40, 10)).toEqual({ columns: 11, rows: 10 })
})

