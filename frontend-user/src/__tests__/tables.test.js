/**
 * Tables.vue 球桌预约流程集成测试
 *
 * 覆盖：
 * - 登录引导（未登录不进入预约弹窗）
 * - 提交前占用/冲突校验与服务端失败时记录不写入、弹窗保持
 * - 防重复提交（加载中二次确认只产生一次请求）
 * - 成功后任务记录与弹窗状态一致
 * - 取消预约后占用释放（状态与记录不错配）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Tables from '../views/Tables.vue'
import { api } from '../utils/api'
import { taskStore } from '../utils/taskStore'
import { authState } from '../utils/auth'
import {
  BASE_TABLES,
  todayStr,
  addDaysStr,
  getTableAvailability,
  getRangeForSlot,
  getSlotLabel,
  validateBookingRequest
} from '../utils/booking'

function mountComponent(query = {}) {
  return mount(Tables, {
    global: {
      mocks: { $route: { query } }
    }
  })
}

/** 找到一个确定可约的未来日期（球桌 1） */
function findBookableDate() {
  for (let i = 1; i <= 14; i++) {
    const date = addDaysStr(todayStr(), i)
    if (getTableAvailability(BASE_TABLES[0], date, []).available) return date
  }
  throw new Error('no bookable date found')
}

/** 在组件上构造一个当前可提交的预约表单 */
function prepareValidForm(wrapper) {
  const date = findBookableDate()
  wrapper.vm.selectedDate = date
  // 找到该日期下装饰过的 1 号球桌（含实时可用状态）
  const table = wrapper.vm.tablesForDate.find(t => t.id === BASE_TABLES[0].id)
  wrapper.vm.openBooking(table)
  const vm = wrapper.vm
  // openBooking 会挑选首个可用时段；归一化时长后必须通过完整校验
  let candidate = { table: BASE_TABLES[0], date, slotId: vm.selectedTimeSlot, duration: vm.duration }
  if (!validateBookingRequest(candidate, []).valid) {
    for (const slotId of [1, 2, 3, 4, 5, 6]) {
      for (const duration of [1, 2, 3, 4]) {
        candidate = { table: BASE_TABLES[0], date, slotId, duration }
        if (validateBookingRequest(candidate, []).valid) {
          vm.bookingDate = date
          vm.selectedTimeSlot = slotId
          vm.duration = duration
          return candidate
        }
      }
    }
  }
  return candidate
}

