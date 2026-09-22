/**
 * 球桌预约领域逻辑
 *
 * 功能说明：
 * - 营业时段与可选时段范围检查（10:00 - 22:00、未来 7 天、时长 1-4 小时）
 * - 球桌占用判定：本地有效预约记录 + 确定性的模拟占用
 * - 时段冲突检测（同球桌、同日期、时间区间相交）
 * - 预约请求提交前的完整校验
 *
 * 本模块为纯函数，不依赖 Vue / localStorage，便于单元测试与在 mock 服务端复用。
 */

// ==================== 常量定义 ====================

/** 营业开始小时 */
export const OPEN_HOUR = 10
/** 营业结束小时 */
export const CLOSE_HOUR = 22
/** 标准时段粒度（小时），时段列表每 2 小时一个 */
export const SLOT_HOURS = 2
/** 最短预约时长（小时） */
export const MIN_DURATION_HOURS = 1
/** 最长预约时长（小时） */
export const MAX_DURATION_HOURS = 4
/** 最多可提前预约天数 */
export const MAX_ADVANCE_DAYS = 7

/** 预约记录发生变化时派发的窗口事件名 */
export const BOOKING_CHANGED_EVENT = 'booking-tasks-changed'

/** 仍占用球桌的任务状态（已完成 / 已取消不再占用） */
export const ACTIVE_BOOKING_STATUSES = ['pending_payment', 'upcoming', 'ongoing']

/** 可选时长 */
export const DURATION_OPTIONS = [1, 2, 3, 4]

/**
 * 球桌基础数据（运营状态稳定，不随日期随机变化）
 * operational=false 表示球桌维护中，任何日期都不可预约
 */
export const BASE_TABLES = [
  {
    id: 1,
    name: '1号球桌',
    type: '斯诺克',
    typeId: 'snooker',
    price: 80,
    operational: true,
    size: '12尺',
    brand: '星牌'
  },
  {
    id: 2,
    name: '2号球桌',
    type: '斯诺克',
    typeId: 'snooker',
    price: 80,
    operational: false,
    size: '12尺',
    brand: '星牌'
  },
  {
    id: 3,
    name: '3号球桌',
    type: '美式九球',
    typeId: 'pool',
    price: 60,
    operational: true,
    size: '9尺',
    brand: 'Brunswick'
  },
  {
    id: 4,
    name: '4号球桌',
    type: '美式九球',
    typeId: 'pool',
    price: 60,
    operational: true,
    size: '9尺',
    brand: 'Brunswick'
  },
  {
    id: 5,
    name: '5号球桌',
    type: '中式八球',
    typeId: 'chinese',
    price: 50,
    operational: false,
    size: '9尺',
    brand: '乔氏'
  },
  {
    id: 6,
    name: '6号球桌',
    type: '中式八球',
    typeId: 'chinese',
    price: 50,
    operational: true,
    size: '9尺',
    brand: '乔氏'
  }
]

/** 标准时段定义（label 与历史展示格式保持一致） */
export const BASE_TIME_SLOTS = [
  { id: 1, start: '10:00', end: '12:00' },
  { id: 2, start: '12:00', end: '14:00' },
  { id: 3, start: '14:00', end: '16:00' },
  { id: 4, start: '16:00', end: '18:00' },
  { id: 5, start: '18:00', end: '20:00' },
  { id: 6, start: '20:00', end: '22:00' }
]

// ==================== 日期 / 时间工具 ====================

export function pad2(n) {
  return n.toString().padStart(2, '0')
}

/**
 * 本地时区的 yyyy-MM-dd（不能用 toISOString，UTC 会导致日期偏移）
 */
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/**
 * 指定日期偏移天数后的 yyyy-MM-dd
 */
export function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

/** 可预约的最晚日期 */
export function maxBookingDateStr(now = new Date()) {
  return addDaysStr(todayStr(now), MAX_ADVANCE_DAYS)
}

/** 校验 yyyy-MM-dd 且为真实日期 */
export function isValidDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T00:00:00')
  return !Number.isNaN(d.getTime()) && todayStr(d) === value
}

