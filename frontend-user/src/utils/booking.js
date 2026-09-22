/**
 * 球桌预约领域模块
 *
 * 职责（单一事实来源）：
 * - 球桌基础数据（类型、价格、是否维护）
 * - 营业时段、可选时长、可选日期范围
 * - 基于预约记录的占用判定与冲突检测（时间区间相交）
 * - 确认前的完整校验（登录、日期、时段、时长、占用、重复提交）
 * - 模拟“服务端”创建预约：提交时二次校验 + 幂等保护，成功后原子写入记录
 *
 * 预约记录统一存放于 taskStore（type === 'booking'），
 * 保证“球桌可用状态 / 时段状态 / 预约记录”三者永远一致：
 * 记录存在 -> 对应时段必然占用；记录取消 -> 占用立即释放。
 */

import { logger } from './api'
import { taskStore } from './taskStore'

// ==================== 常量定义 ====================

/** 每天营业开始小时 */
export const OPEN_HOUR = 10
/** 每天营业结束小时（最后一单必须在此之前结束） */
export const CLOSE_HOUR = 22
/** 可预约天数（含今天） */
export const BOOKING_DAYS = 7
/** 固定时段定义（id 即开始小时，时长 2 小时） */
export const TIME_SLOTS = [
  { id: 10, time: '10:00 - 12:00' },
  { id: 12, time: '12:00 - 14:00' },
  { id: 14, time: '14:00 - 16:00' },
  { id: 16, time: '16:00 - 18:00' },
  { id: 18, time: '18:00 - 20:00' },
  { id: 20, time: '20:00 - 22:00' }
]
/** 可选时长（小时） */
export const DURATIONS = [1, 2, 3, 4]

/**
 * 球桌基础数据
 * enabled=false 表示球桌维护中（非预约占用，任何日期都不可约）
 */
export const BASE_TABLES = [
  { id: 1, name: '1号球桌', type: '斯诺克', typeId: 'snooker', price: 80, enabled: true, size: '12尺', brand: '星牌' },
  { id: 2, name: '2号球桌', type: '斯诺克', typeId: 'snooker', price: 80, enabled: false, size: '12尺', brand: '星牌' },
  { id: 3, name: '3号球桌', type: '美式九球', typeId: 'pool', price: 60, enabled: true, size: '9尺', brand: 'Brunswick' },
  { id: 4, name: '4号球桌', type: '美式九球', typeId: 'pool', price: 60, enabled: true, size: '9尺', brand: 'Brunswick' },
  { id: 5, name: '5号球桌', type: '中式八球', typeId: 'chinese', price: 50, enabled: false, size: '9尺', brand: '乔氏' },
  { id: 6, name: '6号球桌', type: '中式八球', typeId: 'chinese', price: 50, enabled: true, size: '9尺', brand: '乔氏' }
]

/** 校验错误码 */
export const BookingError = {
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
  TABLE_DISABLED: 'TABLE_DISABLED',
  DATE_INVALID: 'DATE_INVALID',
  DATE_OUT_OF_RANGE: 'DATE_OUT_OF_RANGE',
  SLOT_INVALID: 'SLOT_INVALID',
  SLOT_EXPIRED: 'SLOT_EXPIRED',
  DURATION_INVALID: 'DURATION_INVALID',
  OUT_OF_BUSINESS_HOURS: 'OUT_OF_BUSINESS_HOURS',
  SLOT_OCCUPIED: 'SLOT_OCCUPIED',
  DUPLICATE_SUBMISSION: 'DUPLICATE_SUBMISSION'
}

