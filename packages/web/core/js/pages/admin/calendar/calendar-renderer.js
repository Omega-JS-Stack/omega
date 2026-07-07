/**
 * Calendar Renderer
 * Renders the toolbar and calendar grid for all view modes.
 * All dates/times are UTC. No local time APIs.
 */

import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import webManager from 'web-manager';
import { VIEW_MODES, DAY_ABBREVS, MONTH_NAMES, TYPE_COLORS, formatDateUTC, formatTimeUTC, parseDateUTC } from './calendar-core.js';

export default class CalendarRenderer {
  constructor(core) {
    this.core = core;
    this.$toolbar = document.getElementById('calendar-toolbar');
    this.$grid = document.getElementById('calendar-grid');
    this._nowLineInterval = null;
    this._resizeObserver = null;

    this._initResizeObserver();
  }

  _initResizeObserver() {
    this._resizeObserver = new ResizeObserver(() => {
      if (this.core.viewMode === 'month') {
        this._fitMonthEvents();
      }
    });
    this._resizeObserver.observe(this.$grid);
  }

  // ============================================
  // Main Render
  // ============================================
  render() {
    this._renderToolbar();
    this._renderGrid();
    this._startNowLine();
  }

  // ============================================
  // Toolbar
  // ============================================
  _renderToolbar() {
    const core = this.core;

    this.$toolbar.innerHTML = `
      <div class="calendar-toolbar-nav">
        <button type="button" class="btn btn-sm btn-outline-adaptive" data-calendar-nav="-1" title="Previous">
          ${getPrerenderedIcon('chevron-left', 'fa-sm')}
        </button>
        <button type="button" class="btn btn-sm btn-outline-adaptive" data-calendar-nav="1" title="Next">
          ${getPrerenderedIcon('chevron-right', 'fa-sm')}
        </button>
        <button type="button" class="btn btn-sm btn-outline-adaptive ms-1" data-calendar-today>
          Today
        </button>
      </div>
      <div class="calendar-toolbar-period">
        ${core.formatPeriodLabel()}
        <span class="calendar-toolbar-utc-clock">${this._formatUTCClock()}</span>
      </div>
      <div class="calendar-toolbar-views btn-group" role="group" aria-label="Calendar view">
        ${VIEW_MODES.map((mode) => `
          <button type="button"
                  class="btn btn-sm btn-outline-adaptive ${core.viewMode === mode ? 'active' : ''}"
                  data-calendar-view="${mode}">
            ${this._getViewIcon(mode)} ${mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        `).join('')}
      </div>
    `;

    this.$toolbar.querySelectorAll('[data-calendar-nav]').forEach(($btn) => {
      $btn.addEventListener('click', () => core.navigate(parseInt($btn.dataset.calendarNav, 10)));
    });

    this.$toolbar.querySelector('[data-calendar-today]').addEventListener('click', () => core.goToToday());

    this.$toolbar.querySelectorAll('[data-calendar-view]').forEach(($btn) => {
      $btn.addEventListener('click', () => core.setView($btn.dataset.calendarView));
    });
  }

  _getViewIcon(mode) {
    const icons = { day: 'calendar-day', week: 'calendar-week', month: 'calendar', year: 'grid-2', list: 'table-list' };
    return getPrerenderedIcon(icons[mode], 'fa-sm');
  }

  // ============================================
  // Grid Delegation
  // ============================================
  _renderGrid() {
    switch (this.core.viewMode) {
      case 'month': this._renderMonthView(); break;
      case 'week': this._renderWeekView(); break;
      case 'day': this._renderDayView(); break;
      case 'year': this._renderYearView(); break;
      case 'list': this._renderListView(); break;
    }
  }

  // ============================================
  // Month View
  // ============================================
  _renderMonthView() {
    this._pillHeight = null;
    const core = this.core;
    const cells = core.getMonthGrid();

    let html = '<div class="calendar-day-header">';
    DAY_ABBREVS.forEach((day) => { html += `<div>${day}</div>`; });
    html += '</div><div class="calendar-month">';

    cells.forEach((cell) => {
      const dateStr = formatDateUTC(cell.date);
      const isToday = core.isToday(cell.date);
      const campaigns = core.getCampaignsForDate(dateStr);

      let classes = 'calendar-cell';
      if (isToday) { classes += ' calendar-cell--today'; }
      if (cell.outside) { classes += ' calendar-cell--outside'; }

      html += `<div class="${classes}" data-date="${dateStr}">`;
      html += `<div class="calendar-cell-date">${cell.date.getUTCDate()}</div>`;
      html += '<div class="calendar-cell-events">';

      campaigns.forEach((c) => { html += this._renderEventPill(c); });
      if (campaigns.length > 0) {
        html += `<div class="calendar-cell-more" data-date="${dateStr}" style="display:none"></div>`;
      }

      html += '</div></div>';
    });
    html += '</div>';

    this.$grid.innerHTML = html;
    requestAnimationFrame(() => this._fitMonthEvents());
    this._bindCellClicks();
    this._bindCampaignClicks();
    this._bindDragAndDrop();
  }

  _fitMonthEvents() {
    // Measure natural pill height once from a detached clone so flex
    // compression doesn't skew the value
    if (!this._pillHeight) {
      const $sample = this.$grid.querySelector('.calendar-event');
      if ($sample) {
        const $clone = $sample.cloneNode(true);
        $clone.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
        document.body.appendChild($clone);
        this._pillHeight = $clone.getBoundingClientRect().height;
        $clone.remove();
      }
    }

    this.$grid.querySelectorAll('.calendar-cell').forEach(($cell) => {
      const $events = $cell.querySelector('.calendar-cell-events');
      if (!$events) { return; }

      const $pills = $events.querySelectorAll('.calendar-event');
      const $more = $events.querySelector('.calendar-cell-more');
      if ($pills.length === 0) { return; }

      // Hide everything first so the cell has its natural empty height
      $pills.forEach(($p) => { $p.style.display = 'none'; });
      if ($more) { $more.style.display = 'none'; }

      const cellRect = $cell.getBoundingClientRect();
      const eventsRect = $events.getBoundingClientRect();
      const available = cellRect.bottom - eventsRect.top;

      const pillHeight = this._pillHeight || 20;
      const gap = 1;

      // Measure "+more" line height
      if ($more) {
        $more.textContent = '+1 more';
        $more.style.display = '';
      }
      const moreLineHeight = $more ? $more.getBoundingClientRect().height + gap : 0;
      if ($more) { $more.style.display = 'none'; }

      // Calculate how many pills fit
      let maxVisible = 0;
      for (let n = 1; n <= $pills.length; n++) {
        const pillsHeight = n * pillHeight + (n - 1) * gap;
        const needsMore = n < $pills.length;
        const total = pillsHeight + (needsMore ? moreLineHeight : 0);
        if (total <= available) {
          maxVisible = n;
        } else {
          break;
        }
      }

      // Apply visibility
      $pills.forEach(($p, i) => {
        $p.style.display = i < maxVisible ? '' : 'none';
      });

      if ($more) {
        const hidden = $pills.length - maxVisible;
        if (hidden > 0) {
          $more.textContent = `+${hidden} more`;
          $more.style.display = '';
        }
      }
    });
  }

  // ============================================
  // Week View
  // ============================================
  _renderWeekView() {
    const core = this.core;
    const weekDates = core.getWeekDates();
    const hours = this._getHours();

    let html = '<div class="calendar-week-header"><div></div>';
    weekDates.forEach((date) => {
      const isToday = core.isToday(date);
      html += `<div class="calendar-week-header-cell ${isToday ? 'calendar-cell--today' : ''}">${DAY_ABBREVS[date.getUTCDay()]}<span class="calendar-week-header-date">${date.getUTCDate()}</span></div>`;
    });
    html += '</div>';

    html += '<div class="calendar-week-body"><div class="calendar-week-time-col">';
    hours.forEach((hour) => { html += `<div class="calendar-week-time-label">${hour.label}</div>`; });
    html += '</div>';

    weekDates.forEach((date) => {
      const dateStr = formatDateUTC(date);
      const campaigns = core.getCampaignsForDate(dateStr);

      html += `<div class="calendar-week-day-col" data-date="${dateStr}">`;
      hours.forEach((hour) => {
        html += `<div class="calendar-week-time-slot" data-date="${dateStr}" data-hour="${hour.value}"></div>`;
      });

      const layout = this._calculateOverlapLayout(campaigns);
      campaigns.forEach((c) => { html += this._renderTimeEvent(c, layout.get(c.id)); });
      html += '</div>';
    });

    html += '</div>';

    this.$grid.innerHTML = html;
    this._bindCellClicks();
    this._bindCampaignClicks();
    this._bindDragAndDrop();
  }

  // ============================================
  // Day View
  // ============================================
  _renderDayView() {
    const core = this.core;
    const dateStr = formatDateUTC(core.currentDate);
    const campaigns = core.getCampaignsForDate(dateStr);
    const hours = this._getHours();

    let html = '<div class="calendar-day-body"><div class="calendar-week-time-col">';
    hours.forEach((hour) => { html += `<div class="calendar-week-time-label">${hour.label}</div>`; });
    html += '</div>';

    html += `<div class="calendar-day-col" data-date="${dateStr}">`;
    hours.forEach((hour) => {
      html += `<div class="calendar-week-time-slot" data-date="${dateStr}" data-hour="${hour.value}"></div>`;
    });

    const layout = this._calculateOverlapLayout(campaigns);
    campaigns.forEach((c) => { html += this._renderTimeEvent(c, layout.get(c.id)); });
    html += '</div></div>';

    this.$grid.innerHTML = html;
    this._bindCellClicks();
    this._bindCampaignClicks();
    this._bindDragAndDrop();
  }

  // ============================================
  // Year View
  // ============================================
  _renderYearView() {
    const core = this.core;
    const year = core.currentDate.getUTCFullYear();

    let html = '<div class="calendar-year">';

    for (let month = 0; month < 12; month++) {
      html += `<div class="calendar-mini-month" data-month="${month}">`;
      html += `<div class="calendar-mini-month-title">${MONTH_NAMES[month]}</div>`;
      html += '<div class="calendar-mini-month-grid">';

      DAY_ABBREVS.forEach((day) => { html += `<div class="calendar-mini-day-header">${day.charAt(0)}</div>`; });

      const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
      const daysInMonth = core.getDaysInMonth(year, month);

      for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-mini-day calendar-cell--outside"></div>';
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(Date.UTC(year, month, d));
        const isToday = core.isToday(date);
        const hasCampaigns = core.getCampaignsForDate(formatDateUTC(date)).length > 0;

        let classes = 'calendar-mini-day';
        if (isToday) { classes += ' calendar-cell--today'; }
        if (hasCampaigns) { classes += ' has-events'; }
        html += `<div class="${classes}">${d}</div>`;
      }

      html += '</div></div>';
    }

    html += '</div>';
    this.$grid.innerHTML = html;

    this.$grid.querySelectorAll('.calendar-mini-month').forEach(($mini) => {
      $mini.addEventListener('click', () => {
        core.currentDate.setUTCMonth(parseInt($mini.dataset.month, 10));
        core.setView('month');
      });
    });
  }

