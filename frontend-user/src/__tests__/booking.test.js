/**
 * 球桌预约领域逻辑单元测试
 *
 * 测试范围：
 * - 日期与时段范围检查（营业时间、过期、未来 7 天）
 * - 冲突条件（同球桌同日期时间相交）
 * - 球桌 / 时段占用判定（有效预约记录 + 模拟占用）
 * - 时长可行性与提交前完整校验
 */

import { describe, it, expect } from 'vitest'
import {
  OPEN_HOUR,
  CLOSE_HOUR,
  MAX_ADVANCE_DAYS,
  MIN_DURATION_HOURS,
  MAX_DURATION_HOURS,
  BASE_TABLES,
  todayStr,
  addDaysStr,
  maxBookingDateStr,
  isValidDateStr,
  timeToMinutes,
  minutesToTime,
  parseTimeRange,
  getSlotLabel,
  getRangeForSlot,
  isWithinBusinessHours,
  isPastDateTime,
  bookingRangeFromTask,
  isActiveBookingTask,
  rangesOverlap,
  findBookingConflict,
  getSimulatedBlockedBlocks,
  getOccupiedBlocks,
  getSlotAvailability,
  getDurationAvailability,
  getTableAvailability,
  validateBookingRequest
} from '../utils/booking'

// 固定当前时刻，避免测试随时间漂移
const NOW = new Date('2026-05-10T12:30:00')
const TODAY = '2026-05-10'
const TOMORROW = '2026-05-11'
const TABLE1 = BASE_TABLES[0] // 1号球桌，运营中
const TABLE2 = BASE_TABLES[1] // 2号球桌，维护中

function makeBooking(overrides = {}) {
  return {
    taskId: 'T1',
    tableId: 1,
    date: TOMORROW,
    startMin: 14 * 60,
    endMin: 16 * 60,
    ...overrides
  }
}

function makeTask(overrides = {}) {
  return {
    id: 'T1',
    type: 'booking',
    status: 'upcoming',
    extra: { tableId: 1, date: TOMORROW, time: '14:00 - 16:00', duration: 2 },
    ...overrides
  }
}

describe('booking date/time utils', () => {
  it('formats today in local timezone', () => {
    expect(todayStr(NOW)).toBe(TODAY)
  })

  it('computes max booking date as N days ahead', () => {
    expect(maxBookingDateStr(NOW)).toBe(addDaysStr(TODAY, MAX_ADVANCE_DAYS))
  })

  it('validates date strings including impossible calendar dates', () => {
    expect(isValidDateStr(TODAY)).toBe(true)
    expect(isValidDateStr('2026-13-01')).toBe(false)
    expect(isValidDateStr('2026-02-30')).toBe(false)
    expect(isValidDateStr('abc')).toBe(false)
  })

  it('converts time and minutes both ways', () => {
    expect(timeToMinutes('10:00')).toBe(600)
    expect(minutesToTime(1260)).toBe('21:00')
  })

  it('parses time ranges with and without spaces', () => {
    expect(parseTimeRange('14:00 - 16:00')).toEqual({ start: '14:00', end: '16:00' })
    expect(parseTimeRange('14:00-16:00')).toEqual({ start: '14:00', end: '16:00' })
    expect(parseTimeRange('bad')).toBeNull()
  })

  it('builds slot range from slot id and duration', () => {
    const range = getRangeForSlot(3, 4)
    expect(range.start).toBe('14:00')
    expect(range.end).toBe('18:00')
    expect(range.startMin).toBe(840)
    expect(getSlotLabel(3)).toBe('14:00 - 16:00')
  })

  it('checks business hours boundary', () => {
    expect(isWithinBusinessHours(OPEN_HOUR * 60, CLOSE_HOUR * 60)).toBe(true)
    expect(isWithinBusinessHours(20 * 60, 22 * 60 + 60)).toBe(false) // 超出闭店时间
    expect(isWithinBusinessHours(9 * 60, 10 * 60)).toBe(false) // 早于开店
  })

  it('treats earlier today slots as past and future dates as open', () => {
    expect(isPastDateTime(TODAY, 11 * 60, NOW)).toBe(true) // 11:00 已过（当前 12:30）
    expect(isPastDateTime(TODAY, 13 * 60, NOW)).toBe(false) // 13:00 未到
    expect(isPastDateTime('2026-05-09', 20 * 60, NOW)).toBe(true)
    expect(isPastDateTime(TOMORROW, 9 * 60, NOW)).toBe(false)
  })
})

