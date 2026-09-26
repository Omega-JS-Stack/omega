/**
 * Token accounting for the unified AI library.
 *
 * Every call reports usage computed from ITS OWN response (`buildTokens`), and
 * only the running instance counters are accumulated (`addTokens`). Returning a
 * shared, mutating counter object misattributed usage the moment two callers
 * overlapped: each one read whatever the running total happened to be when it
 * looked.
 *
 * Shape (identical for a per-call report and a running counter):
 *   { total: { count, price }, input: { count, price }, output: { count, price } }
 */

// A zeroed counter — what a provider/AI instance starts life with
function emptyTokens() {
  return {
    total:  { count: 0, price: 0 },
    input:  { count: 0, price: 0 },
    output: { count: 0, price: 0 },
  };
}

// One call's usage. `modelConfig` carries per-1M-token prices ({ input, output })
function buildTokens(inputCount, outputCount, modelConfig) {
  const input  = inputCount || 0;
  const output = outputCount || 0;

  const inputPrice  = (input  * (modelConfig?.input  || 0)) / 1000000;
  const outputPrice = (output * (modelConfig?.output || 0)) / 1000000;

  return {
    total:  { count: input + output, price: inputPrice + outputPrice },
    input:  { count: input,  price: inputPrice },
    output: { count: output, price: outputPrice },
  };
}

// Roll one call's usage into a running counter (mutates and returns the counter)
function addTokens(running, call) {
  running.input.count  += call?.input?.count  || 0;
  running.input.price  += call?.input?.price  || 0;
  running.output.count += call?.output?.count || 0;
  running.output.price += call?.output?.price || 0;
  running.total.count   = running.input.count + running.output.count;
  running.total.price   = running.input.price + running.output.price;

  return running;
}

module.exports = {
  emptyTokens,
  buildTokens,
  addTokens,
};