  // ============================================
  // List View
  // ============================================
  _renderListView() {
    const core = this.core;
    const campaigns = core.getAllCampaignsSorted();

    if (campaigns.length === 0) {
      this.$grid.innerHTML = '<div class="calendar-list-empty"><div class="text-center"><p>No campaigns in this date range</p></div></div>';
      return;
    }

    let html = '<div class="calendar-list"><table>';
    let currentDateStr = null;

    campaigns.forEach((campaign) => {
      const dateStr = formatDateUTC(campaign.sendAt);

      if (dateStr !== currentDateStr) {
        currentDateStr = dateStr;
        const d = new Date(campaign.sendAt * 1000);
        const dayName = DAY_ABBREVS[d.getUTCDay()];
        const monthName = MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
        const isToday = core.isToday(d);
        const todayBadge = isToday ? ' <span class="badge bg-danger ms-2">Today</span>' : '';
        html += `<tr class="calendar-list-date-header"><td colspan="4">${dayName}, ${monthName} ${d.getUTCDate()}, ${d.getUTCFullYear()}${todayBadge}</td></tr>`;
      }

      const timeStr = this._formatLocalTime(campaign.sendAt);
      const name = (campaign.settings && campaign.settings.name) || 'Untitled';
      const statusStyle = core.campaignStatusStyle(campaign);
      const isRecurring = core.isRecurring(campaign);

      const typeBadge = campaign.type === 'email'
        ? `<span class="badge" style="background-color: ${TYPE_COLORS.email}">${getPrerenderedIcon('envelope', 'fa-xs me-1')} Email</span>`
        : `<span class="badge" style="background-color: ${TYPE_COLORS.push}">${getPrerenderedIcon('bell', 'fa-xs me-1')} Push</span>`;

      let statusBadge = '<span class="badge bg-secondary">Pending</span>';
      if (campaign.status === 'sent') {
        statusBadge = `<span class="badge bg-success">${getPrerenderedIcon('circle-check', 'fa-xs me-1')} Sent</span>`;
      } else if (campaign.status === 'failed') {
        statusBadge = `<span class="badge bg-danger">${getPrerenderedIcon('triangle-exclamation', 'fa-xs me-1')} Failed</span>`;
      }

      const recurringIcon = isRecurring ? getPrerenderedIcon('repeat', 'fa-xs me-1 text-muted') : '';

      html += `<tr class="calendar-list-row" data-campaign-id="${campaign.id}" style="opacity: ${statusStyle.opacity}">
        <td style="width: 60px">${timeStr}</td>
        <td>${recurringIcon}${webManager.utilities().escapeHTML(name)}</td>
        <td style="width: 80px">${typeBadge}</td>
        <td style="width: 80px">${statusBadge}</td>
      </tr>`;
    });

    html += '</table></div>';
    this.$grid.innerHTML = html;

    this.$grid.querySelectorAll('.calendar-list-row').forEach(($row) => {
      $row.addEventListener('click', (e) => {
        e.stopPropagation();
        core.eventsManager.openEditModal($row.dataset.campaignId);
      });
    });
  }