const ERROR_MESSAGES = {
  [BookingError.NOT_LOGGED_IN]: '请先登录后再预约',
  [BookingError.TABLE_NOT_FOUND]: '球桌不存在，请刷新后重试',
  [BookingError.TABLE_DISABLED]: '该球桌维护中，暂不可预约',
  [BookingError.DATE_INVALID]: '请选择有效的预约日期',
  [BookingError.DATE_OUT_OF_RANGE]: `仅可预约今天起 ${BOOKING_DAYS} 天内的时段`,
  [BookingError.SLOT_INVALID]: '请选择有效的预约时段',
  [BookingError.SLOT_EXPIRED]: '该时段已过，请选择其他时段',
  [BookingError.DURATION_INVALID]: '请选择有效的预约时长',
  [BookingError.OUT_OF_BUSINESS_HOURS]: `营业时段为 ${OPEN_HOUR}:00 - ${CLOSE_HOUR}:00，请调整时长`,
  [BookingError.SLOT_OCCUPIED]: '该时段已被占用，请选择其他时段',
  [BookingError.DUPLICATE_SUBMISSION]: '预约正在提交中，请勿重复点击'
}

/** 占用 / 失效变更通知事件名 */
export const BOOKINGS_CHANGED_EVENT = 'billiard:bookings-changed'

// ==================== 日期 / 时间工具 ====================

const pad = n => String(n).padStart(2, '0')