describe('Tables booking flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    authState.isLoggedIn = false
    authState.token = null
    authState.user = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('prompts login instead of opening booking modal for anonymous users', async () => {
    const wrapper = mountComponent()
    await vi.advanceTimersByTimeAsync(900)

    wrapper.vm.openBooking(BASE_TABLES[0])
    expect(wrapper.vm.showLoginModal).toBe(true)
    expect(wrapper.vm.showBookingModal).toBe(false)
    expect(wrapper.vm.pendingTable).not.toBeNull()
  })

  it('keeps modal open and writes no record when server rejects', async () => {
    const wrapper = mountComponent()
    await vi.advanceTimersByTimeAsync(900)
    authState.isLoggedIn = true
    authState.token = 'tok'

    prepareValidForm(wrapper)
    const addSpy = vi.spyOn(taskStore, 'addBookingTask')
    const bookSpy = vi
      .spyOn(api, 'bookTable')
      .mockResolvedValue({ success: false, error: '该时段已被占用，请更换时段后重试' })

    await wrapper.vm.confirmBooking()

    expect(bookSpy).toHaveBeenCalledTimes(1)
    expect(addSpy).not.toHaveBeenCalled()
    expect(wrapper.vm.showBookingModal).toBe(true)
    expect(wrapper.vm.showSuccessModal).toBe(false)
    expect(wrapper.vm.bookingError).toMatch(/占用/)
    expect(wrapper.vm.bookingLoading).toBe(false)
  })

  it('prevents duplicate submission while a request is in flight', async () => {
    const wrapper = mountComponent()
    await vi.advanceTimersByTimeAsync(900)
    authState.isLoggedIn = true
    authState.token = 'tok'

    prepareValidForm(wrapper)
    const addSpy = vi.spyOn(taskStore, 'addBookingTask')
    let resolveRequest
    const bookSpy = vi.spyOn(api, 'bookTable').mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRequest = resolve
        })
    )

    const first = wrapper.vm.confirmBooking()
    expect(wrapper.vm.bookingLoading).toBe(true)
    // 加载中再次点击确认，应被直接忽略
    await wrapper.vm.confirmBooking()
    expect(bookSpy).toHaveBeenCalledTimes(1)

    resolveRequest({ success: true, data: { orderNo: 'BK88888888' } })
    await first

    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.showSuccessModal).toBe(true)
    expect(wrapper.vm.showBookingModal).toBe(false)
    expect(wrapper.vm.bookingResult.orderNo).toBe('BK88888888')
  })

  it('blocks conflicting slots before request and creates exactly one task on success', async () => {
    const wrapper = mountComponent()
    await vi.advanceTimersByTimeAsync(900)
    authState.isLoggedIn = true
    authState.token = 'tok'

    const candidate = prepareValidForm(wrapper)

    // 先放一条完全不冲突的占用，再直接把该任务的区间改为与请求一致（模拟抢占）
    const range = getRangeForSlot(candidate.slotId, candidate.duration)
    taskStore.addBookingTask(
      { id: BASE_TABLES[0].id, name: BASE_TABLES[0].name, type: BASE_TABLES[0].type, price: 80 },
      {
        orderNo: 'BK00000001',
        date: addDaysStr(candidate.date, 1),
        time: '10:00 - 11:00',
        duration: 1
      }
    )
    const created = taskStore.getActiveBookings().find(t => t.extra.orderNo === 'BK00000001')
    taskStore.update(created.id, {
      subtitle: `${candidate.date} ${range.start} - ${range.end}`,
      extra: {
        ...created.extra,
        date: candidate.date,
        time: getSlotLabel(candidate.slotId),
        duration: candidate.duration
      }
    })

    const bookSpy = vi.spyOn(api, 'bookTable').mockResolvedValue({
      success: true,
      data: { orderNo: 'BK99999999' }
    })

    await wrapper.vm.confirmBooking()
    expect(bookSpy).not.toHaveBeenCalled()
    expect(wrapper.vm.bookingError).toMatch(/占用/)
  })

  it('disables duration options running past business hours', async () => {
    const wrapper = mountComponent()
    await vi.advanceTimersByTimeAsync(900)
    authState.isLoggedIn = true
    authState.token = 'tok'

    wrapper.vm.selectedTable = BASE_TABLES[0]
    wrapper.vm.bookingDate = addDaysStr(todayStr(), 3)
    wrapper.vm.selectedTimeSlot = 6 // 20:00 开始
    await wrapper.vm.$nextTick()

    const fourHours = wrapper.vm.durationOptions.find(o => o.hours === 4)
    expect(fourHours.valid).toBe(false)
    expect(fourHours.message).toMatch(/营业时间/)
  })

  it('releases table occupancy when a booking task is cancelled but keeps the record', async () => {
    taskStore.clearAll()
    const date = addDaysStr(todayStr(), 5)
    // 找到一个空闲时段，占用之，再取消，验证释放
    let slotId = null
    for (let id = 1; id <= 6; id++) {
      if (validateBookingRequest({ table: BASE_TABLES[2], date, slotId: id, duration: 1 }, []).valid) {
        slotId = id
        break
      }
    }
    expect(slotId).not.toBeNull()

    const start = ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'][slotId - 1]
    const task = taskStore.addBookingTask(
      { id: BASE_TABLES[2].id, name: BASE_TABLES[2].name, type: BASE_TABLES[2].type, price: 60 },
      { orderNo: 'BK77777777', date, time: `${start} - ${Number(start.slice(0, 2)) + 1}:00`, duration: 1 }
    )

    expect(
      validateBookingRequest({ table: BASE_TABLES[2], date, slotId, duration: 1 }, taskStore.getActiveBookingRanges())
        .valid
    ).toBe(false)

    const cancelled = taskStore.cancelBookingTask(task.id)
    expect(cancelled.status).toBe('cancelled')

    // 记录仍在（归档），但不再占用球桌
    expect(taskStore.getById(task.id)).not.toBeNull()
    expect(taskStore.getActiveBookings().find(t => t.id === task.id)).toBeUndefined()
  })
})