  // ============================================
  // Campaign Rendering Helpers
  // ============================================

  _renderEventPill(campaign) {
    const core = this.core;
    const timeStr = this._formatLocalTime(campaign.sendAt);
    const color = core.campaignColor(campaign);
    const statusStyle = core.campaignStatusStyle(campaign);
    const name = (campaign.settings && campaign.settings.name) || 'Untitled';
    const isDraggable = core.isEditable(campaign) || campaign._virtual;
    const isRecurring = core.isRecurring(campaign);
    const statusIcon = statusStyle.icon ? getPrerenderedIcon(statusStyle.icon, 'fa-xs') : '';
    const typeIcon = campaign.type === 'email'
      ? getPrerenderedIcon('envelope', 'fa-xs')
      : getPrerenderedIcon('bell', 'fa-xs');
    const recurringIcon = isRecurring ? getPrerenderedIcon('repeat', 'fa-xs') : '';

    let pillClass = 'calendar-event';
    if (campaign.status === 'failed') { pillClass += ' calendar-event--failed'; }
    if (campaign.status === 'sent') { pillClass += ' calendar-event--sent'; }
    if (campaign._virtual) { pillClass += ' calendar-event--virtual'; }
    if (isRecurring && !campaign._virtual) { pillClass += ' calendar-event--recurring'; }

    return `
      <div class="${pillClass}"
           data-campaign-id="${campaign.id}"
           data-send-at="${campaign.sendAt}"
           ${isDraggable ? 'draggable="true"' : ''}
           style="background-color: ${color}; opacity: ${statusStyle.opacity};"
           title="${webManager.utilities().escapeHTML(name)}${isRecurring ? ' (recurring)' : ''}">
        ${statusIcon}
        ${recurringIcon}
        <span class="calendar-event-time">${timeStr}</span>
        <span class="calendar-event-type-icon">${typeIcon}</span>
        <span class="calendar-event-title">${webManager.utilities().escapeHTML(name)}</span>
      </div>
    `;
  }

