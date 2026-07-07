/**
 * /test — Global (framework default) page JS — the first layer.
 * Turns the "js-global" dot green to prove this layer loaded + ran.
 */
export default ({ manager, options }) => {
  const dot = document.querySelector('.layer-dot[data-layer="js-global"]');
  if (dot) {
    dot.style.background = '#30a46c'; // green
  }
  console.log('[test-layer] global JS ran → js-global dot green');
};
