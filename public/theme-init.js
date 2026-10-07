(() => {
  let preference = 'system';
  try { preference = localStorage.getItem('nodecloak.theme') || 'system'; } catch {}
  document.documentElement.dataset.theme = preference === 'dark' || preference === 'light'
    ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