  _renderTimeEvent(campaign, layout) {
    const core = this.core;
    const utcTime = formatTimeUTC(campaign.sendAt);
    const [hours, minutes] = utcTime.split(':').map(Number);
    const topPx = (hours * 60 + minutes);
    const heightPx = Math.max(core.campaignDuration(), 15);
    const timeStr = this._formatLocalTime(campaign.sendAt);
    const color = core.campaignColor(campaign);
    const statusStyle = core.campaignStatusStyle(campaign);
    const name = (campaign.settings && campaign.settings.name) || 'Untitled';
    const isDraggable = core.isEditable(campaign) || campaign._virtual;
    const isRecurring = core.isRecurring(campaign);
    const statusIcon = statusStyle.icon ? getPrerenderedIcon(statusStyle.icon, 'fa-xs me-1') : '';
    const recurringIcon = isRecurring ? getPrerenderedIcon('repeat', 'fa-xs me-1') : '';

    const col = layout ? layout.col : 0;
    const totalCols = layout ? layout.totalCols : 1;
    const widthPct = 100 / totalCols;
    const leftPct = col * widthPct;
    const sizeStyle = totalCols > 1 ? `left: ${leftPct}%; width: calc(${widthPct}% - 2px);` : '';

    let eventClass = 'calendar-week-event';
    if (campaign.status === 'failed') { eventClass += ' calendar-event--failed'; }
    if (campaign.status === 'sent') { eventClass += ' calendar-event--sent'; }
    if (campaign._virtual) { eventClass += ' calendar-event--virtual'; }
    if (isRecurring && !campaign._virtual) { eventClass += ' calendar-event--recurring'; }

    return `
      <div class="${eventClass}"
           data-campaign-id="${campaign.id}"
           data-send-at="${campaign.sendAt}"
           ${isDraggable ? 'draggable="true"' : ''}
           style="background-color: ${color}; opacity: ${statusStyle.opacity}; top: ${topPx}px; height: ${heightPx}px; ${sizeStyle}"
           title="${webManager.utilities().escapeHTML(name)}${isRecurring ? ' (recurring)' : ''}">
        ${statusIcon}${recurringIcon}<strong>${timeStr}</strong> ${webManager.utilities().escapeHTML(name)}
      </div>
    `;
  }

