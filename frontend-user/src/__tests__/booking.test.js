/**
 * 球桌预约领域模块单元测试
 *
 * 测试范围：
 * - 日期 / 时段范围校验
 * - 占用判定与时间区间冲突
 * - 预约成功后状态与记录一致
 * - 重复提交拦截、二次校验拦截并发冲突
 * - 取消预约后占用释放
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BOOKING_DAYS,
  BookingError,
  todayStr,
  maxDateStr,
  formatDate,
  isValidDateStr,
  parseRange,
  rangesOverlap,
  getSlotState,
  isTableAvailableOn,
  findFirstAvailableSlot,
  validateBooking,
  createBooking,
  getActiveBookings
} from '../utils/booking'
import { taskStore } from '../utils/taskStore'

// ==================== Mock 设置 ====================

const localStorageMock = {
  store: {},
  getItem: vi.fn(key => (key in localStorageMock.store ? localStorageMock.store[key] : null)),
  setItem: vi.fn((key, value) => { localStorageMock.store[key] = String(value) }),
  removeItem: vi.fn(key => { delete localStorageMock.store[key] }),
  clear: vi.fn(() => { localStorageMock.store = {} })
}
Object.defineProperty(global, 'window', {
  value: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  },
  configurable: true
})
Object.defineProperty(global, 'localStorage', { value: localStorageMock, configurable: true })

// 未来日期工具
const futureDateStr = offset => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return formatDate(d)
}

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
})

describe('Booking domain - date helpers', () => {
  it('validates yyyy-MM-dd strings strictly', () => {
    expect(isValidDateStr(todayStr())).toBe(true)
    expect(isValidDateStr('2026-02-30')).toBe(false)
    expect(isValidDateStr('not-a-date')).toBe(false)
    expect(isValidDateStr('')).toBe(false)
  })

  it('exposes a booking window of BOOKING_DAYS days including today', () => {
    expect(maxDateStr()).toBe(futureDateStr(BOOKING_DAYS - 1))
  })

  it('parses legacy time ranges and detects overlaps', () => {
    expect(parseRange({ time: '14:00 - 16:00' })).toEqual({ start: 840, end: 960 })
    expect(parseRange({ startHour: 18, endHour: 20 })).toEqual({ start: 1080, end: 1200 })
    // 相邻区间不冲突
    expect(rangesOverlap({ start: 840, end: 960 }, { start: 960, end: 1080 })).toBe(false)
    // 相交区间冲突
    expect(rangesOverlap({ start: 840, end: 960 }, { start: 900, end: 1020 })).toBe(true)
  })
})

describe('Booking domain - slot validation', () => {
  it('rejects expired slots for today', () => {
    // 营业第一槽 10:00：若当前已过 10 点则必为失效；未到 10 点则可约
    const state = getSlotState(1, todayStr(), 10, 1)
    const now = new Date()
    if (now.getHours() >= 10) {
      expect(state.available).toBe(false)
      expect(state.reason).toBe('expired')
    } else {
      expect(state.available).toBe(true)
    }
  })

  it('rejects durations running past closing time', () => {
    const date = futureDateStr(1)
    // 20:00 开始，4 小时 -> 24:00 超出 22:00 营业结束
    const state = getSlotState(1, date, 20, 4)
    expect(state.available).toBe(false)
    expect(state.reason).toBe('out_of_hours')
  })

  it('rejects dates outside the booking window', () => {
    const state = getSlotState(1, futureDateStr(BOOKING_DAYS + 2), 10, 1)
    expect(state.available).toBe(false)
    expect(state.reason).toBe('date_out_of_range')
  })

  it('marks disabled (maintenance) tables unavailable on every date', () => {
    const date = futureDateStr(1)
    expect(getSlotState(2, date, 10, 1).reason).toBe('table_disabled')
    expect(isTableAvailableOn(2, date)).toBe(false)
    expect(isTableAvailableOn(5, date)).toBe(false)
  })

  it('keeps enabled tables with free slots available', () => {
    const date = futureDateStr(1)
    expect(getSlotState(1, date, 10, 2).available).toBe(true)
    expect(isTableAvailableOn(1, date)).toBe(true)
  })
})

describe('Booking domain - occupancy from records', () => {
  it('marks a slot occupied after a booking record exists', async () => {
    const date = futureDateStr(2)
    const first = await createBooking({
      tableId: 1, date, startHour: 14, duration: 2, isLoggedIn: true
    })
    expect(first.success).toBe(true)

    // 同一时段 14:00-16:00 冲突
    expect(getSlotState(1, date, 14, 2).reason).toBe('occupied')
    // 部分重叠 15:00 不可选（时段按钮以固定 2h 槽位提供，15 点不是合法槽位）
    // 相邻 16:00 开始仍可约
    expect(getSlotState(1, date, 16, 2).available).toBe(true)
    // 别的球桌不受影响
    expect(getSlotState(3, date, 14, 2).available).toBe(true)
    // 卡片级：1 号桌当天仍有其他时段，可约
    expect(isTableAvailableOn(1, date)).toBe(true)
  })

  it('fills table card as occupied when every slot is taken', async () => {
    const date = futureDateStr(3)
    // 每张球桌每天 10-22，共 6 个 2h 槽位，全部占用
    for (const hour of [10, 12, 14, 16, 18, 20]) {
      const r = await createBooking({ tableId: 4, date, startHour: hour, duration: 2, isLoggedIn: true })
      expect(r.success).toBe(true)
    }
    expect(isTableAvailableOn(4, date)).toBe(false)
    expect(findFirstAvailableSlot(4, date, 2)).toBeNull()
  }, 15000)

  it('releases occupancy when the booking task is cancelled', async () => {
    const date = futureDateStr(4)
    const r = await createBooking({ tableId: 6, date, startHour: 10, duration: 2, isLoggedIn: true })
    expect(r.success).toBe(true)
    expect(getSlotState(6, date, 10, 2).reason).toBe('occupied')

    const cancelled = taskStore.cancel(r.data.taskId)
    expect(cancelled).not.toBeNull()
    expect(cancelled.status).toBe('cancelled')

    // 已取消记录不再占桌
    expect(getSlotState(6, date, 10, 2).available).toBe(true)
    expect(getActiveBookings().find(t => t.id === r.data.taskId)).toBeUndefined()
  })

  it('still occupies while pending payment (consistent with task center)', async () => {
    const date = futureDateStr(5)
    await createBooking({ tableId: 1, date, startHour: 18, duration: 2, isLoggedIn: true })
    const task = getActiveBookings().find(t => t.extra?.date === date && t.extra?.tableId === 1)
    expect(task.status).toBe('pending_payment')
    expect(getSlotState(1, date, 18, 2).reason).toBe('occupied')
  })
})

describe('Booking domain - validateBooking', () => {
  it('requires login', () => {
    expect(() =>
      validateBooking({ tableId: 1, date: futureDateStr(1), startHour: 10, duration: 1, isLoggedIn: false })
    ).toThrowError(/登录/)
  })

  it('throws coded errors for occupied slots', () => {
    const date = futureDateStr(2)
    // 预置一条占用记录
    taskStore.addBookingTask(
      { id: 3, name: '3号球桌', type: '美式九球', price: 60 },
      { orderNo: 'BK1', date, time: '10:00 - 12:00', startHour: 10, endHour: 12, duration: 2 }
    )
    try {
      validateBooking({ tableId: 3, date, startHour: 10, duration: 2, isLoggedIn: true })
      throw new Error('should not reach')
    } catch (e) {
      expect(e.code).toBe(BookingError.SLOT_OCCUPIED)
      expect(e.conflict).toBeTruthy()
    }
  })

  it('accepts a valid booking', () => {
    expect(
      validateBooking({ tableId: 1, date: futureDateStr(1), startHour: 10, duration: 2, isLoggedIn: true })
    ).toBe(true)
  })
})

describe('Booking domain - createBooking', () => {
  it('creates record only on success and returns order data', async () => {
    const date = futureDateStr(1)
    const before = getActiveBookings().length
    const r = await createBooking({ tableId: 1, date, startHour: 12, duration: 1, isLoggedIn: true })
    expect(r.success).toBe(true)
    expect(r.data.orderNo).toMatch(/^BK\d+$/)
    expect(r.data.time).toBe('12:00 - 13:00')
    expect(getActiveBookings().length).toBe(before + 1)
  })

  it('rejects duplicate concurrent submissions for the same table/date/slot', async () => {
    const date = futureDateStr(1)
    const payload = { tableId: 1, date, startHour: 14, duration: 2, isLoggedIn: true }
    const p1 = createBooking(payload)
    const p2 = createBooking(payload)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(false)
    expect(r2.code).toBe(BookingError.DUPLICATE_SUBMISSION)
    // 只产生一条记录
    const sameSlot = getActiveBookings().filter(
      t => t.extra?.tableId === 1 && t.extra?.date === date && t.extra?.startHour === 14
    )
    expect(sameSlot.length).toBe(1)
  })

  it('fails validation without writing any record', async () => {
    const before = getActiveBookings().length
    const r = await createBooking({
      tableId: 2, // 维护中
      date: futureDateStr(1),
      startHour: 10,
      duration: 1,
      isLoggedIn: true
    })
    expect(r.success).toBe(false)
    expect(getActiveBookings().length).toBe(before)
  })

  it('catches conflicts introduced while the request is in flight', async () => {
    const date = futureDateStr(2)
    // 先占位一条记录，再发起请求：提交时二次校验应拦截
    taskStore.addBookingTask(
      { id: 4, name: '4号球桌', type: '美式九球', price: 60 },
      { orderNo: 'BKX', date, time: '16:00 - 18:00', startHour: 16, endHour: 18, duration: 2 }
    )
    const r = await createBooking({ tableId: 4, date, startHour: 16, duration: 2, isLoggedIn: true })
    expect(r.success).toBe(false)
    expect(r.code).toBe(BookingError.SLOT_OCCUPIED)
  })
})