/** 'HH:mm' -> 分钟数 */
export function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim())
  if (!match) return NaN
  return Number(match[1]) * 60 + Number(match[2])
}

/** 分钟数 -> 'HH:mm' */
export function minutesToTime(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

/**
 * 解析时段文本，兼容 '14:00 - 16:00' 与 '14:00-16:00'
 * @returns {{start:string, end:string}|null}
 */
export function parseTimeRange(label) {
  const match = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(String(label || ''))
  if (!match) return null
  return { start: `${pad2(Number(match[1]))}:${match[2]}`, end: `${pad2(Number(match[3]))}:${match[4]}` }
}

export function getSlotById(slotId) {
  return BASE_TIME_SLOTS.find(s => s.id === Number(slotId)) || null
}

/**
 * 根据时段开始时间文本反查标准时段
 */
export function findSlotByStart(label) {
  const range = parseTimeRange(label)
  if (!range) return null
  return BASE_TIME_SLOTS.find(s => s.start === range.start) || null
}

export function getSlotLabel(slotId) {
  const slot = getSlotById(slotId)
  return slot ? `${slot.start} - ${slot.end}` : ''
}

/**
 * 计算「某标准时段开始 + 预约时长」的实际占用区间
 */
export function getRangeForSlot(slotId, durationHours) {
  const slot = getSlotById(slotId)
  const startMin = slot ? timeToMinutes(slot.start) : NaN
  const endMin = startMin + Number(durationHours) * 60
  return { startMin, endMin, start: slot ? slot.start : '', end: minutesToTime(endMin) }
}

/** 区间必须落在营业时间内 */
export function isWithinBusinessHours(startMin, endMin) {
  return (
    Number.isFinite(startMin) &&
    Number.isFinite(endMin) &&
    startMin >= OPEN_HOUR * 60 &&
    endMin <= CLOSE_HOUR * 60 &&
    endMin > startMin
  )
}

/**
 * 某日某时段是否已经开始（仅当天需要与当前时刻比较）
 */
export function isPastDateTime(dateStr, startMin, now = new Date()) {
  if (dateStr < todayStr(now)) return true
  if (dateStr > todayStr(now)) return false
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return startMin <= nowMin
}

// ==================== 预约记录归一化与冲突判定 ====================

/**
 * 将任务中心的 booking 任务归一化为时间区间
 * 任务 extra 形如 { tableId, date, time, duration }
 * 老数据可能缺少 duration，则按时段文本的结束时间推算
 */
export function bookingRangeFromTask(task) {
  const extra = task?.extra || {}
  const tableId = Number(extra.tableId)
  const date = extra.date
  const range = parseTimeRange(extra.time)
  if (!Number.isFinite(tableId) || !isValidDateStr(date) || !range) return null
  const startMin = timeToMinutes(range.start)
  const labelEndMin = timeToMinutes(range.end)
  const durationHours = Number(extra.duration)
  const endMin = Number.isFinite(durationHours) && durationHours > 0 ? startMin + durationHours * 60 : labelEndMin
  return { taskId: task.id, status: task.status, tableId, date, startMin, endMin }
}

/** 任务是否为仍占用球桌的有效预约 */
export function isActiveBookingTask(task) {
  return task?.type === 'booking' && ACTIVE_BOOKING_STATUSES.includes(task.status)
}

/**
 * 两个预约区间是否冲突：同球桌、同日期、时间相交（端点相接不算冲突）
 */
export function rangesOverlap(a, b) {
  return a.tableId === b.tableId && a.date === b.date && a.startMin < b.endMin && b.startMin < a.endMin
}

/**
 * 在有效预约中查找与请求冲突的记录
 * @param {Object} request 归一化请求 {tableId,date,startMin,endMin}
 * @param {Array} activeBookings bookingRangeFromTask 的结果数组
 * @param {string} [excludeTaskId] 修改场景下排除自身任务
 */
export function findBookingConflict(request, activeBookings, excludeTaskId = null) {
  return activeBookings.find(b => b.taskId !== excludeTaskId && rangesOverlap(request, b)) || null
}

// ==================== 占用判定 ====================

/** 简单稳定的字符串哈希（用于生成可复现的模拟占用） */
function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0
  }
  return h
}

