<template>
  <div class="tables-page">
    <header class="page-header">
      <div class="header-content">
        <span class="page-tag">在线预约</span>
        <h1>球桌预约</h1>
        <p>选择您喜欢的球桌类型，开始您的台球时光</p>
      </div>
    </header>

    <div class="filter-section">
      <div class="filter-group">
        <div class="filter-tabs">
          <button 
            v-for="type in tableTypes" 
            :key="type.id"
            :class="{ active: selectedType === type.id }"
            @click="selectedType = type.id"
          >
            <span class="tab-icon">{{ type.icon }}</span>
            <span>{{ type.name }}</span>
          </button>
        </div>
      </div>
      <div class="filter-right">
        <div class="date-picker">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          <input v-model="selectedDate" type="date" />
        </div>
      </div>
    </div>

    <div class="tables-grid" :class="{ loading: isLoadingTables }">
      <div v-if="isLoadingTables" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>加载中...</span>
      </div>
      <div 
        v-for="table in filteredTables" 
        :key="table.id" 
        class="table-card"
        :class="{ available: table.available, unavailable: !table.available }"
      >
        <div class="card-header">
          <div class="table-type-badge">{{ table.type }}</div>
          <div class="status-indicator" :class="table.available ? 'online' : 'offline'">
            <span class="status-dot"></span>
            <span>{{ table.statusText }}</span>
          </div>
        </div>
        
        <div class="table-visual">
          <div class="table-3d">
            <div class="table-surface">
              <div class="pocket tl"></div>
              <div class="pocket tr"></div>
              <div class="pocket ml"></div>
              <div class="pocket mr"></div>
              <div class="pocket bl"></div>
              <div class="pocket br"></div>
            </div>
          </div>
        </div>

        <div class="card-content">
          <h3>{{ table.name }}</h3>
          <div class="table-specs">
            <div class="spec">
              <span class="spec-label">尺寸</span>
              <span class="spec-value">{{ table.size }}</span>
            </div>
            <div class="spec">
              <span class="spec-label">品牌</span>
              <span class="spec-value">{{ table.brand }}</span>
            </div>
          </div>
          <div class="price-row">
            <div class="price">
              <span class="amount">¥{{ table.price }}</span>
              <span class="unit">/小时</span>
            </div>
            <button
              class="btn-book"
              :disabled="!table.available"
              @click="openBooking(table)"
            >
              {{ table.available ? '立即预约' : table.statusText }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Booking Modal -->
    <Modal
      v-model="showBookingModal"
      title="预约球桌"
      subtitle="请选择预约时段"
      size="medium"
      confirm-text="确认预约"
      :loading="bookingLoading"
      :confirm-disabled="!canConfirm"
      :show-cancel="!bookingLoading"
      :show-close="!bookingLoading"
      :close-on-overlay="!bookingLoading"
      @confirm="confirmBooking"
    >
      <div v-if="selectedTable" class="booking-form">
        <div class="booking-table-info">
          <div class="table-preview">
            <div class="preview-surface"></div>
          </div>
          <div class="table-details">
            <h4>{{ selectedTable.name }}</h4>
            <p>{{ selectedTable.type }} · {{ selectedTable.brand }}</p>
            <span class="table-price">¥{{ selectedTable.price }}/小时</span>
          </div>
        </div>

        <div class="form-group">
          <label>预约日期（最多可提前 {{ maxAdvanceDaysText }} 天）</label>
          <div class="date-input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            <input
              v-model="bookingDate"
              type="date"
              :min="today"
              :max="maxBookingDate"
              :disabled="bookingLoading"
              @change="selectDate(bookingDate)"
            />
          </div>
        </div>

        <div class="form-group">
          <label>选择时段（{{ bookingDate }}）</label>
          <div class="time-slots">
            <button
              v-for="slot in bookingSlots"
              :key="slot.id"
              type="button"
              class="time-slot"
              :class="{ active: selectedTimeSlot === slot.id, disabled: !slot.available }"
              :disabled="!slot.available || bookingLoading"
              @click="selectSlot(slot)"
            >
              <span class="slot-time">{{ slot.label }}</span>
              <span class="slot-status">{{ slot.statusText }}</span>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label>预约时长</label>
          <div class="duration-selector">
            <button
              v-for="option in durationOptions"
              :key="option.hours"
              type="button"
              class="duration-btn"
              :class="{ active: duration === option.hours, disabled: !option.valid }"
              :disabled="!option.valid || bookingLoading"
              :title="option.valid ? '' : option.message"
              @click="selectDuration(option)"
            >
              {{ option.hours }}小时
            </button>
          </div>
        </div>

        <div v-if="bookingError" class="booking-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{{ bookingError }}</span>
        </div>

        <div class="booking-summary">
          <div class="summary-row">
            <span>球桌费用</span>
            <span>¥{{ selectedTable.price }} × {{ duration }}小时</span>
          </div>
          <div class="summary-row total">
            <span>合计</span>
            <span class="total-price">¥{{ totalPrice }}</span>
          </div>
        </div>
      </div>
    </Modal>

    <!-- Success Modal -->
    <Modal
      v-model="showSuccessModal"
      icon="🎉"
      icon-type="success"
      title="预约成功"
      :subtitle="successMessage"
      size="small"
      :show-cancel="false"
      confirm-text="我知道了"
      @confirm="showSuccessModal = false"
    >
      <div v-if="bookingResult" class="success-details">
        <div class="detail-item">
          <span class="label">预约编号</span>
          <span class="value">{{ bookingResult.orderNo }}</span>
        </div>
        <div class="detail-item">
          <span class="label">球桌</span>
          <span class="value">{{ bookingResult.tableName }}</span>
        </div>
        <div class="detail-item">
          <span class="label">时间</span>
          <span class="value">{{ bookingResult.date }} {{ bookingResult.time }}</span>
        </div>
      </div>
    </Modal>

    <!-- Toast -->
    <Toast v-model="showToast" :type="toastType" :title="toastTitle" :message="toastMessage" />

    <!-- Login Modal -->
    <LoginModal v-model="showLoginModal" @success="onLoginSuccess" />
  </div>
</template>

<script>
import Modal from '../components/Modal.vue'
import Toast from '../components/Toast.vue'
import LoginModal from '../components/LoginModal.vue'
import { isAuthenticated } from '../utils/auth'
import { api, logger } from '../utils/api'
import { taskStore } from '../utils/taskStore'
import {
  BASE_TABLES,
  BASE_TIME_SLOTS,
  DURATION_OPTIONS,
  MAX_ADVANCE_DAYS,
  BOOKING_CHANGED_EVENT,
  todayStr,
  maxBookingDateStr,
  getTableAvailability,
  getSlotAvailability,
  getDurationAvailability,
  getSlotLabel,
  validateBookingRequest
} from '../utils/booking'

export default {
  name: 'Tables',
  components: { Modal, Toast, LoginModal },
  data() {
    const today = todayStr()
    return {
      selectedType: 'all',
      selectedDate: today,
      isLoadingTables: false,
      // 占用数据版本号：预约/取消导致任务变化时自增，驱动可用状态重算
      occupancyVersion: 0,
      showBookingModal: false,
      showSuccessModal: false,
      bookingLoading: false,
      selectedTable: null,
      bookingDate: today,
      selectedTimeSlot: null,
      duration: 2,
      durations: DURATION_OPTIONS,
      bookingResult: null,
      successMessage: '',
      // 提交前校验/服务端返回的错误提示
      bookingError: '',
      showToast: false,
      toastType: 'success',
      toastTitle: '',
      toastMessage: '',
      showLoginModal: false,
      pendingTable: null,
      // 路由续接时等待数据加载的轮询定时器
      routePollTimer: null,
      tableTypes: [
        { id: 'all', name: '全部', icon: '🎱' },
        { id: 'snooker', name: '斯诺克', icon: '🟢' },
        { id: 'pool', name: '美式九球', icon: '🟡' },
        { id: 'chinese', name: '中式八球', icon: '⚫' }
      ]
    }
  },
  computed: {
    today() {
      return todayStr()
    },
    maxBookingDate() {
      return maxBookingDateStr()
    },
    // 有效预约（归一化时间区间），occupancyVersion 保证任务变化后重新计算
    activeBookings() {
      this.occupancyVersion
      return taskStore.getActiveBookingRanges()
    },
    // 结合运营状态、预约记录占用与模拟占用后的球桌列表
    tablesForDate() {
      this.occupancyVersion
      return BASE_TABLES.map(table => {
        const status = getTableAvailability(table, this.selectedDate, this.activeBookings)
        return {
          ...table,
          available: status.available,
          unavailableReason: status.reason,
          statusText: status.reasonText
        }
      })
    },
    filteredTables() {
      if (this.selectedType === 'all') return this.tablesForDate
      return this.tablesForDate.filter(t => t.typeId === this.selectedType)
    },
    // 弹窗内展示的时段列表，状态随所选日期/球桌实时计算
    bookingSlots() {
      if (!this.selectedTable) {
        return BASE_TIME_SLOTS.map(slot => ({ ...slot, label: `${slot.start} - ${slot.end}`, available: false, statusText: '不可用' }))
      }
      return BASE_TIME_SLOTS.map(slot => {
        const state = getSlotAvailability(
          slot.id,
          this.selectedTable,
          this.bookingDate,
          this.activeBookings
        )
        return { ...slot, label: `${slot.start} - ${slot.end}`, available: state.available, statusText: state.statusText }
      })
    },
    // 各时长在当前时段下是否可行（超出营业时间/跨占用块时禁用）
    durationOptions() {
      return this.durations.map(hours => {
        let state = { valid: false, message: '' }
        if (this.selectedTable && this.selectedTimeSlot != null) {
          state = getDurationAvailability(
            this.selectedTimeSlot,
            hours,
            this.selectedTable,
            this.bookingDate,
            this.activeBookings
          )
        }
        return { hours, valid: state.valid, message: state.message }
      })
    },
    totalPrice() {
      return this.selectedTable ? this.selectedTable.price * this.duration : 0
    },
    canConfirm() {
      return !this.bookingLoading && this.selectedTable != null && this.selectedTimeSlot != null
    },
    maxAdvanceDaysText() {
      return MAX_ADVANCE_DAYS
    }
  },
  watch: {
    selectedDate() {
      this.loadTablesForDate()
    }
  },
  mounted() {
    this.loadTablesForDate()
    // 任务中心取消预约后，返回本页也能立即同步球桌占用状态
    window.addEventListener(BOOKING_CHANGED_EVENT, this.onBookingsChanged)
    this.handleRouteQuery()
  },
  beforeUnmount() {
    window.removeEventListener(BOOKING_CHANGED_EVENT, this.onBookingsChanged)
    if (this.routePollTimer) {
      clearInterval(this.routePollTimer)
      this.routePollTimer = null
    }
  },
  methods: {
    onBookingsChanged() {
      this.occupancyVersion++
    },
    async loadTablesForDate() {
      this.isLoadingTables = true
      const date = this.selectedDate
      // 模拟按日期加载球桌状态的请求延迟；占用数据本身是确定性的，不会随机跳变
      await new Promise(resolve => setTimeout(resolve, 800))
      // 加载期间用户又切换了日期，则丢弃过期结果（跨日期不错配）
      if (date !== this.selectedDate) {
        logger.info('Discard stale table loading result', { requested: date, current: this.selectedDate })
        return
      }
      this.occupancyVersion++
      this.isLoadingTables = false
    },
    /**
     * 初始化弹窗表单：根据当前日期的真实占用情况选择默认时段
     */
    initBookingForm(table) {
      this.selectedTable = table
      this.bookingDate = this.selectedDate
      this.bookingError = ''
      this.duration = 2

      const firstFree = BASE_TIME_SLOTS.find(slot => {
        const state = getSlotAvailability(slot.id, table, this.bookingDate, this.activeBookings)
        return state.available
      })
      this.selectedTimeSlot = firstFree ? firstFree.id : null
      // 默认时长 2 小时不可行时，退回到第一个可行时长
      this.$nextTick(() => this.normalizeDuration())
    },
    /**
     * 当当前时长在已选时段下不可行（跨占用块/超营业时间）时，自动选择可行时长
     */
    normalizeDuration() {
      const current = this.durationOptions.find(o => o.hours === this.duration)
      if (current?.valid) return
      const fallback = this.durationOptions.find(o => o.valid)
      this.duration = fallback ? fallback.hours : 2
    },
    openBooking(table) {
      // 检查是否已登录，未登录时先记录目标球桌，登录成功后续接预约
      if (!isAuthenticated()) {
        this.pendingTable = table
        this.showLoginModal = true
        return
      }
      // 二次确认球桌当前仍可约（防止登录弹窗期间状态变化）
      if (!table.available) {
        this.showNotification('warning', '该球桌暂不可约', table.statusText || '请选择其他球桌或时段')
        return
      }
      this.initBookingForm(table)
      this.showBookingModal = true
    },
    selectDate(date) {
      if (this.bookingLoading) return
      this.bookingDate = date
      this.bookingError = ''
      // 跨日期修改：重置为新日期下第一个可用时段
      const firstFree =
        this.selectedTable &&
        BASE_TIME_SLOTS.find(slot => {
          const state = getSlotAvailability(slot.id, this.selectedTable, date, this.activeBookings)
          return state.available
        })
      this.selectedTimeSlot = firstFree ? firstFree.id : null
      this.$nextTick(() => this.normalizeDuration())
    },
    selectSlot(slot) {
      if (this.bookingLoading || !slot.available) return
      this.selectedTimeSlot = slot.id
      this.bookingError = ''
      this.$nextTick(() => this.normalizeDuration())
    },
    selectDuration(option) {
      if (this.bookingLoading || !option.valid) return
      this.duration = option.hours
      this.bookingError = ''
    },
    /**
     * 登录成功回调
     */
    onLoginSuccess() {
      this.showLoginModal = false
      if (this.pendingTable) {
        const table = this.pendingTable
        this.pendingTable = null
        // 登录前后球桌状态可能已变化，以当前日期的最新判定为准
        const decorated = this.tablesForDate.find(t => t.id === table.id)
        if (decorated?.available) {
          this.initBookingForm(decorated)
          this.showBookingModal = true
        } else {
          this.showNotification('warning', '该球桌暂不可约', decorated?.statusText || '请选择其他球桌')
        }
      }
    },
    /**
     * 确认预约：先完成占用/冲突/时段范围校验，再调用 API；
     * 仅在 API 成功后写入任务记录，失败时不产生任何记录，状态与记录保持一致。
     */
    async confirmBooking() {
      // 防重复提交
      if (this.bookingLoading) return
      if (!this.selectedTable) {
        this.bookingError = '请先选择球桌'
        return
      }
      if (this.selectedTimeSlot == null) {
        this.bookingError = '请选择预约时段'
        return
      }

      // 提交瞬间再次校验，拦截弹窗打开后过期 / 被占用 / 跨日期修改等情况
      const validation = validateBookingRequest(
        {
          table: this.selectedTable,
          date: this.bookingDate,
          slotId: this.selectedTimeSlot,
          duration: this.duration
        },
        this.activeBookings
      )
      if (!validation.valid) {
        this.bookingError = validation.error
        // 失效可能来自新任务写入，刷新占用判定
        this.onBookingsChanged()
        return
      }

      this.bookingLoading = true
      this.bookingError = ''

      try {
        const result = await api.bookTable({
          tableId: this.selectedTable.id,
          date: this.bookingDate,
          slotId: this.selectedTimeSlot,
          duration: this.duration
        })

        if (!result.success) {
          // 服务端冲突（重复提交 / 并发抢占）：不写记录，保持弹窗可修改
          this.bookingError = result.error || '预约失败，请稍后重试'
          this.onBookingsChanged()
          logger.warn('Booking rejected by server', { error: result.error })
          return
        }

        const slotLabel = getSlotLabel(this.selectedTimeSlot)
        const orderNo = result.data.orderNo
        const bookingInfo = {
          orderNo,
          date: this.bookingDate,
          time: slotLabel,
          duration: this.duration
        }

        // API 成功后才写入任务中心；写入失败（如存储不可用）视为整体失败
        const task = taskStore.addBookingTask(this.selectedTable, bookingInfo)
        if (!task) {
          this.bookingError = '预约记录保存失败，请稍后重试'
          return
        }

        this.bookingResult = {
          orderNo,
          tableName: this.selectedTable.name,
          date: this.bookingDate,
          time: slotLabel
        }
        this.successMessage = `${this.bookingDate} ${slotLabel}`

        this.showBookingModal = false
        this.showSuccessModal = true
        this.showNotification('info', '已添加到任务中心', '您可以在任务中心查看并管理此预约')
        logger.info('Booking successful', { orderNo, tableId: this.selectedTable.id })
      } catch (error) {
        this.bookingError = '网络异常，请稍后重试'
        logger.error('Booking request failed', error)
      } finally {
        this.bookingLoading = false
      }
    },
    /**
     * 从任务中心「再次预约」带回 tableId 时，自动定位球桌并打开预约；
     * 「继续付款」仅回到本页，不自动弹窗，避免与待付款记录错配。
     */
    handleRouteQuery() {
      const { tableId, from } = this.$route.query
      if (!tableId || from !== 'rebook') return
      const id = Number(tableId)
      const table = BASE_TABLES.find(t => t.id === id)
      if (!table) return

      if (!isAuthenticated()) {
        this.pendingTable = table
        this.showLoginModal = true
        return
      }
      // 等待首个日期加载完成后再打开，保证占用状态是最新的
      const tryOpen = () => {
        const decorated = this.tablesForDate.find(t => t.id === id)
        if (decorated?.available) {
          this.openBooking(decorated)
        } else if (decorated) {
          this.showNotification('info', '该球桌当日暂不可约', '请切换日期或选择其他球桌')
        }
      }
      if (this.isLoadingTables) {
        this.routePollTimer = setInterval(() => {
          if (!this.isLoadingTables) {
            clearInterval(this.routePollTimer)
            this.routePollTimer = null
            tryOpen()
          }
        }, 100)
      } else {
        tryOpen()
      }
    },
    showNotification(type, title, message) {
      this.toastType = type
      this.toastTitle = title
      this.toastMessage = message
      this.showToast = true
    }
  }
}
</script>

<style scoped>
.tables-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 3rem 4rem;
}