/** 本地时区下的 yyyy-MM-dd（避免 toISOString 的 UTC 偏移问题） */
export function formatDate(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayStr() {
  return formatDate(new Date())
}

/** 可预约的最晚日期（含今天共 BOOKING_DAYS 天） */
export function maxDateStr() {
  const d = new Date()
  d.setDate(d.getDate() + BOOKING_DAYS - 1)
  return formatDate(d)
}

export function isValidDateStr(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00`)
  return !Number.isNaN(parsed.getTime()) && formatDate(parsed) === date
}

export function minutesOf(hour, minute = 0) {
  return hour * 60 + minute
}

/** 当前时刻在某天内对应的分钟数 */
function currentMinutesOn(date) {
  const now = new Date()
  if (formatDate(now) === date) {
    return minutesOf(now.getHours(), now.getMinutes())
  }
  return null
}

/**
 * 解析预约记录占用的时间区间
 * 兼容历史数据 'HH:MM - HH:MM'，以及带 startTime/endTime 的新数据
 */
export function parseRange(extra) {
  if (extra && Number.isFinite(extra.startHour) && Number.isFinite(extra.endHour)) {
    return { start: minutesOf(extra.startHour), end: minutesOf(extra.endHour) }
  }
  const range = (extra && extra.time) || ''
  const m = range.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
  if (!m) return null
  return {
    start: minutesOf(Number(m[1]), Number(m[2])),
    end: minutesOf(Number(m[3]), Number(m[4]))
  }
}

/** 两个左闭右开区间相交即冲突（相邻不算冲突） */
export function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end
}

// ==================== 记录读取 ====================

/**
 * 读取所有“生效中”的预约记录（用于占用判定）
 * 已取消（cancelled）的记录不占桌；已完成/待付款等仍占桌
 */
export function getActiveBookings() {
  return taskStore.getAll().filter(
    t => t.type === 'booking' && t.status !== 'cancelled'
  )
}

function getTableBase(tableId) {
  return BASE_TABLES.find(t => t.id === Number(tableId)) || null
}

/** 查询某张球桌在某天的所有占用区间（含冲突的记录） */
export function getOccupiedRanges(tableId, date) {
  return getActiveBookings()
    .filter(t => {
      const tid = t.extra && t.extra.tableId
      return Number(tid) === Number(tableId) && t.extra && t.extra.date === date
    })
    .map(t => {
      const range = parseRange(t.extra)
      return range ? { ...range, taskId: t.id, orderNo: t.extra.orderNo } : null
    })
    .filter(Boolean)
}

// ==================== 时段 / 球桌状态 ====================

/**
 * 查询某张球桌某天、某时段开始、某时长是否可约
 * @returns {{available: boolean, reason: string}}
 */
export function getSlotState(tableId, date, startHour, duration) {
  const table = getTableBase(tableId)
  if (!table) return { available: false, reason: 'table_missing' }
  if (!table.enabled) return { available: false, reason: 'table_disabled' }
  if (!isValidDateStr(date)) return { available: false, reason: 'date_invalid' }
  if (date < todayStr() || date > maxDateStr()) {
    return { available: false, reason: 'date_out_of_range' }
  }
  if (!Number.isInteger(startHour) || !TIME_SLOTS.some(s => s.id === startHour)) {
    return { available: false, reason: 'slot_invalid' }
  }
  if (!DURATIONS.includes(duration)) {
    return { available: false, reason: 'duration_invalid' }
  }
  if (startHour + duration > CLOSE_HOUR) {
    return { available: false, reason: 'out_of_hours' }
  }
  const cur = currentMinutesOn(date)
  if (cur !== null && minutesOf(startHour) <= cur) {
    return { available: false, reason: 'expired' }
  }
  const wanted = { start: minutesOf(startHour), end: minutesOf(startHour + duration) }
  const conflict = getOccupiedRanges(tableId, date).some(r => rangesOverlap(wanted, r))
  if (conflict) return { available: false, reason: 'occupied' }
  return { available: true, reason: 'available' }
}

/**
 * 某张球桌某天全部固定时段的状态（按给定时长判定）
 */
export function getSlotStates(tableId, date, duration) {
  return TIME_SLOTS.map(slot => ({
    ...slot,
    ...getSlotState(tableId, date, slot.id, duration)
  }))
}

/**
 * 球桌卡片在某天是否“可预约”：
 * 维护中 / 当天没有任何时长可约（已打烊、约满、全部过期）即为已占用
 */
export function isTableAvailableOn(tableId, date) {
  const table = getTableBase(tableId)
  if (!table || !table.enabled) return false
  if (!isValidDateStr(date) || date < todayStr() || date > maxDateStr()) return false
  return DURATIONS.some(d =>
    TIME_SLOTS.some(s => getSlotState(tableId, date, s.id, d).available)
  )
}

/** 球桌卡片列表（附带指定日期的可用状态），不改变基础数据 */
export function getTablesForDate(date) {
  return BASE_TABLES.map(t => ({
    ...t,
    available: isTableAvailableOn(t.id, date)
  }))
}

/** 找到第一个可约时段（找不到返回 null） */
export function findFirstAvailableSlot(tableId, date, duration) {
  const states = getSlotStates(tableId, date, duration)
  return states.find(s => s.available) || null
}

// ==================== 确认前校验 ====================

function bookingError(code) {
  const err = new Error(ERROR_MESSAGES[code])
  err.code = code
  return err
}

/**
 * 预约前完整校验（球桌占用判定、冲突条件、可选时段范围检查）
 * @returns {true} 校验通过，否则抛出带 code 的 Error
 */
export function validateBooking({ tableId, date, startHour, duration, isLoggedIn = true }) {
  if (!isLoggedIn) throw bookingError(BookingError.NOT_LOGGED_IN)
  const table = getTableBase(tableId)
  if (!table) throw bookingError(BookingError.TABLE_NOT_FOUND)
  if (!table.enabled) throw bookingError(BookingError.TABLE_DISABLED)
  if (!isValidDateStr(date)) throw bookingError(BookingError.DATE_INVALID)
  if (date < todayStr() || date > maxDateStr()) throw bookingError(BookingError.DATE_OUT_OF_RANGE)
  if (!Number.isInteger(startHour) || !TIME_SLOTS.some(s => s.id === startHour)) {
    throw bookingError(BookingError.SLOT_INVALID)
  }
  if (!DURATIONS.includes(duration)) throw bookingError(BookingError.DURATION_INVALID)
  if (startHour + duration > CLOSE_HOUR) throw bookingError(BookingError.OUT_OF_BUSINESS_HOURS)
  const cur = currentMinutesOn(date)
  if (cur !== null && minutesOf(startHour) <= cur) throw bookingError(BookingError.SLOT_EXPIRED)

  const wanted = { start: minutesOf(startHour), end: minutesOf(startHour + duration) }
  const conflict = getOccupiedRanges(tableId, date).find(r => rangesOverlap(wanted, r))
  if (conflict) {
    const err = bookingError(BookingError.SLOT_OCCUPIED)
    err.conflict = conflict
    throw err
  }
  return true
}

export function errorMessage(code) {
  return ERROR_MESSAGES[code] || '预约失败，请稍后重试'
}

// ==================== 模拟服务端：创建预约 ====================

/** 进行中的请求指纹（防重复提交），服务端最后一道幂等保护 */
const inFlightKeys = new Set()

function rangeText(startHour, duration) {
  return `${pad(startHour)}:00 - ${pad(startHour + duration)}:00`
}

/** 模拟网络延迟 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 创建预约（模拟 POST /bookings + 写任务记录）
 *
 * 一致性保证：
 * - 提交时重新做一次占用/时效校验，防止弹窗打开后状态变化
 * - 同一 (tableId,date,startHour) 的请求未完成时，拒绝重复提交
 * - 仅在任务记录写入成功后才返回成功；失败不产生任何记录
 *
 * @returns {Promise<{success: boolean, data?: Object, error?: string, code?: string}>}
 */
export async function createBooking(payload) {
  const { tableId, date, startHour, duration } = payload
  const requestKey = `${tableId}|${date}|${startHour}`

  if (inFlightKeys.has(requestKey)) {
    return { success: false, code: BookingError.DUPLICATE_SUBMISSION, error: errorMessage(BookingError.DUPLICATE_SUBMISSION) }
  }

  try {
    validateBooking(payload)
  } catch (e) {
    return { success: false, code: e.code, error: e.message, conflict: e.conflict || null }
  }

  inFlightKeys.add(requestKey)
  try {
    // 模拟服务端处理延迟
    await delay(1200)

    // 服务端二次校验：等待期间可能已有其他请求占用（并发冲突）
    try {
      validateBooking(payload)
    } catch (e) {
      return { success: false, code: e.code, error: e.message, conflict: e.conflict || null }
    }

    const table = getTableBase(tableId)
    const orderNo = 'BK' + Date.now().toString().slice(-8)
    const time = rangeText(startHour, duration)

    // 原子写入预约记录（失败则整个预约失败，状态与记录不会错配）
    const task = taskStore.addBookingTask(
      { id: table.id, name: table.name, type: table.type, price: table.price },
      {
        orderNo,
        date,
        time,
        startHour,
        endHour: startHour + duration,
        duration
      }
    )
    if (!task) {
      return { success: false, code: 'STORAGE_FAILED', error: '预约失败，记录未保存，请稍后重试' }
    }

    logger.info('Booking created', { orderNo, tableId, date, time })
    notifyBookingsChanged()
    return {
      success: true,
      data: { orderNo, tableId, tableName: table.name, date, time, duration, taskId: task.id }
    }
  } catch (e) {
    logger.error('Create booking failed', e)
    return { success: false, code: 'NETWORK_ERROR', error: '网络异常，请稍后重试' }
  } finally {
    inFlightKeys.delete(requestKey)
  }
}

/** 占用发生变化（预约成功 / 取消）时发出通知，供已打开的页面刷新状态 */
export function notifyBookingsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BOOKINGS_CHANGED_EVENT))
  }
}

export default {
  BASE_TABLES,
  TIME_SLOTS,
  DURATIONS,
  BOOKING_DAYS,
  BookingError,
  formatDate,
  todayStr,
  maxDateStr,
  isValidDateStr,
  parseRange,
  rangesOverlap,
  getActiveBookings,
  getOccupiedRanges,
  getSlotState,
  getSlotStates,
  isTableAvailableOn,
  getTablesForDate,
  findFirstAvailableSlot,
  validateBooking,
  errorMessage,
  createBooking,
  notifyBookingsChanged
}
