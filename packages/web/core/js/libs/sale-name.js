/**
 * Sale Name Helper
 * Determines the best sale/promotion name based on the current date
 *
 * Holiday precedence rules:
 * - Each holiday has a "core" date (the actual holiday)
 * - Promo window extends 1 week before and 3 days after the core date
 * - A new holiday only takes precedence AFTER the previous holiday's core date has passed
 * - Example: Black Friday promo runs until Black Friday ends, then Cyber Monday takes over
 */

// Configuration
const DAYS_BEFORE = 7;
const DAYS_AFTER = 3;

/**
 * Holiday definitions
 * Each holiday defines how to calculate its core date for a given year
 */
const HOLIDAYS = [
  {
    name: 'Black Friday',
    getCoreDate: (year) => {
      // 4th Thursday of November + 1 day (Friday)
      const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4);
      const blackFriday = new Date(thanksgiving);
      blackFriday.setDate(blackFriday.getDate() + 1);
      return blackFriday;
    }
  },
  {
    name: 'Cyber Monday',
    getCoreDate: (year) => {
      // Monday after Thanksgiving (4 days after Thursday)
      const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4);
      const cyberMonday = new Date(thanksgiving);
      cyberMonday.setDate(cyberMonday.getDate() + 4);
      return cyberMonday;
    }
  },
  {
    name: 'Christmas',
    getCoreDate: (year) => new Date(year, 11, 25)
  },
  {
    name: 'Easter',
    getCoreDate: (year) => calculateEaster(year)
  }
];

// Season definitions
const SEASONS = [
  { name: 'Winter', months: [11, 0, 1], endMonth: 1, endDay: 28 },
  { name: 'Spring', months: [2, 3, 4], endMonth: 4, endDay: 31 },
  { name: 'Summer', months: [5, 6, 7], endMonth: 7, endDay: 31 },
  { name: 'Fall', months: [8, 9, 10], endMonth: 10, endDay: 30 }
];

/**
 * Get the nth occurrence of a weekday in a month
 * @param {number} year - Year
 * @param {number} month - Month (0-indexed)
 * @param {number} n - Which occurrence (1-5)
 * @param {number} weekday - Day of week (0=Sunday, 4=Thursday)
 * @returns {Date}
 */
function getNthWeekdayOfMonth(year, month, n, weekday) {
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  let dayOffset = weekday - firstWeekday;

  if (dayOffset < 0) {
    dayOffset += 7;
  }

  const nthDay = 1 + dayOffset + (n - 1) * 7;
  return new Date(year, month, nthDay);
}

/**
 * Calculate Easter Sunday for a given year (Anonymous Gregorian algorithm)
 * @param {number} year
 * @returns {Date}
 */
function calculateEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month, day);
}

/**
 * Get the promo window for a holiday
 * @param {Date} coreDate - The actual holiday date
 * @returns {object} Object with promoStart, coreDate, and promoEnd
 */
function getHolidayWindow(coreDate) {
  const promoStart = new Date(coreDate);
  promoStart.setDate(promoStart.getDate() - DAYS_BEFORE);
  promoStart.setHours(0, 0, 0, 0);

  const promoEnd = new Date(coreDate);
  promoEnd.setDate(promoEnd.getDate() + DAYS_AFTER);
  promoEnd.setHours(23, 59, 59, 999);

  // Core date end of day
  const coreDateEnd = new Date(coreDate);
  coreDateEnd.setHours(23, 59, 59, 999);

  return {
    promoStart,
    coreDate: new Date(coreDate),
    coreDateEnd,
    promoEnd
  };
}

/**
 * Get all holidays with their windows for the relevant years
 * @param {Date} date
 * @returns {Array} Sorted array of holiday objects with windows
 */