.page-header {
  text-align: center;
  padding: 2rem 0 4rem;
}

.page-tag {
  display: inline-block;
  background: rgba(0, 217, 165, 0.1);
  color: var(--primary);
  padding: 0.5rem 1rem;
  border-radius: 50px;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 1rem;
}

.page-header h1 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 3rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.page-header p {
  color: var(--text-secondary);
  font-size: 1.1rem;
}

/* Filter Section */
.filter-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.filter-tabs {
  display: flex;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 0.4rem;
  gap: 0.25rem;
}

.filter-tabs button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  border: none;
  padding: 0.75rem 1.25rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s;
}

.filter-tabs button:hover {
  color: var(--text-primary);
}

.filter-tabs button.active {
  background: var(--primary);
  color: var(--bg-dark);
}

.tab-icon {
  font-size: 1rem;
}

.date-picker {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.75rem 1rem;
}

.date-picker svg {
  width: 20px;
  height: 20px;
  color: var(--text-secondary);
}

.date-picker input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 0.9rem;
  outline: none;
}

.date-picker input::-webkit-calendar-picker-indicator {
  filter: invert(1);
  cursor: pointer;
}

/* Tables Grid */
.tables-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 1.5rem;
  position: relative;
  min-height: 200px;
}

.tables-grid.loading {
  pointer-events: none;
}

