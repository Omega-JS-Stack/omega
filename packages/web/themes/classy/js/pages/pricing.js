/**
 * Classy pricing page module — THEME layer (wins over core, loses to site).
 */
document.querySelectorAll('.plan-card').forEach((card) => {
  card.addEventListener('click', () => {
    console.log('[omega:pricing] plan selected:', card.dataset.plan);
  });
});
