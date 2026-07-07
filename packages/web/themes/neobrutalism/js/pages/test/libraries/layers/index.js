// /test — Theme (neobrutalism) page JS — the #theme layer.
// Runs AFTER #main, BEFORE #project. Turns the "js-theme" dot green.
export default ({ manager, options }) => {
  const dot = document.querySelector('.layer-dot[data-layer="js-theme"]');
  if (dot) {
    dot.style.background = '#30a46c'; // green
  }
  console.log('[test-layer] #theme JS ran → js-theme dot green');
};