/**
 * 非用户行为的确定性模拟占用（代表到店客人 / 其他渠道订单）
 * 同一天同一球桌结果稳定，不会因刷新或重新渲染而跳变
 * @returns {number[]} 被占用的 1 小时块起始分钟数（如 [600, 660]）
 */
export function getSimulatedBlockedBlocks(tableId, dateStr) {
  const hash = hashString(`${tableId}:${dateStr}`)
  const count = hash % 3 // 0-2 个整块，保证每天仍有可约时段
  const blocks = []
  const used = new Set()
  for (let i = 0; i < count; i++) {
    const hour = OPEN_HOUR + ((hash >> (i * 4)) % (CLOSE_HOUR - OPEN_HOUR))
    if (!used.has(hour)) {
      used.add(hour)
      blocks.push(hour * 60)
    }
  }
  return blocks
}

/**
 * 汇总某球桌某日所有被占用的 1 小时块（有效预约 + 模拟占用）
 * @returns {Set<number>}
 */
export function getOccupiedBlocks(tableId, dateStr, activeBookings) {
  const blocks = new Set(getSimulatedBlockedBlocks(tableId, dateStr))
  activeBookings.forEach(b => {
    if (b.tableId !== tableId || b.date !== dateStr) return
    for (let m = b.startMin; m < b.endMin; m += 60) {
      blocks.add(m)
    }
  })
  return blocks
}

/** 占用块集合中，[startMin, endMin) 是否完全空闲 */
export function isRangeFree(occupiedBlocks, startMin, endMin) {
  for (let m = startMin; m < endMin; m += 60) {
    if (occupiedBlocks.has(m)) return false
  }
  return true
}

/**
 * 单个时段按钮的可用状态（按时段起始的第一个 1 小时块判定）
 * @returns {{available:boolean, reason:string, statusText:string}}
 */
export function getSlotAvailability(slotId, table, dateStr, activeBookings, now = new Date()) {
  const slot = getSlotById(slotId)
  if (!slot || !table?.operational) {
    return { available: false, reason: 'maintenance', statusText: '不可用' }
  }
  const startMin = timeToMinutes(slot.start)
  if (isPastDateTime(dateStr, startMin, now)) {
    return { available: false, reason: 'past', statusText: '已结束' }
  }
  const conflict = findBookingConflict(
    { tableId: table.id, date: dateStr, startMin, endMin: startMin + 60 },
    activeBookings
  )
  if (conflict) {
    return { available: false, reason: 'conflict', statusText: '已约' }
  }
  const blocks = getOccupiedBlocks(table.id, dateStr, activeBookings)
  if (!isRangeFree(blocks, startMin, startMin + 60)) {
    return { available: false, reason: 'occupied', statusText: '已满' }
  }
  return { available: true, reason: 'free', statusText: '可预约' }
}

/**
 * 某时段下指定时长是否可行（范围 / 时效 / 占用）
 */
export function getDurationAvailability(slotId, durationHours, table, dateStr, activeBookings, now = new Date()) {
  const slot = getSlotById(slotId)
  if (!slot || !table?.operational) {
    return { valid: false, reason: 'maintenance', message: '该球桌当前不可用' }
  }
  const hours = Number(durationHours)
  if (!Number.isInteger(hours) || hours < MIN_DURATION_HOURS || hours > MAX_DURATION_HOURS) {
    return { valid: false, reason: 'duration', message: '预约时长无效' }
  }
  const { startMin, endMin } = getRangeForSlot(slotId, hours)
  if (!isWithinBusinessHours(startMin, endMin)) {
    return { valid: false, reason: 'hours', message: `该时长超出营业时间（${OPEN_HOUR}:00 - ${CLOSE_HOUR}:00）` }
  }
  if (isPastDateTime(dateStr, startMin, now)) {
    return { valid: false, reason: 'past', message: '该时段已开始，请重新选择' }
  }
  const conflict = findBookingConflict({ tableId: table.id, date: dateStr, startMin, endMin }, activeBookings)
  if (conflict) {
    return { valid: false, reason: 'conflict', message: '该时段已被其他预约占用' }
  }
  const blocks = getOccupiedBlocks(table.id, dateStr, activeBookings)
  if (!isRangeFree(blocks, startMin, endMin)) {
    return { valid: false, reason: 'occupied', message: '该时段已满，请选择其他时段' }
  }
  return { valid: true, reason: 'free', message: '' }
}