.tables-grid.loading .table-card {
  opacity: 0.3;
  filter: blur(2px);
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  z-index: 10;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.table-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 20px;
  overflow: hidden;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.table-card.available:hover {
  transform: translateY(-6px);
  border-color: var(--primary);
  box-shadow: var(--shadow-glow);
}

.table-card.unavailable {
  opacity: 0.6;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
}

.table-type-badge {
  background: rgba(255, 255, 255, 0.05);
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-indicator.online .status-dot {
  background: var(--primary);
  box-shadow: 0 0 10px var(--primary);
}

.status-indicator.online {
  color: var(--primary);
}

.status-indicator.offline .status-dot {
  background: #ff6b6b;
}

.status-indicator.offline {
  color: #ff6b6b;
}

/* Table Visual */
.table-visual {
  padding: 1rem 1.5rem;
}

.table-3d {
  perspective: 500px;
}

.table-surface {
  position: relative;
  height: 100px;
  background: linear-gradient(135deg, #1B5E20 0%, #2E7D32 100%);
  border-radius: 8px;
  border: 6px solid #5D4037;
  box-shadow: 
    inset 0 0 20px rgba(0,0,0,0.3),
    0 10px 30px rgba(0,0,0,0.3);
  transform: rotateX(10deg);
}

.pocket {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #1a1a1a;
  border-radius: 50%;
}

.pocket.tl { top: 4px; left: 4px; }
.pocket.tr { top: 4px; right: 4px; }
.pocket.ml { top: 50%; left: 4px; transform: translateY(-50%); }
.pocket.mr { top: 50%; right: 4px; transform: translateY(-50%); }
.pocket.bl { bottom: 4px; left: 4px; }
.pocket.br { bottom: 4px; right: 4px; }

/* Card Content */
.card-content {
  padding: 1.25rem 1.5rem 1.5rem;
}

.card-content h3 {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.table-specs {
  display: flex;
  gap: 2rem;
  margin-bottom: 1.25rem;
}

.spec {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.spec-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.spec-value {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.price-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.price .amount {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--primary);
}

.price .unit {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.btn-book {
  background: var(--gradient-1);
  color: var(--bg-dark);
  border: none;
  padding: 0.75rem 1.5rem;
  font-size: 0.9rem;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-book:hover:not(:disabled) {
  transform: scale(1.02);
  box-shadow: 0 5px 20px var(--primary-glow);
}

.btn-book:disabled {
  background: var(--bg-card-hover);
  color: var(--text-muted);
  cursor: not-allowed;
}

/* Booking Form */
.booking-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.booking-table-info {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 14px;
}

.table-preview {
  width: 80px;
  height: 50px;
  flex-shrink: 0;
}

.preview-surface {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #1B5E20 0%, #2E7D32 100%);
  border-radius: 6px;
  border: 4px solid #5D4037;
}

.table-details h4 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.table-details p {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.table-price {
  font-size: 0.9rem;
  color: var(--primary);
  font-weight: 600;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.form-group label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.date-input {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.75rem 1rem;
}

.date-input svg {
  width: 18px;
  height: 18px;
  color: var(--text-secondary);
}

.date-input input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 0.9rem;
  outline: none;
}

.date-input input::-webkit-calendar-picker-indicator {
  filter: invert(1);
  cursor: pointer;
}

.time-slots {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.time-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.time-slot:hover:not(.disabled) {
  border-color: var(--primary);
}

.time-slot.active {
  background: rgba(0, 217, 165, 0.1);
  border-color: var(--primary);
}

.time-slot.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.slot-time {
  font-size: 0.9rem;
  font-weight: 500;
}

.slot-status {
  font-size: 0.7rem;
  color: var(--text-muted);
}

.time-slot.active .slot-status {
  color: var(--primary);
}

.duration-selector {
  display: flex;
  gap: 0.5rem;
}

.duration-btn {
  flex: 1;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.duration-btn:hover {
  border-color: var(--primary);
}

.duration-btn.active {
  background: rgba(0, 217, 165, 0.1);
  border-color: var(--primary);
  color: var(--primary);
}

.duration-btn.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.booking-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.3);
  border-radius: 10px;
  color: #ff6b6b;
  font-size: 0.85rem;
}

.booking-error svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.booking-summary {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  color: var(--text-secondary);
  padding: 0.5rem 0;
}

.summary-row.total {
  border-top: 1px solid var(--border);
  margin-top: 0.5rem;
  padding-top: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.total-price {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.25rem;
  color: var(--primary);
}

/* Success Details */
.success-details {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  text-align: left;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}

.detail-item .label {
  color: var(--text-secondary);
}

.detail-item .value {
  font-weight: 500;
}

@media (max-width: 768px) {
  .tables-page {
    padding: 0 1.5rem 3rem;
  }
  
  .page-header h1 {
    font-size: 2rem;
  }
  
  .filter-section {
    flex-direction: column;
    align-items: stretch;
  }
  
  .filter-tabs {
    overflow-x: auto;
  }
  
  .tables-grid {
    grid-template-columns: 1fr;
  }
  
  .time-slots {
    grid-template-columns: 1fr;
  }
}
</style>
