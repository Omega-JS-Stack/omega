/**
 * Calendar Core
 * State management, date math (all UTC), Firestore real-time sync,
 * recurrence computation, and public API.
 * Reads from Firestore marketing-campaigns collection directly.
 *
 * IMPORTANT: All dates/times in this module are UTC.
 * No local time APIs (getHours, getDate, etc.) are used anywhere.
 */
import webManager from 'web-manager';

// View modes
export const VIEW_MODES = ['day', 'week', 'month', 'year', 'list'];

// Day abbreviations
export const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Month names
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Campaign type colors
export const TYPE_COLORS = {
  email: '#2196F3',
  push: '#4CAF50',
};

// Campaign status styles
export const STATUS_STYLES = {
  pending: { opacity: 1, icon: null },
  sent: { opacity: 0.55, icon: 'circle-check' },
  failed: { opacity: 1, icon: 'triangle-exclamation' },
};

// Display type constants
export const DISPLAY_TYPES = {
  ONE_OFF: 'one-off',
  RECURRING_TEMPLATE: 'recurring-template',
  RECURRING_HISTORY: 'recurring-history',
};

// ============================================
// Shared UTC date utilities
// ============================================

/**
 * Format a Date or unix timestamp to YYYY-MM-DD (UTC).
 */
export function formatDateUTC(input) {
  const d = typeof input === 'number' ? new Date(input * 1000) : input;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format a Date or unix timestamp to HH:MM (UTC).
 */
export function formatTimeUTC(input) {
  const d = typeof input === 'number' ? new Date(input * 1000) : input;
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

/**
 * Parse a YYYY-MM-DD string as a UTC midnight Date.
 */
export function parseDateUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Get today's date as YYYY-MM-DD (UTC).
 */
export function todayUTC() {
  return formatDateUTC(new Date());
}

export default class CalendarCore {
  constructor() {
    this.currentDate = new Date();
    this.viewMode = 'month';
    this.campaigns = new Map();
    this._virtualEvents = null;
    this.renderer = null;
    this.eventsManager = null;
    this.$root = document.getElementById('calendar-root');
    this._unsubscribeRange = null;
    this._unsubscribeRecurring = null;
  }

  // ============================================
  // Initialization
  // ============================================
  setRenderer(renderer) {
    this.renderer = renderer;
  }

  setEventsManager(eventsManager) {
    this.eventsManager = eventsManager;
  }

  async initialize() {
    await this._loadRecurringTemplates();
    this._subscribeToRange();
  }

  destroy() {
    if (this._unsubscribeRange) {
      this._unsubscribeRange();
      this._unsubscribeRange = null;
    }
    if (this._unsubscribeRecurring) {
      this._unsubscribeRecurring();
      this._unsubscribeRecurring = null;
    }
  }

  // ============================================
  // Navigation (all UTC)
  // ============================================
  navigate(direction) {
    const d = this.currentDate;

    switch (this.viewMode) {
      case 'day':
        d.setUTCDate(d.getUTCDate() + direction);
        break;
      case 'week':
        d.setUTCDate(d.getUTCDate() + (7 * direction));
        break;
      case 'month':
        d.setUTCMonth(d.getUTCMonth() + direction);
        break;
      case 'year':
        d.setUTCFullYear(d.getUTCFullYear() + direction);
        break;
      case 'list':
        d.setUTCDate(d.getUTCDate() + (30 * direction));
        break;
    }

    this._virtualEvents = null;
    this.renderer.render();
    this._subscribeToRange();
    this._dispatch('calendar:navigate');
  }

  goToToday() {
    this.currentDate = new Date();
    this._virtualEvents = null;
    this.renderer.render();
    this._subscribeToRange();
    this._dispatch('calendar:navigate');
  }

  setView(mode) {
    if (!VIEW_MODES.includes(mode)) {
      return;
    }

    this.viewMode = mode;
    this._virtualEvents = null;
    this.renderer.render();
    this._subscribeToRange();
    this._dispatch('calendar:viewchange');
  }

  // ============================================
  // Optimistic Updates
  // ============================================

  /**
   * Optimistically update a campaign's sendAt locally and re-render.
   * Returns a rollback function.
   */
  optimisticUpdateSendAt(id, newSendAtUNIX) {
    const campaign = this.campaigns.get(id);
    if (!campaign) {
      return null;
    }

    const originalSendAt = campaign.sendAt;
    campaign.sendAt = newSendAtUNIX;
    this._virtualEvents = null;
    this.renderer.render();

    return () => {
      campaign.sendAt = originalSendAt;
      this._virtualEvents = null;
      this.renderer.render();
    };
  }

  // ============================================
  // Campaign Display Type Detection
  // ============================================
  getCampaignDisplayType(doc) {
    if (doc.recurrence) {
      return DISPLAY_TYPES.RECURRING_TEMPLATE;
    }
    if (doc.recurringId) {
      return DISPLAY_TYPES.RECURRING_HISTORY;
    }
    return DISPLAY_TYPES.ONE_OFF;
  }

  isEditable(doc) {
    if (doc._virtual) {
      return false;
    }
    if (doc.recurringId) {
      return false;
    }
    if (doc.status === 'sent' || doc.status === 'failed') {
      return false;
    }
    return true;
  }

  isRecurring(campaign) {
    return !!(campaign.recurrence || campaign.recurringId || campaign._virtual);
  }

  // ============================================
  // Campaign Accessors
  // ============================================
  getCampaign(id) {
    const real = this.campaigns.get(id);
    if (real) {
      return real;
    }

    // Check virtual events
    const virtuals = this._getVirtualEvents();
    for (const v of virtuals) {
      if (v.id === id) {
        return v;
      }
    }

    return null;
  }

  /**
   * Get all display items for a date (YYYY-MM-DD UTC string).
   * Merges real docs + virtual recurring occurrences.
   */
  getCampaignsForDate(dateStr) {
    const items = [];
    const historyDatesById = this._getHistoryDateMap();

    // Real non-recurring docs
    this.campaigns.forEach((c) => {
      if (c.recurrence) {
        return;
      }
      if (formatDateUTC(c.sendAt) === dateStr) {
        items.push(c);
      }
    });

    // Virtual recurring occurrences
    const virtuals = this._getVirtualEvents();
    virtuals.forEach((v) => {
      const vDate = formatDateUTC(v.sendAt);
      if (vDate !== dateStr) {
        return;
      }
      const key = `${v._recurringSourceId}:${vDate}`;
      if (historyDatesById.has(key)) {
        return;
      }
      items.push(v);
    });

    return items.sort((a, b) => a.sendAt - b.sendAt);
  }

  /**
   * Get all display items sorted chronologically (for list view).
   */
  getAllCampaignsSorted() {
    const items = [];
    const historyDatesById = this._getHistoryDateMap();

    this.campaigns.forEach((c) => {
      if (c.recurrence) {
        return;
      }
      items.push(c);
    });

    const virtuals = this._getVirtualEvents();
    virtuals.forEach((v) => {
      const dateStr = formatDateUTC(v.sendAt);
      const key = `${v._recurringSourceId}:${dateStr}`;
      if (historyDatesById.has(key)) {
        return;
      }
      items.push(v);
    });

    return items.sort((a, b) => a.sendAt - b.sendAt);
  }

  // ============================================
  // Campaign Helpers
  // ============================================
  campaignColor(campaign) {
    return TYPE_COLORS[campaign.type] || TYPE_COLORS.email;
  }

  campaignStatusStyle(campaign) {
    return STATUS_STYLES[campaign.status] || STATUS_STYLES.pending;
  }

  campaignDuration() {
    return 60;
  }

  // ============================================
  // Recurrence: Virtual Event Generation
  // ============================================
  _getHistoryDateMap() {
    const map = new Map();
    this.campaigns.forEach((c) => {
      if (!c.recurringId) {
        return;
      }
      map.set(`${c.recurringId}:${formatDateUTC(c.sendAt)}`, true);
    });
    return map;
  }

  _getVirtualEvents() {
    if (this._virtualEvents) {
      return this._virtualEvents;
    }

    const { startUNIX, endUNIX } = this._getVisibleRange();
    const virtuals = [];

    this.campaigns.forEach((c) => {
      if (!c.recurrence) {
        return;
      }
      const occurrences = this._generateOccurrences(c, startUNIX, endUNIX);
      virtuals.push(...occurrences);
    });

    this._virtualEvents = virtuals;
    return virtuals;
  }

  /**
   * Generate virtual occurrences using the template's sendAt as seed.
   * Fixed-interval patterns (daily, weekly) use pure unix math.
   * Calendar-relative patterns (monthly, monthly-weekday, quarterly, yearly)
   * step through actual dates so they land correctly every month.
   */
  _generateOccurrences(template, startUNIX, endUNIX) {
    const { pattern } = template.recurrence;
    const occurrences = [];
    const seedUNIX = template.sendAt;

    if (pattern === 'monthly-weekday') {
      return this._generateNthWeekdayOccurrences(template, startUNIX, endUNIX);
    }

    // Fixed-interval patterns
    const interval = this._getIntervalSeconds(pattern);
    let cursorUNIX = seedUNIX;

    while (cursorUNIX > startUNIX + interval) {
      cursorUNIX -= interval;
    }
    while (cursorUNIX < startUNIX) {
      cursorUNIX += interval;
    }

    let maxIterations = 400;
    while (cursorUNIX <= endUNIX && maxIterations-- > 0) {
      occurrences.push(this._buildVirtualEvent(template, cursorUNIX));
      cursorUNIX += interval;
    }

    return occurrences;
  }

  /**
   * Generate Nth-weekday-of-month occurrences (e.g., 2nd Wednesday).
   * Walks month by month, computing the actual calendar date each time.
   */
  _generateNthWeekdayOccurrences(template, startUNIX, endUNIX) {
    const { nth = 1, day: dayOfWeek = 0, hour = 0, minute = 0 } = template.recurrence;
    const occurrences = [];

    // Start scanning 2 months before the visible range
    const startDate = new Date(startUNIX * 1000);
    let year = startDate.getUTCFullYear();
    let month = startDate.getUTCMonth() - 2;

    let maxIterations = 100;
    while (maxIterations-- > 0) {
      const ts = this._nthWeekdayOfMonth(year, month, nth, dayOfWeek, hour, minute);

      if (ts > endUNIX) {
        break;
      }

      if (ts >= startUNIX) {
        occurrences.push(this._buildVirtualEvent(template, ts));
      }

      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
    }

    return occurrences;
  }

  /**
   * Find the Nth occurrence of a weekday in a given month (UTC).
   * Returns unix timestamp.
   */
  _nthWeekdayOfMonth(year, month, nth, dayOfWeek, hour, minute) {
    const first = new Date(Date.UTC(year, month, 1));
    let dateNum = 1;

    // Advance to the first matching weekday
    while (first.getUTCDay() !== dayOfWeek) {
      dateNum++;
      first.setUTCDate(dateNum);
    }

    // Advance to the Nth occurrence
    dateNum += (nth - 1) * 7;

    return Date.UTC(year, month, dateNum, hour, minute, 0) / 1000;
  }

  _buildVirtualEvent(template, sendAtUNIX) {
    return {
      id: `${template.id}__virtual__${sendAtUNIX}`,
      sendAt: sendAtUNIX,
      status: 'pending',
      type: template.type,
      settings: template.settings,
      recurrence: template.recurrence,
      _virtual: true,
      _recurringSourceId: template.id,
    };
  }

  _getIntervalSeconds(pattern) {
    const DAY = 86400;
    switch (pattern) {
      case 'daily': return DAY;
      case 'weekly': return DAY * 7;
      case 'monthly': return DAY * 30;
      case 'quarterly': return DAY * 91;
      case 'yearly': return DAY * 365;
      default: return DAY;
    }
  }

  // ============================================
  // Date Utilities (all UTC)
  // ============================================
  getDaysInMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }

  getMonthGrid() {
    const year = this.currentDate.getUTCFullYear();
    const month = this.currentDate.getUTCMonth();
    const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = this.getDaysInMonth(year, month);
    const daysInPrevMonth = this.getDaysInMonth(year, month - 1);

    const cells = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({ date: new Date(Date.UTC(year, month - 1, daysInPrevMonth - i)), outside: true });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ date: new Date(Date.UTC(year, month, i)), outside: false });
    }

    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      cells.push({ date: new Date(Date.UTC(year, month + 1, i)), outside: true });
    }

    return cells;
  }

  getWeekDates() {
    const d = new Date(this.currentDate);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day);

    const dates = [];
    for (let i = 0; i < 7; i++) {
      dates.push(new Date(d));
      d.setUTCDate(d.getUTCDate() + 1);
    }

    return dates;
  }

  formatPeriodLabel() {
    const d = this.currentDate;
    const month = MONTH_NAMES[d.getUTCMonth()];
    const year = d.getUTCFullYear();

    switch (this.viewMode) {
      case 'day':
        return `${DAY_ABBREVS[d.getUTCDay()]}, ${month} ${d.getUTCDate()}, ${year}`;
      case 'week': {
        const weekDates = this.getWeekDates();
        const start = weekDates[0];
        const end = weekDates[6];
        const startMonth = MONTH_NAMES[start.getUTCMonth()].slice(0, 3);
        const endMonth = MONTH_NAMES[end.getUTCMonth()].slice(0, 3);
        if (start.getUTCMonth() === end.getUTCMonth()) {
          return `${startMonth} ${start.getUTCDate()} – ${end.getUTCDate()}, ${year}`;
        }
        return `${startMonth} ${start.getUTCDate()} – ${endMonth} ${end.getUTCDate()}, ${year}`;
      }
      case 'month':
        return `${month} ${year}`;
      case 'year':
        return `${year}`;
      case 'list': {
        const { startUNIX, endUNIX } = this._getVisibleRange();
        const s = new Date(startUNIX * 1000);
        const e = new Date(endUNIX * 1000);
        return `${MONTH_NAMES[s.getUTCMonth()].slice(0, 3)} ${s.getUTCDate()} – ${MONTH_NAMES[e.getUTCMonth()].slice(0, 3)} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
      }
      default:
        return '';
    }
  }

  isToday(date) {
    const today = new Date();
    return date.getUTCFullYear() === today.getUTCFullYear()
      && date.getUTCMonth() === today.getUTCMonth()
      && date.getUTCDate() === today.getUTCDate();
  }

  // ============================================
  // Firestore: One-time recurring template load
  // ============================================
  async _loadRecurringTemplates() {
    try {
      const { collection, query, where, getDocs, onSnapshot } = await import('firebase/firestore');
      const db = webManager.firebaseFirestore;
      const colRef = collection(db, 'marketing-campaigns');

      const recurringDocs = await getDocs(query(
        colRef,
        where('__name__', '>=', '_recurring-'),
        where('__name__', '<=', '_recurring-\uf8ff'),
      ));

      recurringDocs.forEach((doc) => {
        const data = doc.data();
        data.id = doc.id;
        this.campaigns.set(doc.id, data);
      });

      this._unsubscribeRecurring = onSnapshot(query(
        colRef,
        where('__name__', '>=', '_recurring-'),
        where('__name__', '<=', '_recurring-\uf8ff'),
      ), (snapshot) => {
        for (const id of this.campaigns.keys()) {
          if (id.startsWith('_recurring-')) {
            this.campaigns.delete(id);
          }
        }
        snapshot.forEach((doc) => {
          const data = doc.data();
          data.id = doc.id;
          this.campaigns.set(doc.id, data);
        });
        this._virtualEvents = null;
        this.renderer.render();
      });

      this.renderer.render();
    } catch (error) {
      console.error('Calendar: Failed to load recurring templates', error);
    }
  }

  // ============================================
  // Firestore: Range-based subscription
  // ============================================
  async _subscribeToRange() {
    if (this._unsubscribeRange) {
      this._unsubscribeRange();
      this._unsubscribeRange = null;
    }

    const { startUNIX, endUNIX } = this._getVisibleRange();

    try {
      const { collection, query, where, orderBy, onSnapshot } = await import('firebase/firestore');
      const db = webManager.firebaseFirestore;

      const rangeQuery = query(
        collection(db, 'marketing-campaigns'),
        where('sendAt', '>=', startUNIX),
        where('sendAt', '<=', endUNIX),
        orderBy('sendAt', 'asc'),
      );

      this._unsubscribeRange = onSnapshot(rangeQuery, (snapshot) => {
        for (const id of this.campaigns.keys()) {
          if (!id.startsWith('_recurring-')) {
            this.campaigns.delete(id);
          }
        }

        snapshot.forEach((doc) => {
          const data = doc.data();
          data.id = doc.id;
          this.campaigns.set(doc.id, data);
        });

        this._virtualEvents = null;
        this._dispatch('calendar:datachange');
        this.renderer.render();
      }, (error) => {
        console.error('Calendar: Firestore range subscription error', error);
      });
    } catch (error) {
      console.error('Calendar: Failed to subscribe to range', error);
    }
  }

  /**
   * Calculate visible date range as unix timestamps (UTC).
   */
  _getVisibleRange() {
    const d = this.currentDate;
    let start, end;

    switch (this.viewMode) {
      case 'day':
        start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
        break;
      case 'week': {
        const weekDates = this.getWeekDates();
        start = weekDates[0];
        end = new Date(weekDates[6]);
        end.setUTCDate(end.getUTCDate() + 1);
        break;
      }
      case 'month': {
        const firstDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getUTCDay();
        start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1 - firstDay));
        end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 42);
        break;
      }
      case 'year':
        start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        end = new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
        break;
      case 'list':
        start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 30));
        end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 60));
        break;
    }

    return {
      startUNIX: Math.floor(start.getTime() / 1000),
      endUNIX: Math.floor(end.getTime() / 1000),
    };
  }

  // ============================================
  // Event Dispatching
  // ============================================
  _dispatch(eventName, detail) {
    this.$root.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}
