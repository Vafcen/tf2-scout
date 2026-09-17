// SSE connection: refreshes the table and shows a toast when a new opportunity arrives.
(function () {
  if (!window.EventSource) return;
  var es = new EventSource('/events');
  var lastRefresh = 0;
  es.addEventListener('opportunity', function (e) {
    try {
      var d = JSON.parse(e.data);
      if (d.isNew || d.improved) {
        if (d.lane === 'snipe' || d.lane === 'keys' || d.lane === 'unusual' || d.lane === 'cash') toast(d);
      }
      var now = Date.now();
      if (now - lastRefresh > 1500) {
        lastRefresh = now;
        document.body.dispatchEvent(new CustomEvent('refresh'));
      }
    } catch (err) { /* ignore */ }
  });
  function toast(d) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast';
    var a = document.createElement('a');
    a.href = '/opp/' + d.id;
    a.textContent = (d.laneLabel || d.lane) + ': ' + (d.title || d.sku);
    var p = document.createElement('div');
    p.className = 'small muted';
    p.textContent = d.netText || '';
    el.appendChild(a); el.appendChild(p);
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 12000);
  }
})();