describe('booking task normalization', () => {
  it('normalizes an active booking task into a range', () => {
    const range = bookingRangeFromTask(makeTask())
    expect(range).toMatchObject({ tableId: 1, date: TOMORROW, startMin: 840, endMin: 960 })
  })

  it('derives end time from label when duration missing (legacy data)', () => {
    const task = makeTask({ extra: { tableId: 3, date: TOMORROW, time: '18:00 - 20:00' } })
    const range = bookingRangeFromTask(task)
    expect(range.endMin).toBe(20 * 60)
  })

  it('returns null for malformed tasks', () => {
    expect(bookingRangeFromTask(makeTask({ extra: { date: 'bad' } }))).toBeNull()
  })

  it('recognizes active booking statuses', () => {
    expect(isActiveBookingTask(makeTask({ status: 'pending_payment' }))).toBe(true)
    expect(isActiveBookingTask(makeTask({ status: 'upcoming' }))).toBe(true)
    expect(isActiveBookingTask(makeTask({ status: 'ongoing' }))).toBe(true)
    expect(isActiveBookingTask(makeTask({ status: 'cancelled' }))).toBe(false)
    expect(isActiveBookingTask(makeTask({ status: 'completed' }))).toBe(false)
    expect(isActiveBookingTask({ type: 'course' })).toBe(false)
  })
})

describe('conflict detection', () => {
  it('detects overlapping ranges on same table/date', () => {
    const a = makeBooking()
    expect(rangesOverlap(a, makeBooking({ startMin: 15 * 60, endMin: 17 * 60 }))).toBe(true)
    // 端点相接（16:00 结束 / 16:00 开始）不算冲突
    expect(rangesOverlap(a, makeBooking({ startMin: 16 * 60, endMin: 17 * 60 }))).toBe(false)
    // 不同球桌 / 不同日期不冲突
    expect(rangesOverlap(a, makeBooking({ tableId: 2 }))).toBe(false)
    expect(rangesOverlap(a, makeBooking({ date: '2026-05-12' }))).toBe(false)
  })

  it('finds a conflicting active booking and can exclude self', () => {
    const active = [makeBooking({ taskId: 'A' }), makeBooking({ taskId: 'B', tableId: 3 })]
    const request = makeBooking({ taskId: undefined, startMin: 15 * 60, endMin: 17 * 60 })
    expect(findBookingConflict(request, active)?.taskId).toBe('A')
    expect(findBookingConflict(request, active, 'A')).toBeNull()
  })
})

describe('occupancy', () => {
  it('produces deterministic simulated blocks for same table/date', () => {
    const first = getSimulatedBlockedBlocks(1, TOMORROW)
    const second = getSimulatedBlockedBlocks(1, TOMORROW)
    expect(first).toEqual(second)
    expect(getSimulatedBlockedBlocks(1, '2026-05-12')).not.toEqual(first)
  })

  it('merges user bookings into occupied blocks', () => {
    const blocks = getOccupiedBlocks(1, TOMORROW, [makeBooking()])
    expect(blocks.has(14 * 60)).toBe(true)
    expect(blocks.has(15 * 60)).toBe(true)
  })

  it('marks maintenance tables unavailable for every slot', () => {
    const state = getSlotAvailability(1, TABLE2, TOMORROW, [], NOW)
    expect(state.available).toBe(false)
    expect(state.reason).toBe('maintenance')
  })

  it('marks past slots as ended', () => {
    const state = getSlotAvailability(1, TABLE1, TODAY, [], NOW) // 10:00 已过
    expect(state.available).toBe(false)
    expect(state.reason).toBe('past')
  })

  it('marks slots occupied by user bookings as booked', () => {
    const active = [makeBooking()] // 14:00-16:00
    const state = getSlotAvailability(3, TABLE1, TOMORROW, active, NOW)
    expect(state.available).toBe(false)
    expect(state.reason).toBe('conflict')
  })

  it('reports a free slot when nothing occupies it', () => {
    // 找一个确定不被模拟占用的未来日期 + 时段组合（遍历直到命中）
    let found = null
    for (let i = 1; i <= 14 && !found; i++) {
      const date = addDaysStr(TODAY, i)
      for (let slotId = 1; slotId <= 6; slotId++) {
        const state = getSlotAvailability(slotId, TABLE1, date, [], NOW)
        if (state.available) {
          found = { date, slotId }
          break
        }
      }
    }
    expect(found).not.toBeNull()
  })

  it('rejects a duration crossing closing time', () => {
    // 20:00 开始约 4 小时 -> 24:00，超出 22:00
    const result = getDurationAvailability(6, 4, TABLE1, TOMORROW, [], NOW)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('hours')
  })

  it('rejects a duration overlapping an occupied block', () => {
    const active = [makeBooking({ startMin: 15 * 60, endMin: 16 * 60 })]
    // 14:00 开始约 2 小时会撞上 15:00 的占用
    const result = getDurationAvailability(3, 2, TABLE1, TOMORROW, active, NOW)
    expect(result.valid).toBe(false)
    expect(['conflict', 'occupied']).toContain(result.reason)
  })

  it('accepts a duration fully within free blocks and business hours', () => {
    // 构造无任何模拟占用的日期不现实，改用确定空闲组合遍历
    let accepted = false
    for (let i = 1; i <= 14 && !accepted; i++) {
      const date = addDaysStr(TODAY, i)
      for (let slotId = 1; slotId <= 6; slotId++) {
        if (getDurationAvailability(slotId, 1, TABLE1, date, [], NOW).valid) {
          accepted = true
          break
        }
      }
    }
    expect(accepted).toBe(true)
  })

  it('keeps maintenance tables unavailable for the whole date', () => {
    expect(getTableAvailability(TABLE2, TOMORROW, [], NOW).available).toBe(false)
  })
})