  _calculateOverlapLayout(campaigns) {
    const layout = new Map();
    if (campaigns.length === 0) {
      return layout;
    }

    const duration = this.core.campaignDuration();

    const intervals = campaigns.map((c) => {
      const time = formatTimeUTC(c.sendAt);
      const [h, m] = time.split(':').map(Number);
      const start = h * 60 + m;
      return { id: c.id, start, end: start + duration };
    }).sort((a, b) => a.start - b.start || a.end - b.end);

    const clusters = [];
    let currentCluster = [intervals[0]];

    for (let i = 1; i < intervals.length; i++) {
      const clusterEnd = Math.max(...currentCluster.map((iv) => iv.end));
      if (intervals[i].start < clusterEnd) {
        currentCluster.push(intervals[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [intervals[i]];
      }
    }
    clusters.push(currentCluster);

    clusters.forEach((cluster) => {
      const columns = [];
      cluster.forEach((interval) => {
        let placed = false;
        for (let c = 0; c < columns.length; c++) {
          if (interval.start >= columns[c].end) {
            columns[c] = interval;
            layout.set(interval.id, { col: c, totalCols: 0 });
            placed = true;
            break;
          }
        }
        if (!placed) {
          layout.set(interval.id, { col: columns.length, totalCols: 0 });
          columns.push(interval);
        }
      });

      const totalCols = columns.length;
      cluster.forEach((interval) => { layout.get(interval.id).totalCols = totalCols; });
    });

    return layout;
  }

  // ============================================
  // Now Line (UTC)
  // ============================================
  _startNowLine() {
    clearInterval(this._nowLineInterval);
    clearInterval(this._clockInterval);
    this._updateUTCClock();
    this._clockInterval = setInterval(() => this._updateUTCClock(), 1000);
    if (this.core.viewMode !== 'day' && this.core.viewMode !== 'week' && this.core.viewMode !== 'month') {
      return;
    }
    this._updateNowLine();
    this._nowLineInterval = setInterval(() => this._updateNowLine(), 60000);
  }

  _updateNowLine() {
    this.$grid.querySelectorAll('.calendar-now-line').forEach(($el) => $el.remove());

    const now = new Date();
    const todayStr = formatDateUTC(now);
    const minutesSinceMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();

    // Week/day views: absolute position in px (1px per minute)
    const $cols = this.$grid.querySelectorAll(
      `.calendar-week-day-col[data-date="${todayStr}"], .calendar-day-col[data-date="${todayStr}"]`
    );

    $cols.forEach(($col) => {
      const $line = document.createElement('div');
      $line.className = 'calendar-now-line';
      $line.style.top = `${minutesSinceMidnight}px`;
      $col.appendChild($line);
    });

    // Month view: position on the grid container so the dot isn't clipped by cell overflow
    if (this.core.viewMode === 'month') {
      const $cell = this.$grid.querySelector(`.calendar-cell[data-date="${todayStr}"]`);
      if ($cell) {
        const gridRect = this.$grid.getBoundingClientRect();
        const cellRect = $cell.getBoundingClientRect();
        const pct = minutesSinceMidnight / 1440;
        const topPx = (cellRect.top - gridRect.top) + (cellRect.height * pct);

        const $line = document.createElement('div');
        $line.className = 'calendar-now-line';
        $line.style.top = `${topPx}px`;
        $line.style.left = `${cellRect.left - gridRect.left}px`;
        $line.style.width = `${cellRect.width}px`;
        this.$grid.appendChild($line);
      }
    }
  }

  // ============================================
  // Interaction Bindings
  // ============================================
  _bindCellClicks() {
    const core = this.core;
    let clickTimer = null;

    this.$grid.querySelectorAll('.calendar-cell').forEach(($cell) => {
      $cell.addEventListener('click', (e) => {
        if (e.target.closest('[data-campaign-id]')) { return; }
        const date = $cell.dataset.date;
        if (!date || core.viewMode !== 'month') { return; }
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          core.currentDate = parseDateUTC(date);
          core.setView('day');
        }, 250);
      });

      $cell.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-campaign-id]')) { return; }
        clearTimeout(clickTimer);
        const date = $cell.dataset.date;
        if (!date) { return; }
        core.eventsManager.openCreateModal(date, null);
      });
    });

    // Week/day view: single click → day view, double click → create event
    let slotClickTimer = null;

    this.$grid.querySelectorAll('.calendar-week-time-slot').forEach(($slot) => {
      $slot.addEventListener('click', (e) => {
        if (e.target.closest('[data-campaign-id]')) { return; }
        if (core.viewMode !== 'week') { return; }
        const date = $slot.dataset.date;
        if (!date) { return; }
        clearTimeout(slotClickTimer);
        slotClickTimer = setTimeout(() => {
          core.currentDate = parseDateUTC(date);
          core.setView('day');
        }, 250);
      });

      $slot.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-campaign-id]')) { return; }
        clearTimeout(slotClickTimer);
        const date = $slot.dataset.date;
        if (!date) { return; }
        const time = $slot.dataset.hour != null
          ? String($slot.dataset.hour).padStart(2, '0') + ':00'
          : null;
        core.eventsManager.openCreateModal(date, time);
      });
    });

    // Week header cells: click to go to day view
    this.$grid.querySelectorAll('.calendar-week-header-cell').forEach(($header) => {
      $header.style.cursor = 'pointer';
      $header.addEventListener('click', () => {
        // Find the matching date from the first time slot in that column
        const index = Array.from($header.parentElement.children).indexOf($header) - 1; // -1 for time gutter
        const weekDates = core.getWeekDates();
        if (index >= 0 && index < weekDates.length) {
          core.currentDate = weekDates[index];
          core.setView('day');
        }
      });
    });

    this.$grid.querySelectorAll('.calendar-cell-more').forEach(($more) => {
      $more.addEventListener('click', (e) => {
        e.stopPropagation();
        core.currentDate = parseDateUTC($more.dataset.date);
        core.setView('day');
      });
    });
  }

  _bindCampaignClicks() {
    this.$grid.querySelectorAll('[data-campaign-id]').forEach(($pill) => {
      $pill.addEventListener('click', (e) => {
        e.stopPropagation();
        this.core.eventsManager.openEditModal($pill.dataset.campaignId);
      });
    });
  }

  _bindDragAndDrop() {
    const core = this.core;

    // Drag start
    this.$grid.querySelectorAll('[data-campaign-id][draggable]').forEach(($pill) => {
      $pill.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', `${$pill.dataset.campaignId}|${$pill.dataset.sendAt}`);
        e.dataTransfer.effectAllowed = 'move';
        $pill.classList.add('calendar-event--dragging');
        requestAnimationFrame(() => { this.$grid.classList.add('calendar-grid--dragging'); });
      });

      $pill.addEventListener('dragend', () => {
        $pill.classList.remove('calendar-event--dragging');
        this.$grid.classList.remove('calendar-grid--dragging');
        this.$grid.querySelectorAll('.calendar-cell--drag-over').forEach(($el) => $el.classList.remove('calendar-cell--drag-over'));
      });
    });

    // Drop targets
    const $dropTargets = this.$grid.querySelectorAll('.calendar-cell, .calendar-week-time-slot');
    $dropTargets.forEach(($cell) => {
      $cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        $cell.classList.add('calendar-cell--drag-over');
      });

      $cell.addEventListener('dragleave', () => $cell.classList.remove('calendar-cell--drag-over'));

      $cell.addEventListener('drop', (e) => {
        e.preventDefault();
        $cell.classList.remove('calendar-cell--drag-over');

        const dragData = e.dataTransfer.getData('text/plain');
        const targetDateStr = $cell.dataset.date;
        if (!dragData || !targetDateStr) { return; }

        const [campaignId, dragSendAtStr] = dragData.split('|');
        const dragSendAt = parseInt(dragSendAtStr, 10);
        if (!campaignId || !dragSendAt) { return; }

        const campaign = core.getCampaign(campaignId);
        if (!campaign) { return; }

        // Pure unix math: calculate day shift
        const dragDateStr = formatDateUTC(dragSendAt);
        const fromDayUTC = parseDateUTC(dragDateStr).getTime() / 1000;
        const toDayUTC = parseDateUTC(targetDateStr).getTime() / 1000;
        const dayShift = toDayUTC - fromDayUTC;

        // New sendAt = old + day shift (keeps same time-of-day)
        let newSendAtUNIX = dragSendAt + dayShift;

        // If dropped on a time slot, override the hour (UTC)
        if ($cell.dataset.hour != null) {
          const timeOfDay = dragSendAt - fromDayUTC;
          newSendAtUNIX = newSendAtUNIX - timeOfDay + (parseInt($cell.dataset.hour) * 3600);
        }

        // Virtual recurring: shift the template's seed
        if (campaign._virtual) {
          const templateId = campaign._recurringSourceId;
          const template = core.getCampaign(templateId);
          if (!template) { return; }

          let templateNewSendAt = template.sendAt + dayShift;
          if ($cell.dataset.hour != null) {
            const templateDayUTC = parseDateUTC(formatDateUTC(template.sendAt)).getTime() / 1000;
            const templateTimeOfDay = template.sendAt - templateDayUTC;
            templateNewSendAt = templateNewSendAt - templateTimeOfDay + (parseInt($cell.dataset.hour) * 3600);
          }

          core.eventsManager.rescheduleRecurring(templateId, campaign, templateNewSendAt)
            .catch((err) => console.error('Failed to reschedule recurring campaign:', err));
          return;
        }

        // One-off: only editable campaigns
        if (!core.isEditable(campaign)) { return; }

        const rollback = core.optimisticUpdateSendAt(campaignId, newSendAtUNIX);
        const newSendAtISO = new Date(newSendAtUNIX * 1000).toISOString();

        core.eventsManager.rescheduleCampaign(campaignId, newSendAtISO)
          .catch((err) => {
            console.error('Failed to reschedule campaign:', err);
            if (rollback) { rollback(); }
          });
      });
    });
  }

  // ============================================
  // Utility
  // ============================================
  _getHours() {
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const period = h >= 12 ? 'PM' : 'AM';
      const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
      hours.push({ value: h, label: `${display} ${period}` });
    }
    return hours;
  }

  _formatUTCClock() {
    const now = new Date();
    const h = now.getUTCHours();
    const m = now.getUTCMinutes();
    const s = now.getUTCSeconds();
    const period = h >= 12 ? 'p' : 'a';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${period} UTC`;
  }

  _updateUTCClock() {
    const $clock = this.$toolbar.querySelector('.calendar-toolbar-utc-clock');
    if ($clock) {
      $clock.textContent = this._formatUTCClock();
    }
  }

  _formatTime(timeStr) {
    if (!timeStr) { return ''; }
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'p' : 'a';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}${m > 0 ? ':' + String(m).padStart(2, '0') : ''}${period}`;
  }

  _formatLocalTime(sendAt) {
    const d = new Date(sendAt * 1000);
    const h = d.getHours();
    const m = d.getMinutes();
    const period = h >= 12 ? 'p' : 'a';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}${m > 0 ? ':' + String(m).padStart(2, '0') : ''}${period}`;
  }
}