/**
 * 球桌在某日是否可约：运营中且至少存在一个可行的时段 + 时长组合
 */
export function getTableAvailability(table, dateStr, activeBookings, now = new Date()) {
  if (!table?.operational) {
    return { available: false, reason: 'maintenance', reasonText: '维护中' }
  }
  let hasOpenSlot = false
  for (const slot of BASE_TIME_SLOTS) {
    for (const hours of DURATION_OPTIONS) {
      const result = getDurationAvailability(slot.id, hours, table, dateStr, activeBookings, now)
      if (result.valid) return { available: true, reason: 'free', reasonText: '可预约' }
      if (result.reason !== 'past' && result.reason !== 'maintenance') hasOpenSlot = true
    }
  }
  return {
    available: false,
    reason: hasOpenSlot ? 'full' : 'past',
    reasonText: hasOpenSlot ? '已约满' : '当日可约时段已结束'
  }
}

// ==================== 提交前完整校验 ====================

/**
 * 预约请求的提交前校验
 * @param {Object} input { table?, tableId?, date, slotId, duration }
 * @param {Array} activeBookings 有效预约区间数组
 * @param {Date} [now]
 * @returns {{valid:boolean, error?:string, request?:Object}}
 */
export function validateBookingRequest(input, activeBookings, now = new Date()) {
  const table = input.table || BASE_TABLES.find(t => t.id === Number(input.tableId))
  if (!table) {
    return { valid: false, error: '球桌不存在' }
  }
  if (!table.operational) {
    return { valid: false, error: '该球桌维护中，暂不可预约' }
  }

  const date = input.date
  if (!isValidDateStr(date)) {
    return { valid: false, error: '预约日期无效' }
  }
  if (date < todayStr(now)) {
    return { valid: false, error: '预约日期已失效，请重新选择' }
  }
  if (date > maxBookingDateStr(now)) {
    return { valid: false, error: `仅支持预约未来 ${MAX_ADVANCE_DAYS} 天内的球桌` }
  }

  const duration = Number(input.duration)
  if (!Number.isInteger(duration) || duration < MIN_DURATION_HOURS || duration > MAX_DURATION_HOURS) {
    return { valid: false, error: '预约时长无效' }
  }

  const slot = getSlotById(input.slotId)
  if (!slot) {
    return { valid: false, error: '请选择有效的预约时段' }
  }

  const range = getRangeForSlot(slot.id, duration)
  if (!isWithinBusinessHours(range.startMin, range.endMin)) {
    return { valid: false, error: `预约时间需在 ${OPEN_HOUR}:00 - ${CLOSE_HOUR}:00 营业时间内` }
  }
  if (isPastDateTime(date, range.startMin, now)) {
    return { valid: false, error: '该时段已开始，请选择其他时段' }
  }

  const request = { tableId: table.id, date, startMin: range.startMin, endMin: range.endMin }

  // 有效预约冲突（重复提交 / 并发抢占会命中这里）
  const conflict = findBookingConflict(request, activeBookings)
  if (conflict) {
    return { valid: false, error: '该时段已被占用，请更换时段后重试', request }
  }

  // 模拟占用（其他渠道订单）
  const blocks = getOccupiedBlocks(table.id, date, activeBookings)
  if (!isRangeFree(blocks, range.startMin, range.endMin)) {
    return { valid: false, error: '该时段已满，请选择其他时段', request }
  }

  return { valid: true, request }
}
