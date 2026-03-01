/**
 * Coach-Lytics — app.js
 * Handles UI interactivity, Gemini API calls (via Python backend),
 * chart rendering, and plan display logic.
 *
 * API Flow:
 *   Frontend (JS) → POST /api/generate → Python backend (api.py) → Gemini → Response
 *
 * For local demo without backend, set DEMO_MODE = true
 */

// ══════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════
const DEMO_MODE = true;       // Set to false when Python backend is running
const API_ENDPOINT = '/api/generate';  // Your Python Flask/FastAPI endpoint

// ══════════════════════════════════════════
// CHART INIT (vanilla canvas — no lib needed)
// ══════════════════════════════════════════
function initChart() {
  const canvas = document.getElementById('perfChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Responsive size
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width  = (rect.width || 300) * dpr;
  canvas.height = 120 * dpr;
  canvas.style.width  = (rect.width || 300) + 'px';
  canvas.style.height = '120px';
  ctx.scale(dpr, dpr);

  const W = rect.width || 300;
  const H = 120;
  const data = [2, 4, 3.5, 5, 5.5, 5, 6.5];
  const days = data.length;
  const padX = 16, padY = 10;
  const chartW = W - padX * 2;
  const chartH = H - padY * 2 - 20; // leave room for labels

  const maxVal = Math.max(...data) + 1;
  const pts = data.map((v, i) => ({
    x: padX + (i / (days - 1)) * chartW,
    y: padY + chartH - (v / maxVal) * chartH
  }));

  // Grid lines
  ctx.strokeStyle = 'rgba(41,127,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padY + (i / 4) * chartH;
    ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(W - padX, y); ctx.stroke();
  }

  // Area fill
  const grad = ctx.createLinearGradient(0, padY, 0, padY + chartH);
  grad.addColorStop(0, 'rgba(41,127,255,0.3)');
  grad.addColorStop(1, 'rgba(41,127,255,0.0)');

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach((p, i) => {
    if (i === 0) return;
    const prev = pts[i - 1];
    const cp1x = prev.x + (p.x - prev.x) * 0.5;
    ctx.bezierCurveTo(cp1x, prev.y, cp1x, p.y, p.x, p.y);
  });
  ctx.lineTo(pts[pts.length - 1].x, padY + chartH);
  ctx.lineTo(pts[0].x, padY + chartH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach((p, i) => {
    if (i === 0) return;
    const prev = pts[i - 1];
    const cp1x = prev.x + (p.x - prev.x) * 0.5;
    ctx.bezierCurveTo(cp1x, prev.y, cp1x, p.y, p.x, p.y);
  });
  ctx.strokeStyle = '#297FFF';
  ctx.lineWidth = 2;
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#297FFF';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Dots
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = i === pts.length - 1 ? '#B8FF3A' : '#297FFF';
    ctx.shadowBlur = i === pts.length - 1 ? 12 : 6;
    ctx.shadowColor = i === pts.length - 1 ? '#B8FF3A' : '#297FFF';
    ctx.fill();
    ctx.shadowBlur = 0;
  });
}

// ══════════════════════════════════════════
// CHAR COUNT
// ══════════════════════════════════════════
function updateCharCount(el) {
  document.getElementById('charCount').textContent = el.value.length;
}

// ══════════════════════════════════════════
// TOAST NOTIFICATION
// ══════════════════════════════════════════
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, 3800);
}

// ══════════════════════════════════════════
// SET LOADING STATE
// ══════════════════════════════════════════
function setLoading(on) {
  const btn     = document.getElementById('generateBtn');
  const loading = document.getElementById('loadingCard');
  btn.disabled = on;
  loading.style.display = on ? 'block' : 'none';
  btn.innerHTML = on
    ? '<span class="btn-glow"></span><svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="#111" stroke-width="2" fill="none" stroke-dasharray="40" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" dur="0.7s" from="0 12 12" to="360 12 12" repeatCount="indefinite"/></circle></svg><span>Analyzing…</span>'
    : '<span class="btn-glow"></span><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="#111" stroke-width="2" stroke-linejoin="round" fill="#111"/></svg><span>Generate Plan</span>';
}

