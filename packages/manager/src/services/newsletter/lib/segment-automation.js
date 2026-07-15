/**
 * Beehiiv segment creation via the companion Chrome extension — Beehiiv
 * has NO segment-create API, so the manager drives the dashboard UI
 * itself through trusted CDP events (AutomationClient ↔ extension/).
 * The evaluate() bodies are the battle-tested omega-manager selectors:
 * Beehiiv duplicates IDs across condition rows, so every lookup targets
 * the LAST matching element; React inputs are set through the native
 * value setter + synthetic input/change events.
 *
 * Also home to the segment display helpers (OP_DISPLAY/formatCondition)
 * shared by the verify output in ensure/segments.js.
 */
const chalk = require('chalk').default;
const { BACKEND_FIELDS_MAP } = require('../../../lib/backend-marketing.js');

// Operator → human-readable phrasing for the dashboard instructions
const OP_DISPLAY = {
  '==': 'is',
  '!=': 'is not',
  'within': 'within last',
  'not_within': 'NOT within last',
  'email_is': 'email is',
  'email_like': 'email matches',
  'opened_or_clicked': 'opened or clicked within last',
  'not_opened': 'not opened in last',
  'not_opened_or_clicked': 'not opened or clicked in last',
  'not_clicked': 'not clicked in last',
  'received_gte': 'received at least',
};

/**
 * Format a single condition as a human-readable string.
 */
function formatCondition(condition) {
  if (condition.type === 'engagement' || condition.type === 'contact') {
    return `${OP_DISPLAY[condition.op] || condition.op} ${condition.value}`;
  }

  const fieldDef = BACKEND_FIELDS_MAP[condition.field];
  const fieldName = fieldDef?.display || condition.field;
  return `${fieldName} ${OP_DISPLAY[condition.op] || condition.op} "${condition.value}"`;
}

/**
 * Map a @omega.js/backend operator to the Beehiiv dropdown text.
 */
function beehiivOperator(op) {
  switch (op) {
    case '==': return 'is';
    case '!=': return 'is not';
    default: return null;
  }
}

/**
 * Create a single segment in Beehiiv via browser automation.
 *
 * Flow:
 *   1. Navigate to /segments/new, pick the "dynamic" type
 *   2. Type the segment name, proceed to "Define conditions"
 *   3. For each condition: + Condition → type → attribute/engagement
 *      selectors → operator → value (engagement time windows via Refine)
 *   4. Save the segment
 *
 * Throws on any step it can't complete (including not_within conditions,
 * which need a manual "Signup date" attribute — the throw carries the
 * exact dashboard steps).
 *
 * @param {AutomationClient} client - Connected automation client
 * @param {Object} segment - @omega.js/backend segment ({ name, display, conditions, logic })
 */