describe('validateBookingRequest', () => {
  const validInput = { table: TABLE1, date: TOMORROW, slotId: 3, duration: 2 }

  it('accepts a valid request', () => {
    // 找到一个确定可行的组合（避开模拟占用）
    let valid = null
    for (let i = 1; i <= 14 && !valid; i++) {
      const date = addDaysStr(TODAY, i)
      for (let slotId = 1; slotId <= 6; slotId++) {
        const candidate = { table: TABLE1, date, slotId, duration: 1 }
        if (validateBookingRequest(candidate, [], NOW).valid) {
          valid = candidate
          break
        }
      }
    }
    expect(valid).not.toBeNull()
    const result = validateBookingRequest(valid, [], NOW)
    expect(result.valid).toBe(true)
    expect(result.request).toMatchObject({ tableId: 1, date: valid.date })
    expect(result.request.endMin - result.request.startMin).toBe(60)
  })

  it('rejects unknown and maintenance tables', () => {
    expect(validateBookingRequest({ tableId: 999, date: TOMORROW, slotId: 1, duration: 1 }, [], NOW).valid).toBe(false)
    expect(validateBookingRequest({ table: TABLE2, date: TOMORROW, slotId: 1, duration: 1 }, [], NOW).error).toMatch(
      /维护/
    )
  })

  it('rejects invalid, past and out-of-range dates', () => {
    expect(validateBookingRequest({ ...validInput, date: 'bad' }, [], NOW).error).toMatch(/日期无效/)
    expect(validateBookingRequest({ ...validInput, date: '2026-05-01' }, [], NOW).error).toMatch(/失效/)
    expect(
      validateBookingRequest({ ...validInput, date: addDaysStr(TODAY, MAX_ADVANCE_DAYS + 1) }, [], NOW).error
    ).toMatch(/7 天/)
  })

  it('rejects invalid duration and slot', () => {
    expect(validateBookingRequest({ ...validInput, duration: 0 }, [], NOW).error).toMatch(/时长/)
    expect(validateBookingRequest({ ...validInput, duration: 5 }, [], NOW).error).toMatch(/时长/)
    expect(validateBookingRequest({ ...validInput, slotId: 99 }, [], NOW).error).toMatch(/时段/)
  })

  it('rejects durations running past business hours', () => {
    const result = validateBookingRequest({ ...validInput, slotId: 6, duration: 4 }, [], NOW)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/营业时间/)
  })

  it('rejects a slot that already started today', () => {
    const result = validateBookingRequest({ ...validInput, date: TODAY, slotId: 1, duration: 1 }, [], NOW)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/已开始/)
  })

  it('rejects conflicting active bookings (duplicate submit / race)', () => {
    // 先找一个可行日期+时段，再人为放入同区间的有效预约
    let request = null
    for (let i = 1; i <= 14 && !request; i++) {
      const date = addDaysStr(TODAY, i)
      for (let slotId = 1; slotId <= 6; slotId++) {
        const candidate = { table: TABLE1, date, slotId, duration: 1 }
        if (validateBookingRequest(candidate, [], NOW).valid) {
          request = candidate
          break
        }
      }
    }
    expect(request).not.toBeNull()

    const range = getRangeForSlot(request.slotId, 1)
    const active = [makeBooking({ date: request.date, startMin: range.startMin, endMin: range.endMin, taskId: 'X' })]
    const result = validateBookingRequest(request, active, NOW)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/占用/)
  })

  it('ensures duration bounds constants stay within 1-4 hours', () => {
    expect(MIN_DURATION_HOURS).toBe(1)
    expect(MAX_DURATION_HOURS).toBe(4)
  })
})