// ══════════════════════════════════════════
// RENDER PLAN TO DOM
// ══════════════════════════════════════════
function renderPlan(plan) {
  // Focus Area
  document.getElementById('focusArea').innerHTML =
    `<div class="focus-chip">${escHtml(plan.focus_area)}</div>`;

  // Training Plan
  const tList = document.getElementById('trainingPlan');
  tList.innerHTML = plan.training_plan.map(item =>
    `<li>${escHtml(item)}</li>`
  ).join('');

  // Daily Goals
  const gList = document.getElementById('dailyGoals');
  gList.innerHTML = plan.daily_goals.map(item =>
    `<li>${escHtml(item)}</li>`
  ).join('');

  // Action Steps
  const stepsList = document.getElementById('actionSteps');
  stepsList.innerHTML = plan.action_steps.map((step, i) => `
    <div class="step-item" style="animation-delay:${i * 0.08}s">
      <div class="step-num">${i + 1}</div>
      <div class="step-content">
        <div class="step-title">${escHtml(step.title)}</div>
        <div class="step-desc">${escHtml(step.description)}</div>
      </div>
    </div>
  `).join('');

  // Motivational Quote
  if (plan.motivation) {
    document.getElementById('motivationQuote').textContent = plan.motivation;
  }

  // Coach Notes
  if (plan.coach_notes) {
    document.getElementById('coachNotes').innerHTML = `<p>${escHtml(plan.coach_notes)}</p>`;
  }

  // AI Intensity bar
  if (plan.intensity_score) {
    const row = document.getElementById('aiIntensityRow');
    const bar = document.getElementById('aiBar');
    const pct = document.getElementById('aiBarPct');
    const val = Math.min(100, Math.max(0, plan.intensity_score));
    row.style.display = 'flex';
    setTimeout(() => { bar.style.width = val + '%'; }, 100);
    pct.textContent = val + '%';
  }
}

// ══════════════════════════════════════════
// DEMO DATA (used when DEMO_MODE = true)
// ══════════════════════════════════════════
function getDemoResponse(advice) {
  return {
    focus_area: 'Speed & Lateral Agility',
    training_plan: [
      'Sprint Acceleration Drills',
      'Lateral Shuffle Sequences',
      'Reactive Cone Work',
      'First-Step Explosion Sets'
    ],
    daily_goals: [
      '6 × 20m Sprint Repeats',
      '4 Lateral Shuffle Circuits',
      '3 Cone Reaction Rounds'
    ],
    action_steps: [
      {
        title: 'Warm Up',
        description: 'Dynamic leg swings, hip circles, high knees — 8 minutes.'
      },
      {
        title: 'Speed Work',
        description: '6 × 20m sprints from set position with 60s recovery.'
      },
      {
        title: 'Lateral Drills',
        description: 'Shuffle left-right across 5 cones, 3 rounds per side.'
      },
      {
        title: 'Reactive Agility',
        description: 'Partner-called direction changes — 4 sets of 30 seconds.'
      },
      {
        title: 'Cool Down',
        description: 'Static quad, hamstring, and hip flexor holds — 10 min.'
      }
    ],
    motivation: 'Your first step wins the play. Every rep sharpens your edge.',
    coach_notes: 'Based on your input, focus on explosive hip drive and low centre of gravity on lateral cuts. Great athletes make this look effortless — it takes deliberate practice.',
    intensity_score: 78
  };
}

// ══════════════════════════════════════════
// MAIN GENERATE FUNCTION
// ══════════════════════════════════════════
async function generatePlan() {
  const advice = document.getElementById('coachAdvice').value.trim();

  if (!advice) {
    showToast('Please enter your coach\'s advice first.', true);
    document.getElementById('coachAdvice').focus();
    return;
  }

  if (advice.length < 10) {
    showToast('Add a bit more detail for a better plan.', true);
    return;
  }

  setLoading(true);

  try {
    let plan;

    if (DEMO_MODE) {
      // Simulate network delay for demo
      await new Promise(r => setTimeout(r, 1800));
      plan = getDemoResponse(advice);
    } else {
      // Real API call to Python backend
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advice })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${response.status}`);
      }

      plan = await response.json();
    }

    renderPlan(plan);
    showToast('✅ Plan generated successfully!');

  } catch (err) {
    console.error('CoachLytics Error:', err);
    showToast('Failed to generate plan. Check your backend is running.', true);
  } finally {
    setLoading(false);
  }
}

// ══════════════════════════════════════════
// UTILITY
// ══════════════════════════════════════════
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Allow Enter + Ctrl/Cmd to submit
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('coachAdvice').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generatePlan();
  });
});