async function automateCreateSegment(client, segment) {
  const log = (msg) => console.log(`        ${chalk.dim(msg)}`);

  // Step 1: Navigate to new segment page
  log('Navigating to /segments/new...');
  await client.navigate('https://app.beehiiv.com/segments/new');
  await client.wait({ delay: 2000 });

  // Step 2: Select "dynamic" segment type (page shows static/dynamic/manual selection first)
  log('Selecting dynamic segment type...');
  const typeResult = await client.evaluate(`(() => {
    // Click the "dynamic" button by its value attribute
    const dynamicBtn = document.querySelector('button[value="dynamic"]');
    if (dynamicBtn) { dynamicBtn.click(); return { clicked: true, method: 'value' }; }
    // Fallback: find by text content
    const buttons = [...document.querySelectorAll('button')];
    const match = buttons.find(b => b.textContent.toLowerCase().includes('dynamic'));
    if (match) { match.click(); return { clicked: true, method: 'text' }; }
    return { clicked: false, buttons: buttons.map(b => b.textContent.trim().slice(0, 30)) };
  })()`);
  log(`Segment type: ${JSON.stringify(typeResult.value)}`);

  if (!typeResult.value?.clicked) {
    throw new Error('Could not find "dynamic" segment type button');
  }
  await client.wait({ delay: 1000 });

  // Step 3: Type segment name using trusted key events
  log('Typing segment name...');
  const nameSelector = '#text-input-name';
  await client.wait({ selector: nameSelector, timeout: 5000, visible: true });
  await client.click(nameSelector);
  await client.type(nameSelector, segment.name, { clear: true, delay: 20 });
  log(`Typed name: ${segment.name}`);
  await client.wait({ delay: 1000 });

  // Step 4: Click "Define conditions" to proceed to conditions step
  log('Clicking "Define conditions"...');
  const defineResult = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const btn = buttons.find(b => b.textContent.trim().includes('Define conditions'));
    if (!btn) return { found: false, buttons: buttons.map(b => b.textContent.trim()).filter(t => t.length < 40 && t.length > 0) };
    if (btn.disabled) return { found: true, disabled: true };
    btn.click();
    return { clicked: true };
  })()`);
  log(`Define conditions: ${JSON.stringify(defineResult.value)}`);

  if (defineResult.value?.disabled) {
    throw new Error('"Define conditions" button is disabled — name input may not have registered');
  }
  if (!defineResult.value?.clicked) {
    throw new Error(`Could not find "Define conditions" button. Available: ${JSON.stringify(defineResult.value?.buttons)}`);
  }
  await client.wait({ delay: 1500 });

  // Expand compound conditions — not_opened_or_clicked becomes two Beehiiv rows
  const expandedConditions = segment.conditions.flatMap((c) => {
    if (c.type === 'engagement' && c.op === 'not_opened_or_clicked') {
      return [
        { ...c, op: 'not_opened' },
        { ...c, op: 'not_clicked' },
      ];
    }
    return [c];
  });

  // Step 5: Add each condition
  // All selectors target the LAST matching element because Beehiiv
  // duplicates IDs and selectors across condition rows.
  for (let i = 0; i < expandedConditions.length; i++) {
    const condition = expandedConditions[i];

    log(`Adding condition ${i + 1}: ${formatCondition(condition)}`);

    // Beehiiv's condition builder has no relative "NOT within" operator on
    // custom date fields — it needs the built-in "Signup date" attribute,
    // which the automation can't reach reliably. Throw with the manual steps.
    if (condition.op === 'not_within') {
      const days = parseInt(condition.value, 10);
      throw new Error(
        `"${segment.display}" needs a manual condition in Beehiiv:\n`
        + `      1. Subscriber data → Attribute → Signup date\n`
        + `      2. Operator: is on or before\n`
        + `      3. Value: a relative date → ${days} days ago`,
      );
    }

    const isEngagement = condition.type === 'engagement';
    const isDateCondition = condition.op === 'within';

    // 5a: Click "+ Condition"
    const addResult = await client.evaluate(`(() => {
      const els = [...document.querySelectorAll('button, div[role="button"], span, a')];
      const addBtn = els.find(b => {
        const t = b.textContent.trim();
        return t === '+ Condition' || t === 'Condition' || t === '+ Add Condition';
      }) || els.find(b => {
        const t = b.textContent.trim();
        return t.includes('Condition') && !t.includes('group') && t.length < 25;
      });
      if (addBtn) { addBtn.click(); return { clicked: true, text: addBtn.textContent.trim() }; }
      return { clicked: false };
    })()`);
    log(`+ Condition: ${JSON.stringify(addResult.value)}`);
    if (!addResult.value?.clicked) throw new Error('Could not find "+ Condition" button');
    await client.wait({ delay: 1500 });

    // 5b: Select condition type from dropdown
    const conditionType = isEngagement ? 'Engagement' : 'Attribute';
    const typePickResult = await client.evaluate(`(() => {
      const items = [...document.querySelectorAll('li[role="option"]')];
      const matches = items.filter(i => i.textContent.trim() === ${JSON.stringify(conditionType)});
      const match = matches[matches.length - 1];
      if (match) { match.click(); return { clicked: true }; }
      return { clicked: false, options: items.map(i => i.textContent.trim()) };
    })()`);
    log(`${conditionType}: ${JSON.stringify(typePickResult.value)}`);
    if (!typePickResult.value?.clicked) throw new Error(`Could not find "${conditionType}"`);
    await client.wait({ delay: 1500 });

    if (isEngagement) {
      // === ENGAGEMENT CONDITION FLOW ===
      // Parameterized: metric, operator, value, and optional time window (Refine)
      let metric, engOp, engValue, refineDays;

      switch (condition.op) {
        case 'not_opened':
          metric = 'Unique opens';
          engOp = 'is exactly';
          engValue = '0';
          refineDays = parseInt(condition.value, 10);
          break;
        case 'not_clicked':
          metric = 'Unique clicks';
          engOp = 'is exactly';
          engValue = '0';
          refineDays = parseInt(condition.value, 10);
          break;
        case 'opened_or_clicked':
          metric = 'Unique opens';
          engOp = 'is greater than';
          engValue = '0';
          refineDays = parseInt(condition.value, 10);
          break;
        case 'received_gte': {
          metric = 'Unique sends';
          engOp = 'is greater than';
          engValue = String(parseInt(condition.value, 10) - 1);
          refineDays = null;
          break;
        }
        default:
          throw new Error(`Unsupported Beehiiv engagement op "${condition.op}"`);
      }

      // 5c-eng: Open "Select engagement" dropdown → select metric
      log(`Opening "Select engagement" dropdown → ${metric}...`);
      await client.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
        const matches = buttons.filter(b => b.textContent.includes('Select engagement'));
        const btn = matches[matches.length - 1];
        if (btn) btn.click();
        return { clicked: !!btn };
      })()`);
      await client.wait({ delay: 1000 });

      await client.evaluate(`(() => {
        const items = [...document.querySelectorAll('li[role="option"]')];
        const match = items.find(i => i.textContent.trim() === ${JSON.stringify(metric)});
        if (match) match.click();
        return { clicked: !!match, options: items.map(i => i.textContent.trim()) };
      })()`);
      log(`Selected "${metric}"`);
      await client.wait({ delay: 1500 });

      // 5d-eng: Set operator
      log(`Setting operator "${engOp}"...`);
      await client.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
        const matches = buttons.filter(b => {
          const t = b.textContent.trim().toLowerCase();
          return t.includes('is exactly') || t.includes('is greater') || t.includes('is less') || t.includes('is not');
        });
        const btn = matches[matches.length - 1];
        if (btn) btn.click();
        return { clicked: !!btn, text: btn?.textContent?.trim() };
      })()`);
      await client.wait({ delay: 1000 });

      await client.evaluate(`(() => {
        const items = [...document.querySelectorAll('li[role="option"]')];
        const match = items.find(i => i.textContent.trim() === ${JSON.stringify(engOp)});
        if (match) match.click();
        return { clicked: !!match };
      })()`);
      log(`Operator set to "${engOp}"`);
      await client.wait({ delay: 1000 });

      // 5e-eng: Type value
      log(`Typing value "${engValue}"...`);
      await client.evaluate(`(() => {
        const inputs = [...document.querySelectorAll('input[name="value"], #text-input-value, input[type="number"]')];
        const target = inputs[inputs.length - 1];
        if (!target) return { typed: false };
        target.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(target, ${JSON.stringify(engValue)});
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { typed: true };
      })()`);
      await client.wait({ delay: 1000 });

      // 5f-eng: Click "Refine" and set time window (skip for all-time conditions like received_gte)
      if (refineDays) {
        log(`Clicking Refine and setting time window: ${refineDays} days...`);
        await client.evaluate(`(() => {
          const buttons = [...document.querySelectorAll('button[title="Refine"]')];
          const btn = buttons[buttons.length - 1];
          if (btn) btn.click();
          return { clicked: !!btn };
        })()`);
        await client.wait({ delay: 1500 });

        await client.evaluate(`(() => {
          const inputs = [...document.querySelectorAll('input[type="number"][name="value"], #text-input-value')];
          const target = inputs[inputs.length - 1];
          if (!target) return { typed: false };
          target.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(target, '${refineDays}');
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return { typed: true };
        })()`);
        log(`Time window set: ${refineDays} days`);
        await client.wait({ delay: 1000 });
      }

    } else if (condition.type === 'contact') {
      // === CONTACT CONDITION FLOW (e.g., email_is) ===
      // Select "Email" from the "Select attribute" dropdown, then operator + value

      // 5c-contact: Open "Select attribute" dropdown → select "Email"
      log('Selecting Email attribute...');
      await client.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
        const matches = buttons.filter(b => b.textContent.includes('Select attribute'));
        const btn = matches[matches.length - 1];
        if (btn) btn.click();
        return { clicked: !!btn };
      })()`);
      await client.wait({ delay: 1000 });

      await client.evaluate(`(() => {
        const items = [...document.querySelectorAll('li[role="option"]')];
        const matches = items.filter(i => i.textContent.trim() === 'Email');
        const match = matches[matches.length - 1];
        if (match) match.click();
        return { clicked: !!match };
      })()`);
      log('Selected "Email"');
      await client.wait({ delay: 1500 });

      // 5d-contact: Set operator if needed (default is "is")
      const contactOp = condition.op === 'email_is' ? 'is' : 'is not';
      if (contactOp !== 'is') {
        log(`Changing operator to "${contactOp}"...`);
        await client.evaluate(`(() => {
          const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
          const matches = buttons.filter(b => {
            const t = b.textContent.trim().toLowerCase();
            return t === 'is' || t === 'is not' || t === 'contains';
          });
          const btn = matches[matches.length - 1];
          if (btn) btn.click();
          return { clicked: !!btn };
        })()`);
        await client.wait({ delay: 1000 });

        await client.evaluate(`(() => {
          const items = [...document.querySelectorAll('li[role="option"]')];
          const match = items.find(i => i.textContent.trim().toLowerCase() === ${JSON.stringify(contactOp)});
          if (match) match.click();
          return { clicked: !!match };
        })()`);
        await client.wait({ delay: 1000 });
      }

      // 5e-contact: Type the value
      log(`Typing value "${condition.value}"...`);
      await client.evaluate(`(() => {
        const inputs = [...document.querySelectorAll('input[name="value"][placeholder="Set a value"], #text-input-value')];
        const target = inputs[inputs.length - 1];
        if (!target) return { typed: false };
        target.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(target, ${JSON.stringify(condition.value)});
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { typed: true };
      })()`);
      log('Value typed');
      await client.wait({ delay: 1000 });

    } else {
      // === ATTRIBUTE CONDITION FLOW (Custom field) ===

      // 5c: Open "Select attribute" dropdown → select "Custom field"
      log('Selecting Custom field...');
      await client.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
        const matches = buttons.filter(b => b.textContent.includes('Select attribute'));
        const btn = matches[matches.length - 1];
        if (btn) btn.click();
        return { clicked: !!btn };
      })()`);
      await client.wait({ delay: 1000 });

      const customFieldResult = await client.evaluate(`(() => {
        const items = [...document.querySelectorAll('li[role="option"]')];
        const matches = items.filter(i => i.textContent.trim() === 'Custom field');
        const cf = matches[matches.length - 1];
        if (cf) { cf.click(); return { clicked: true }; }
        return { clicked: false, options: items.map(i => i.textContent.trim()) };
      })()`);
      log(`Custom field: ${JSON.stringify(customFieldResult.value)}`);
      if (!customFieldResult.value?.clicked) throw new Error('Could not find "Custom field"');
      await client.wait({ delay: 1500 });

      // 5d: Open "Select a Custom Field" dropdown → select the field by display name
      const fieldDef = BACKEND_FIELDS_MAP[condition.field];
      const fieldDisplay = fieldDef?.display || condition.field;
      log(`Selecting "${fieldDisplay}"...`);

      await client.evaluate(`(() => {
        const inputs = [...document.querySelectorAll('input[name="custom_field"]')];
        const target = inputs[inputs.length - 1];
        if (target) {
          const wrapper = target.closest('div[role="button"]');
          if (wrapper) wrapper.click(); else { target.click(); target.focus(); }
        }
        return { clicked: !!target };
      })()`);
      await client.wait({ delay: 2000 });

      const fieldResult = await client.evaluate(`(() => {
        const items = [...document.querySelectorAll('li[role="option"]')];
        const match = items.find(i => i.textContent.trim() === ${JSON.stringify(fieldDisplay)});
        if (match) { match.click(); return { clicked: true }; }
        return { clicked: false, options: items.map(i => i.textContent.trim()).slice(0, 20) };
      })()`);
      log(`Field: ${JSON.stringify(fieldResult.value)}`);
      if (!fieldResult.value?.clicked) throw new Error(`Could not find field "${fieldDisplay}"`);
      await client.wait({ delay: 1500 });

      if (isDateCondition) {
        // === DATE CONDITION FLOW ===
        // After selecting a date field, Beehiiv shows:
        //   1. Operator dropdown (is after / is on or after / is before / is on or before)
        //   2. Date type dropdown (a specific date / a relative date)
        //   3. Value input (number) + unit dropdown (days/weeks/months)

        // 5e-date: Select operator "is on or after" (LAST operator dropdown)
        log('Setting date operator "is on or after"...');
        await client.evaluate(`(() => {
          const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
          const matches = buttons.filter(b => {
            const t = b.textContent.trim().toLowerCase();
            return t.includes('is after') || t.includes('is before') || t.includes('is on or') || t === 'select an option';
          });
          const btn = matches[matches.length - 1];
          if (btn) btn.click();
          return { clicked: !!btn };
        })()`);
        await client.wait({ delay: 1000 });

        await client.evaluate(`(() => {
          const items = [...document.querySelectorAll('li[role="option"]')];
          const match = items.find(i => i.textContent.trim() === 'is on or after');
          if (match) match.click();
          return { clicked: !!match };
        })()`);
        await client.wait({ delay: 1500 });

        // 5f-date: Select "a relative date" (LAST date type dropdown)
        log('Selecting "a relative date"...');
        await client.evaluate(`(() => {
          const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
          const matches = buttons.filter(b => {
            const t = b.textContent.trim().toLowerCase();
            return t.includes('specific date') || t.includes('relative date');
          });
          const btn = matches[matches.length - 1];
          if (btn) btn.click();
          return { clicked: !!btn };
        })()`);
        await client.wait({ delay: 1000 });

        await client.evaluate(`(() => {
          const items = [...document.querySelectorAll('li[role="option"]')];
          const match = items.find(i => i.textContent.trim() === 'a relative date');
          if (match) match.click();
          return { clicked: !!match };
        })()`);
        await client.wait({ delay: 1500 });

        // 5g-date: Parse days from value (e.g., "90d" → 90) and type into number input
        const days = parseInt(condition.value, 10);
        log(`Typing relative days: ${days}...`);
        await client.evaluate(`(() => {
          const inputs = [...document.querySelectorAll('input[type="number"], input[type="text"]')];
          // Find the last number-like input (for relative date value)
          const target = inputs.filter(i => i.placeholder?.toLowerCase().includes('number') || i.type === 'number').pop()
            || inputs[inputs.length - 1];
          if (target) {
            target.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(target, '${days}');
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { typed: !!target };
        })()`);
        await client.wait({ delay: 1000 });

      } else {
        // === TEXT FIELD CONDITION FLOW ===

        // 5e: Set operator if we need "is not" (default is "is")
        const opText = beehiivOperator(condition.op);
        if (opText && opText !== 'is') {
          log(`Changing operator to "${opText}"...`);
          await client.evaluate(`(() => {
            const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
            const matches = buttons.filter(b => {
              const t = b.textContent.trim().toLowerCase();
              return t === 'is' || t === 'is not';
            });
            const opBtn = matches[matches.length - 1];
            if (opBtn) opBtn.click();
            return { clicked: !!opBtn };
          })()`);
          await client.wait({ delay: 1000 });

          await client.evaluate(`(() => {
            const items = [...document.querySelectorAll('li[role="option"]')];
            const match = items.find(i => i.textContent.trim().toLowerCase() === ${JSON.stringify(opText)});
            if (match) match.click();
            return { clicked: !!match };
          })()`);
          await client.wait({ delay: 1000 });
        }

        // 5f: Type value into the LAST value input
        log(`Typing value "${condition.value}"...`);
        await client.evaluate(`(() => {
          const inputs = [...document.querySelectorAll('input[name="value"][placeholder="Set a value"], #text-input-value')];
          const target = inputs[inputs.length - 1];
          if (target) { target.focus(); target.click(); }
          return { focused: !!target };
        })()`);
        await client.wait({ delay: 300 });
        await client.evaluate(`(() => {
          const inputs = [...document.querySelectorAll('input[name="value"][placeholder="Set a value"], #text-input-value')];
          const target = inputs[inputs.length - 1];
          if (!target) return { typed: false };
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(target, ${JSON.stringify(condition.value)});
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return { typed: true };
        })()`);
        log('Value typed');
      }

    } // end condition-type branches

    await client.wait({ delay: 1000 });
  }

  // Step 6: Click "Save segment"
  log('Clicking "Save segment"...');
  await client.wait({ delay: 1500 });
  const saveResult = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const saveBtn = buttons.find(b => {
      const t = b.textContent.trim().toLowerCase();
      return t.includes('save segment') || t.includes('create segment');
    });
    if (saveBtn && !saveBtn.disabled) { saveBtn.click(); return { clicked: true, text: saveBtn.textContent.trim() }; }
    if (saveBtn) return { found: true, disabled: true, text: saveBtn.textContent.trim() };
    return { clicked: false, buttons: buttons.map(b => b.textContent.trim()).filter(t => t.length < 30 && t.length > 0) };
  })()`);
  log(`Save button: ${JSON.stringify(saveResult.value)}`);

  if (!saveResult.value?.clicked) {
    throw new Error(`Could not click save. ${JSON.stringify(saveResult.value)}`);
  }

  // Wait for save to complete
  await client.wait({ delay: 3000 });
}

module.exports = { OP_DISPLAY, formatCondition, automateCreateSegment };