function getHolidaysWithWindows(date) {
  const year = date.getFullYear();
  const yearsToCheck = [year - 1, year, year + 1];
  const holidays = [];

  for (const checkYear of yearsToCheck) {
    for (const holiday of HOLIDAYS) {
      const coreDate = holiday.getCoreDate(checkYear);
      const window = getHolidayWindow(coreDate);

      holidays.push({
        name: holiday.name,
        ...window
      });
    }
  }

  // Sort by core date
  return holidays.sort((a, b) => a.coreDate - b.coreDate);
}

/**
 * Get the current season based on date
 * @param {Date} date
 * @returns {object|null} Season object with name, progress, and isEndOfSeason
 */
function getCurrentSeason(date) {
  const month = date.getMonth();
  const season = SEASONS.find(s => s.months.includes(month));

  if (!season) {
    return null;
  }

  const year = date.getFullYear();

  // Handle winter spanning year boundary
  let startYear = year;
  if (season.name === 'Winter' && month <= 1) {
    startYear = year - 1;
  }

  const seasonStartDate = new Date(startYear, season.months[0], 1);

  // For winter end date, use next year if starting month is December
  let endYear = year;
  if (season.name === 'Winter' && season.months[0] === 11) {
    endYear = year + 1;
  }

  const seasonEndDate = new Date(endYear, season.endMonth, season.endDay, 23, 59, 59);
  const seasonDuration = seasonEndDate - seasonStartDate;
  const progress = (date - seasonStartDate) / seasonDuration;
  const isEndOfSeason = progress >= 0.7;

  return {
    name: season.name,
    progress,
    isEndOfSeason,
    startDate: seasonStartDate,
    endDate: seasonEndDate
  };
}

/**
 * Get the best sale name for a given date
 *
 * Logic:
 * 1. Find all holidays where we're in their promo window (1 week before to 3 days after)
 * 2. If multiple holidays overlap, the one whose core date has NOT yet passed takes precedence
 * 3. Once a holiday's core date passes, the next holiday can take over
 *
 * @param {Date} [date=new Date()] - Date to check (defaults to now)
 * @returns {object} Object with saleName, endDate, and type
 */
export function getSaleName(date = new Date()) {
  const holidays = getHolidaysWithWindows(date);

  // Find all holidays where we're in their promo window
  const activeHolidays = holidays.filter(h =>
    date >= h.promoStart && date <= h.promoEnd
  );

  if (activeHolidays.length > 0) {
    // Find the best holiday to show
    // Priority: The holiday whose core date hasn't passed yet, or if all have passed, the most recent one
    let bestHoliday = null;

    // First, try to find a holiday whose core date hasn't passed
    for (const holiday of activeHolidays) {
      if (date <= holiday.coreDateEnd) {
        bestHoliday = holiday;
        break;
      }
    }

    // If all core dates have passed, use the one with the latest core date
    // (we're in the "3 days after" window of the most recent holiday)
    if (!bestHoliday) {
      bestHoliday = activeHolidays[activeHolidays.length - 1];
    }

    return {
      saleName: `${bestHoliday.name} Sale`,
      endDate: bestHoliday.promoEnd,
      coreDate: bestHoliday.coreDate,
      type: 'holiday'
    };
  }

  // Fall back to season
  const season = getCurrentSeason(date);

  if (!season) {
    return {
      saleName: 'Sale',
      endDate: null,
      type: 'generic'
    };
  }

  const saleName = season.isEndOfSeason
    ? `End of ${season.name} Sale`
    : `${season.name} Sale`;

  return {
    saleName,
    endDate: season.endDate,
    type: 'season'
  };
}

/**
 * Get all upcoming sales/holidays within a date range
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array} Array of sale objects sorted by start date
 */
export function getUpcomingSales(startDate = new Date(), endDate = null) {
  if (!endDate) {
    endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
  }

  const holidays = getHolidaysWithWindows(startDate);

  return holidays
    .filter(h => h.promoStart >= startDate && h.promoStart <= endDate)
    .map(h => ({
      saleName: `${h.name} Sale`,
      startDate: h.promoStart,
      coreDate: h.coreDate,
      endDate: h.promoEnd,
      type: 'holiday'
    }));
}

export default {
  getSaleName,
  getUpcomingSales
};