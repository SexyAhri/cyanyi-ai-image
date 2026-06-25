import { describe, expect, it } from 'vitest'
import { applyPromptStyleLock, createAgentPromptStyleLockInstruction } from '../../lib/gallery/promptStyleLock'

describe('prompt style lock', () => {
  it('appends global consistency requirements when enabled', () => {
    const prompt = applyPromptStyleLock('生成一张老虎图片', {
      promptStyleLockEnabled: true,
      promptStyleLockText: '统一光影，统一商业插画质感。',
    })

    expect(prompt).toContain('生成一张老虎图片')
    expect(prompt).toContain('Global consistency requirements')
    expect(prompt).toContain('统一光影')
  })

  it('keeps the original prompt when disabled', () => {
    expect(applyPromptStyleLock('  生成一张老虎图片  ', {
      promptStyleLockEnabled: false,
      promptStyleLockText: '统一光影',
    })).toBe('生成一张老虎图片')
  })

  it('creates agent instructions only when enabled', () => {
    expect(createAgentPromptStyleLockInstruction({
      promptStyleLockEnabled: true,
      promptStyleLockText: '统一构图',
    })).toContain('统一构图')

    expect(createAgentPromptStyleLockInstruction({
      promptStyleLockEnabled: false,
      promptStyleLockText: '统一构图',
    })).toBe('')
  })
})
