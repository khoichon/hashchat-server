// HashChat onboarding tour — triggered by ?tour=1 on app.html
// Highlights UI elements one by one with an overlay + tooltip

(async () => {
  const params = new URLSearchParams(location.search);
  if (!params.get('tour')) return;

  // Remove ?tour=1 from URL without reload
  history.replaceState({}, '', '/app.html');

  // Wait for app to finish loading
  await new Promise(r => setTimeout(r, 800));

  const STEPS = [
    {
      target: '#room-list',
      title: '// rooms',
      desc: 'public spaces where multiple people can chat. click a room to open it.',
      position: 'right',
    },
    {
      target: '#dm-list',
      title: '// direct messages',
      desc: 'private one-on-one conversations. click + to send someone a dm invite using their #hash.',
      position: 'right',
    },
    {
      target: '#new-room-btn',
      title: '// create a room',
      desc: 'make a new room and invite people to it.',
      position: 'right',
    },
    {
      target: '.invite-btn',
      title: '// invite to room',
      desc: 'add someone to the current room using their #hash. they will get an invite they can accept or decline.',
      position: 'bottom',
    },
    {
      target: '#user-hash',
      title: '// your hash',
      desc: 'this is your unique identifier. share it with friends so they can find you. click to copy.',
      position: 'top',
    },
    {
      target: '#settings-btn',
      title: '// settings',
      desc: 'change your name, color, password, notifications, and more.',
      position: 'top',
    },
  ];

  let currentStep = 0;

  // Build overlay
  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none;';

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(5,8,15,0.7);backdrop-filter:blur(2px);';

  const spotlight = document.createElement('div');
  spotlight.style.cssText = 'position:absolute;border-radius:8px;box-shadow:0 0 0 9999px rgba(5,8,15,0.7);transition:all 0.35s cubic-bezier(.4,0,.2,1);pointer-events:none;border:1.5px solid rgba(255,255,255,0.2);';

  const tooltip = document.createElement('div');
  tooltip.style.cssText = [
    'position:absolute',
    'background:rgba(10,13,22,0.97)',
    'border:1px solid rgba(255,255,255,0.13)',
    'border-radius:10px',
    'padding:1rem 1.1rem',
    'max-width:240px',
    'pointer-events:all',
    'box-shadow:0 16px 40px rgba(0,0,0,0.5)',
    'transition:all 0.35s cubic-bezier(.4,0,.2,1)',
  ].join(';');

  overlay.appendChild(backdrop);
  overlay.appendChild(spotlight);
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);

  function renderTooltip(step) {
    const isLast = currentStep === STEPS.length - 1;
    tooltip.innerHTML =
      '<div style="font-family:Geist Mono,monospace;font-size:0.62rem;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:6px">' + step.title + '</div>' +
      '<div style="font-size:0.78rem;line-height:1.6;color:rgba(255,255,255,0.8);margin-bottom:14px">' + step.desc + '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<span style="font-family:Geist Mono,monospace;font-size:0.55rem;color:rgba(255,255,255,0.2)">' + (currentStep + 1) + ' / ' + STEPS.length + '</span>' +
        '<div style="display:flex;gap:6px">' +
          (currentStep > 0 ? '<button id="tour-prev" style="background:none;border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:rgba(255,255,255,0.4);font-family:Geist Mono,monospace;font-size:0.55rem;letter-spacing:0.08em;padding:5px 10px;cursor:pointer">prev</button>' : '') +
          '<button id="tour-next" style="background:rgba(255,255,255,0.92);border:none;border-radius:5px;color:#05080f;font-family:Geist Mono,monospace;font-size:0.55rem;letter-spacing:0.08em;padding:5px 12px;cursor:pointer">' + (isLast ? 'done' : 'next') + '</button>' +
          '<button id="tour-skip" style="background:none;border:none;color:rgba(255,255,255,0.2);font-family:Geist Mono,monospace;font-size:0.55rem;cursor:pointer">skip</button>' +
        '</div>' +
      '</div>';

    document.getElementById('tour-next').onclick = () => isLast ? endTour() : goStep(currentStep + 1);
    document.getElementById('tour-skip').onclick = endTour;
    if (currentStep > 0) document.getElementById('tour-prev').onclick = () => goStep(currentStep - 1);
  }

  function positionTooltip(rect, position) {
    const gap = 14;
    const tw = 240, th = 140; // approx tooltip size
    const vw = window.innerWidth, vh = window.innerHeight;

    let top, left;
    if (position === 'right') {
      top  = rect.top + rect.height / 2 - th / 2;
      left = rect.right + gap;
    } else if (position === 'bottom') {
      top  = rect.bottom + gap;
      left = rect.left + rect.width / 2 - tw / 2;
    } else if (position === 'top') {
      top  = rect.top - th - gap;
      left = rect.left + rect.width / 2 - tw / 2;
    } else {
      top  = rect.bottom + gap;
      left = rect.left;
    }

    // Clamp to viewport
    top  = Math.max(12, Math.min(vh - th - 12, top));
    left = Math.max(12, Math.min(vw - tw - 12, left));

    tooltip.style.top  = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function goStep(n) {
    currentStep = n;
    const step = STEPS[n];
    const el = document.querySelector(step.target);

    if (!el) { goStep(n + 1 < STEPS.length ? n + 1 : n); return; }

    const rect = el.getBoundingClientRect();
    const pad = 6;
    spotlight.style.top    = (rect.top - pad) + 'px';
    spotlight.style.left   = (rect.left - pad) + 'px';
    spotlight.style.width  = (rect.width + pad * 2) + 'px';
    spotlight.style.height = (rect.height + pad * 2) + 'px';

    renderTooltip(step);
    positionTooltip(rect, step.position);
  }

  function endTour() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s';
    setTimeout(() => overlay.remove(), 300);
  }

  goStep(0);
})();
