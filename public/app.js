import { QUESTIONNAIRES, TASKS } from './demo-data.js';

const app = document.querySelector('#app');
const DEFAULT_CODE = `import sys

def solve():
    # Read input and print your answer
    pass

if __name__ == '__main__':
    solve()`;
let currentState = null;
let taskData = [];
let remaining = 0;
let currentTask = 1;
let timerInterval = null;
let demoMode = false;
const DEMO_STORAGE_KEY = 'codelab_static_demo';
const DEMO_PHASES = ['pre', 'experiment', 'post', 'finished'];
const DEMO_DURATIONS = { pre: 600, experiment: 1500, post: 300 };

function demoStore() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY)) || { participants: [], events: [] };
  } catch {
    return { participants: [], events: [] };
  }
}

function saveDemoStore(store) {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(store));
}

function demoParticipantState(participant) {
  if (!participant) return { participant: null };
  const duration = DEMO_DURATIONS[participant.phase] || 0;
  const elapsed = (Date.now() - participant.phaseStarted) / 1000;
  return {
    participant: { id: participant.id, grp: participant.grp, phase: participant.phase },
    remaining: Math.max(0, Math.floor(duration - elapsed)),
    duration,
    attempts: participant.attempts || {},
    done: Boolean(participant.responses?.[participant.phase]),
    score: null
  };
}

async function demoApi(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  const store = demoStore();
  const participant = store.participants.find((item) => item.id === store.currentId);
  if (url === '/api/state' && method === 'GET') return demoParticipantState(participant);
  if (url === '/api/tasks' && method === 'GET') {
    const questionnaire = participant && QUESTIONNAIRES[participant.phase]
      ? { ...QUESTIONNAIRES[participant.phase], participantId: participant.id }
      : null;
    return { tasks: TASKS, questionnaire };
  }
  if (url === '/api/login' && method === 'POST') {
    const id = typeof body.id === 'string' ? body.id.trim().toUpperCase() : '';
    if (!/^[A-Z0-9_-]{3,24}$/.test(id)) throw new Error('Use 3–24 letters, digits, - or _.');
    let selected = store.participants.find((item) => item.id === id);
    if (!selected) {
      const a = store.participants.filter((item) => item.grp === 'A').length;
      const b = store.participants.filter((item) => item.grp === 'B').length;
      selected = {
        id, grp: a < b ? 'A' : b < a ? 'B' : store.participants.length % 2 === 0 ? 'A' : 'B',
        phase: 'pre', phaseStarted: Date.now(), responses: {}, attempts: {}
      };
      store.participants.push(selected);
    }
    store.currentId = id;
    saveDemoStore(store);
    return demoParticipantState(selected);
  }
  if (url === '/api/questionnaire' && method === 'POST') {
    if (!participant || !QUESTIONNAIRES[participant.phase]) throw new Error('Questionnaire is not available in this phase.');
    if (participant.responses[participant.phase]) throw new Error('This questionnaire has already been submitted.');
    const questions = QUESTIONNAIRES[participant.phase].sections.flatMap((section) => section.questions);
    for (const question of questions) {
      const answer = body.answers?.[question.id];
      if (question.type === 'participant' && answer !== participant.id) {
        throw new Error('Participant code does not match your sign-in ID.');
      }
      if (question.required && question.type === 'radio' && !question.options.includes(answer)) {
        throw new Error(`${question.id} requires an answer.`);
      }
      if (question.required && question.type === 'radio' && answer && !question.options.includes(answer)) {
        throw new Error(`${question.id} has an invalid option.`);
      }
    }
    if (participant.phase === 'post' && body.answers?.S14 === 'Yes' &&
        (!Array.isArray(body.answers?.S15) || !body.answers.S15.length || !body.answers?.S16)) {
      throw new Error('Please complete S15 and S16 when S14 is Yes.');
    }
    participant.responses[participant.phase] = body.answers;
    participant.questionnaireSubmitted = {
      ...participant.questionnaireSubmitted,
      [participant.phase]: new Date().toISOString()
    };
    saveDemoStore(store);
    return demoParticipantState(participant);
  }
  if (url === '/api/advance' && method === 'POST') {
    if (!participant) throw new Error('Sign in with your participant ID first.');
    if (QUESTIONNAIRES[participant.phase] && !participant.responses?.[participant.phase]) {
      throw new Error('Complete the questionnaire first.');
    }
    const phaseIndex = DEMO_PHASES.indexOf(participant.phase);
    if (phaseIndex < 0 || phaseIndex >= DEMO_PHASES.length - 1) throw new Error('There is no next phase.');
    participant.phase = DEMO_PHASES[phaseIndex + 1];
    participant.phaseStarted = Date.now();
    saveDemoStore(store);
    return demoParticipantState(participant);
  }
  if (url === '/api/event' && method === 'POST') {
    store.events.push({ participant: store.currentId, kind: body.kind, task: body.task || null, ts: new Date().toISOString() });
    saveDemoStore(store);
    return { ok: true };
  }
  if (url.startsWith('/api/submit/') && method === 'POST') {
    if (!participant || participant.phase !== 'experiment') throw new Error('Code submissions are only available during the contest.');
    const taskId = Number(url.slice('/api/submit/'.length));
    if (!TASKS.some((task) => task.id === taskId)) throw new Error('Task not found.');
    participant.attempts[taskId] = { n: (participant.attempts[taskId]?.n || 0) + 1, solved: false };
    saveDemoStore(store);
    return { verdict: 'Demo preview — code is not executed', passed: 0, total: 0, accepted: false };
  }
  if (url === '/api/admin/login' && method === 'POST') {
    store.demoAdmin = true;
    saveDemoStore(store);
    return { ok: true };
  }
  if (url === '/api/admin/data' && method === 'GET') {
    return { rows: store.participants.map((item) => ({
      id: item.id, grp: item.grp, phase: item.phase,
      pre_survey_submitted: Boolean(item.responses?.pre),
      post_survey_submitted: Boolean(item.responses?.post),
      attempts: Object.values(item.attempts || {}).reduce((sum, attempt) => sum + attempt.n, 0),
      solved: Object.values(item.attempts || {}).filter((attempt) => attempt.solved).length,
      avg_solve_time: null
    })) };
  }
  if (url.startsWith('/api/admin/export/')) return { demoExport: url.split('/').at(-1) };
  if (url === '/api/logout' && method === 'POST') {
    store.currentId = null;
    saveDemoStore(store);
    return { ok: true };
  }
  throw new Error('This action is unavailable in the static demo.');
}

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'className') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== false && value !== null && value !== undefined) {
      if (value === true) element.setAttribute(key, '');
      else element.setAttribute(key, String(value));
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child !== null && child !== undefined) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

async function api(url, options = {}) {
  if (demoMode) return demoApi(url, options);
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      demoMode = true;
      return demoApi(url, options);
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || `Request failed (${response.status}).`);
    return result;
  } catch (error) {
    if (error instanceof TypeError) {
      demoMode = true;
      return demoApi(url, options);
    }
    throw error;
  }
}

function startTimer(seconds, onExpire) {
  if (timerInterval) clearInterval(timerInterval);
  remaining = seconds;
  const update = () => {
    const display = document.querySelector('#timer');
    if (display) display.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    if (remaining <= 0) {
      clearInterval(timerInterval);
      onExpire?.();
    } else {
      remaining -= 1;
    }
  };
  update();
  timerInterval = setInterval(update, 1000);
}

function workspaceHeader(title, state) {
  const head = node('div', { className: 'workspace-head' });
  const heading = node('div');
  if (demoMode) heading.append(node('div', { className: 'demo-notice', text: 'STATIC DEMO · Responses stay in this browser · Code judging is disabled' }));
  heading.append(node('div', { className: 'pill', text: `PARTICIPANT ${state.participant.id} · ${state.participant.phase.toUpperCase()}` }));
  heading.append(node('h1', { text: title }));
  head.append(heading);
  const timer = node('div', { className: 'timer' }, [
    node('span', { text: 'TIME REMAINING' }),
    node('strong', { id: 'timer', text: '--:--' })
  ]);
  head.append(timer);
  return head;
}

function addStatus(message, className = 'error') {
  let status = document.querySelector('#status');
  if (!status) {
    status = node('p', { id: 'status', className, role: 'status' });
    app.prepend(status);
  }
  status.className = className;
  status.textContent = message;
}

function reportEvent(kind, task = currentTask) {
  api('/api/event', { method: 'POST', body: JSON.stringify({ kind, task }) })
    .catch((error) => console.warn('Could not record experiment event:', error.message));
}

function renderHome(error = '') {
  app.replaceChildren();
  const hero = node('section', { className: 'hero' });
  hero.append(node('div', { className: 'pill', text: demoMode ? 'CONTEST PREVIEW' : 'LIVE CLASSROOM STUDY' }));
  if (demoMode) hero.append(node('div', { className: 'demo-notice', text: 'STATIC DEMO · This preview stores responses in this browser only. Code judging is disabled.' }));
  const title = node('h1');
  title.append('Code smarter.', node('br'), node('em', { text: 'Measure learning.' }));
  hero.append(title);
  hero.append(node('p', { text: 'Welcome to the Python programming experiment. Complete the pre-survey, solve five coding challenges, then complete the post-survey.' }));
  hero.append(node('div', { className: 'stats' }, [
    node('span', { text: '◷ 40 MINUTES' }),
    node('span', { text: '⌘ 5 CHALLENGES' }),
    node('span', { text: '◉ ANONYMOUS' })
  ]));
  const form = node('form', { className: 'login card' });
  form.append(node('label', { for: 'participant-id', text: 'YOUR PARTICIPANT ID' }));
  const input = node('input', {
    id: 'participant-id', name: 'id', placeholder: 'e.g. P001', required: true,
    minlength: 3, maxlength: 24, autocomplete: 'off'
  });
  form.append(input);
  const button = node('button', { type: 'submit', text: 'Enter experiment →' });
  form.append(button);
  if (error) form.append(node('p', { className: 'error', role: 'alert', text: error }));
  form.append(node('small', { text: 'Use only the anonymous ID provided by your researcher. Re-enter the same ID to resume.' }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ id: input.value }) });
      await loadWorkspace();
    } catch (failure) {
      addStatus(failure.message);
      button.disabled = false;
    }
  });
  hero.append(form);
  app.append(hero);
}

function renderQuestionnaire(state, questionnaire) {
  const section = node('section', { className: 'card' });
  if (state.done) {
    section.append(node('div', { className: 'success', text: 'Your questionnaire has been submitted.' }));
    section.append(node('button', { type: 'button', text: 'Continue →', onClick: advancePhase }));
    return section;
  }
  section.append(node('p', { className: 'questionnaire-intro', text: questionnaire.introduction }));
  const form = node('form');
  const conditionalQuestions = new Set(questionnaire.title.startsWith('POST-SURVEY') ? ['S15', 'S16'] : []);
  const updateConditionalFields = () => {
    const practiceAnswer = form.querySelector('input[name="S14"]:checked')?.value;
    for (const id of conditionalQuestions) {
      const field = form.querySelector(`[data-question="${id}"]`);
      if (field) field.hidden = practiceAnswer !== 'Yes';
      if (practiceAnswer !== 'Yes' && field) {
        field.querySelectorAll('input').forEach((input) => {
          if (input.type === 'radio' || input.type === 'checkbox') input.checked = false;
          else input.value = '';
        });
      }
    }
    for (const question of questionnaire.sections.flatMap((sectionItem) => sectionItem.questions)) {
      const field = form.querySelector(`[data-question="${question.id}"]`);
      const otherSelected = question.other && (question.type === 'checkbox'
        ? [...(field?.querySelectorAll('input[type="checkbox"]:checked') || [])].some((input) => input.value === 'Other (specify)')
        : field?.querySelector('input[type="radio"]:checked')?.value === 'Other (specify)');
      const otherInput = field?.querySelector(`[name="${question.id}_other"]`);
      if (otherInput) {
        otherInput.hidden = !otherSelected;
        if (!otherSelected) otherInput.value = '';
        otherInput.required = otherSelected && !field.hidden;
      }
      const requiredRadio = field?.querySelector('input[type="radio"]');
      if (requiredRadio) requiredRadio.required = Boolean(question.required && !field.hidden);
    }
  };

  for (const sectionData of questionnaire.sections) {
    const sectionBlock = node('section', { className: 'questionnaire-section' });
    sectionBlock.append(node('h2', { text: sectionData.title }));
    if (sectionData.instruction) {
      sectionBlock.append(node('p', { className: 'questionnaire-instruction', text: sectionData.instruction }));
    }
    for (const question of sectionData.questions) {
      const block = node('fieldset', { className: 'question', 'data-question': question.id });
      block.append(node('legend', { text: `${question.id}. ${question.prompt}` }));
      if (question.type === 'participant') {
        const participantCode = node('input', {
          type: 'text', value: questionnaire.participantId, readonly: true,
          'aria-label': question.prompt
        });
        block.append(participantCode);
      } else if (question.type === 'radio' || question.type === 'checkbox') {
        for (const option of question.options) {
          const label = node('label', { className: question.type === 'radio' ? 'option' : 'option checkbox-option' });
          const input = node('input', {
            type: question.type,
            name: question.id,
            value: option,
            required: Boolean(question.required && question.type === 'radio' && option === question.options[0])
          });
          input.addEventListener('change', updateConditionalFields);
          label.append(input, ` ${option}`);
          block.append(label);
        }
        if (question.other) {
          const otherInput = node('input', {
            type: 'text',
            name: `${question.id}_other`,
            maxlength: 500,
            placeholder: 'Please specify',
            'aria-label': `${question.id} other (specify)`
          });
          otherInput.hidden = true;
          block.append(otherInput);
        }
      } else if (question.type === 'textarea') {
        block.append(node('textarea', {
          name: question.id, maxlength: 500, rows: 4,
          'aria-label': question.prompt
        }));
      } else {
        block.append(node('input', {
          type: 'text', name: question.id, maxlength: 500,
          'aria-label': question.prompt
        }));
      }
      if (conditionalQuestions.has(question.id)) block.hidden = true;
      sectionBlock.append(block);
    }
    form.append(sectionBlock);
  }
  const submit = node('button', { type: 'submit', text: 'Submit questionnaire' });
  form.append(submit);
  form.addEventListener('change', updateConditionalFields);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const answers = {};
    for (const question of questionnaire.sections.flatMap((sectionItem) => sectionItem.questions)) {
      const field = form.querySelector(`[data-question="${question.id}"]`);
      if (question.type === 'participant') {
        answers[question.id] = questionnaire.participantId;
      } else if (question.type === 'radio') {
        answers[question.id] = field?.querySelector('input[type="radio"]:checked')?.value || '';
      } else if (question.type === 'checkbox') {
        answers[question.id] = [...(field?.querySelectorAll('input[type="checkbox"]:checked') || [])].map((input) => input.value);
      } else {
        answers[question.id] = field?.querySelector(`[name="${question.id}"]`)?.value || '';
      }
      if (question.other) {
        answers[`${question.id}_other`] = field?.querySelector(`[name="${question.id}_other"]`)?.value || '';
      }
    }
    submit.disabled = true;
    try {
      await api('/api/questionnaire', { method: 'POST', body: JSON.stringify({ answers }) });
      await advancePhase();
    } catch (failure) {
      addStatus(failure.message);
      submit.disabled = false;
    }
  });
  updateConditionalFields();
  section.append(form);
  return section;
}

function saveCode() {
  const editor = document.querySelector('#code');
  if (editor) localStorage.setItem(`code_${currentTask}`, editor.value);
}

function selectTask(id) {
  saveCode();
  currentTask = id;
  const task = taskData.find((item) => item.id === id);
  if (!task) return;
  const gamified = currentState.participant.grp === 'A';
  document.querySelectorAll('.tasklink').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.task) === id);
  });
  document.querySelector('#topic').textContent = task.topic.toUpperCase();
  document.querySelector('#title').textContent = gamified ? `Mission ${id} · ${task.title}` : task.title;
  document.querySelector('#description').textContent = gamified ? `${task.game} ${task.description}` : task.description;
  for (const [elementId, key] of [
    ['input-format', 'input'],
    ['output-format', 'output'],
    ['constraints', 'constraints'],
    ['example-in', 'example_in'],
    ['example-out', 'example_out']
  ]) {
    document.querySelector(`#${elementId}`).textContent = task[key];
  }
  const editor = document.querySelector('#code');
  editor.value = localStorage.getItem(`code_${id}`) || DEFAULT_CODE;
  document.querySelector('#result').textContent = 'Your submission verdict will appear here.';
  reportEvent('task_open', id);
}

function renderExperiment(state) {
  const wrapper = node('div', { className: 'layout' });
  const sidebar = node('aside', { className: 'card sidebar' });
  sidebar.append(node('div', { className: 'section-label', text: 'CHALLENGE LIST' }));
  const solved = Object.values(state.attempts).filter((attempt) => attempt.solved).length;
  for (const task of taskData) {
    const button = node('button', { type: 'button', className: 'tasklink', 'data-task': task.id });
    button.append(
      node('span', { text: `0${task.id} · ${task.level}` }),
      node('strong', { text: state.participant.grp === 'A' ? `Mission ${task.id}` : task.title }),
      node('small', { id: `state${task.id}`, text: state.attempts[task.id]?.solved ? '✓ Solved' : state.attempts[task.id] ? `${state.attempts[task.id].n} attempts` : 'Not started' })
    );
    button.addEventListener('click', () => selectTask(task.id));
    sidebar.append(button);
  }
  if (state.participant.grp === 'A') {
    const progress = node('div', { className: 'progressbox', text: 'YOUR PROGRESS' });
    const track = node('div', { className: 'progress' });
    track.append(node('div', { id: 'progressbar' }));
    progress.append(track, node('span', { id: 'progresslabel', text: `${solved} / 5 missions` }));
    sidebar.append(progress);
  }

  const area = node('section', { className: 'task-area' });
  const taskCard = node('div', { className: 'card task-card' });
  taskCard.append(
    node('div', { className: 'section-label', id: 'topic' }),
    node('h2', { id: 'title' }),
    node('p', { id: 'description' }),
    node('h3', { text: 'Input format' }),
    node('p', { id: 'input-format' }),
    node('h3', { text: 'Output format' }),
    node('p', { id: 'output-format' }),
    node('h3', { text: 'Constraints' }),
    node('p', { id: 'constraints' })
  );
  const examples = node('div', { className: 'examples' });
  for (const [label, id] of [['Sample input', 'example-in'], ['Sample output', 'example-out']]) {
    const block = node('div');
    block.append(node('b', { text: label }), node('pre', { id }));
    examples.append(block);
  }
  taskCard.append(examples);
  area.append(taskCard);

  const editorCard = node('div', { className: 'card editor-card' });
  editorCard.append(node('div', { className: 'editor-head' }, [
    node('b', { text: 'Python 3.12' }),
    node('span', { text: 'Read stdin · Write stdout' })
  ]));
  const editor = node('textarea', { id: 'code', spellcheck: false, 'aria-label': 'Python code editor' });
  editor.value = localStorage.getItem('code_1') || DEFAULT_CODE;
  editor.addEventListener('input', saveCode);
  editor.addEventListener('focus', () => reportEvent('editor_focus'), { once: true });
  editorCard.append(editor);
  const actions = node('div', { className: 'actions' });
  actions.append(
    node('span', { id: 'attemptcount', text: 'Submissions are recorded' }),
    node('button', { type: 'button', id: 'submit', text: '▶ Submit solution', onClick: submitCode })
  );
  editorCard.append(actions, node('div', { id: 'result', className: 'result', role: 'status', text: 'Your submission verdict will appear here.' }));
  area.append(editorCard);
  const advanceForm = node('form', { className: 'advance' });
  advanceForm.append(node('button', { type: 'submit', className: 'secondary', text: 'Finish coding stage →' }));
  advanceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await advancePhase();
  });
  area.append(advanceForm);
  wrapper.append(sidebar, area);
  return wrapper;
}

async function submitCode() {
  const submit = document.querySelector('#submit');
  const result = document.querySelector('#result');
  const code = document.querySelector('#code').value;
  saveCode();
  reportEvent('run_click');
  submit.disabled = true;
  result.textContent = 'Evaluating hidden test cases…';
  try {
    const verdict = await api(`/api/submit/${currentTask}`, { method: 'POST', body: JSON.stringify({ code }) });
    result.textContent = `${verdict.verdict} · ${verdict.passed}/${verdict.total} tests passed`;
    result.className = `result${verdict.accepted ? ' success' : ''}`;
    if (verdict.accepted) {
      const stateLabel = document.querySelector(`#state${currentTask}`);
      if (stateLabel) stateLabel.textContent = '✓ Solved';
      const solvedCount = document.querySelectorAll('.tasklink small').length
        ? [...document.querySelectorAll('.tasklink small')].filter((item) => item.textContent === '✓ Solved').length
        : 0;
      const progressBar = document.querySelector('#progressbar');
      if (progressBar) {
        progressBar.style.width = `${solvedCount * 20}%`;
        document.querySelector('#progresslabel').textContent = `${solvedCount} / 5 missions`;
      }
    }
  } catch (failure) {
    result.textContent = failure.message;
  } finally {
    submit.disabled = remaining <= 0;
  }
}

async function advancePhase() {
  try {
    await api('/api/advance', { method: 'POST', body: '{}' });
    await loadWorkspace();
  } catch (failure) {
    addStatus(failure.message);
  }
}

async function loadWorkspace() {
  currentState = await api('/api/state');
  if (!currentState.participant) {
    renderHome();
    return;
  }
  const phase = currentState.participant.phase;
  if (phase === 'experiment') {
    const data = await api('/api/tasks');
    taskData = data.tasks;
  }
  app.replaceChildren();
  if (phase === 'pre' || phase === 'post') {
    const data = await api('/api/tasks');
    app.append(workspaceHeader(data.questionnaire.title, currentState));
    app.append(renderQuestionnaire(currentState, data.questionnaire));
  } else if (phase === 'experiment') {
    const title = currentState.participant.grp === 'A' ? 'Your coding missions 🚀' : 'Programming exercises';
    app.append(workspaceHeader(title, currentState));
    app.append(renderExperiment(currentState));
    selectTask(1);
    const label = document.querySelector('#progressbar');
    if (label) label.style.width = `${Object.values(currentState.attempts).filter((attempt) => attempt.solved).length * 20}%`;
  } else {
    app.append(workspaceHeader('Thank you!', currentState));
    app.append(node('section', { className: 'card' }, [
      node('div', { className: 'success', text: 'Your responses have been saved. You may close this tab.' })
    ]));
  }
  if (currentState.duration > 0) {
    startTimer(currentState.remaining, () => {
      const submit = document.querySelector('#submit');
      if (submit) submit.disabled = true;
      if (phase === 'experiment') addStatus('The coding stage time has ended.', 'error');
    });
  } else if (timerInterval) {
    clearInterval(timerInterval);
  }
}

async function renderAdmin() {
  app.replaceChildren();
  app.append(workspaceHeader('Experiment dashboard', { participant: { id: 'RESEARCHER', phase: 'admin' } }));
  try {
    const data = await api('/api/admin/data');
    renderAdminDashboard(data.rows);
  } catch (error) {
    if (error.message.includes('Researcher sign-in is required')) {
      renderAdminLogin();
      return;
    }
    app.append(node('section', { className: 'card error', text: error.message }));
  }
}

function renderAdminLogin(error = '') {
  app.replaceChildren(workspaceHeader('Experiment dashboard', { participant: { id: 'RESEARCHER', phase: 'admin' } }));
  const form = node('form', { className: 'login card' });
  form.append(node('label', { for: 'admin-password', text: 'ADMIN PASSWORD' }));
  const input = node('input', { id: 'admin-password', name: 'password', type: 'password', required: true, placeholder: 'Password' });
  const submit = node('button', { type: 'submit', text: 'Sign in →' });
  form.append(input, submit);
  if (error) form.append(node('p', { className: 'error', role: 'alert', text: error }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: input.value }) });
      await renderAdmin();
    } catch (failure) {
      renderAdminLogin(failure.message);
    }
  });
  app.append(form);
}

function renderAdminDashboard(rows) {
  app.replaceChildren(workspaceHeader('Experiment dashboard', { participant: { id: 'RESEARCHER', phase: 'admin' } }));
  const section = node('section', { className: 'card' });
  const downloads = node('div', { className: 'downloads' });
  const exports = demoMode
    ? ['pre_survey', 'post_survey', 'participants', 'events']
    : ['pre_survey', 'post_survey', 'participants', 'attempts', 'quizzes', 'surveys', 'events'];
  for (const kind of exports) {
    const link = node('a', { href: `/api/admin/export/${kind}`, text: `↓ ${kind}.csv` });
    if (demoMode) link.addEventListener('click', (event) => {
      event.preventDefault();
      downloadDemoCsv(kind);
    });
    downloads.append(link);
  }
  section.append(downloads, node('p', { text: demoMode
    ? 'Static demo: these exports include only responses saved in this browser.'
    : 'Download the complete pre-survey and post-survey responses, or export participant and experiment activity data.' }));
  const tableWrap = node('div', { className: 'tablewrap' });
  const table = node('table');
  const headings = ['ID', 'Group', 'Phase', 'Pre-survey', 'Post-survey', 'Attempts', 'Solved', 'Avg solve time (s)'];
  table.append(node('thead', {}, node('tr', {}, headings.map((heading) => node('th', { scope: 'col', text: heading })))));
  const body = node('tbody');
  for (const row of rows) {
    body.append(node('tr', {}, [
      row.id, row.grp, row.phase,
      row.pre_survey_submitted ? 'Complete' : 'Pending',
      row.post_survey_submitted ? 'Complete' : 'Pending',
      row.attempts, row.solved, row.avg_solve_time ?? '—'
    ].map((value) => node('td', { text: value }))));
  }
  table.append(body);
  tableWrap.append(table);
  section.append(tableWrap);
  app.append(section);
}

function csvValue(value) {
  const text = Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadDemoCsv(kind) {
  const store = demoStore();
  let rows;
  if (kind === 'pre_survey' || kind === 'post_survey') {
    const phase = kind === 'pre_survey' ? 'pre' : 'post';
    const questions = QUESTIONNAIRES[phase].sections.flatMap((section) => section.questions);
    const columns = questions.flatMap((question) => [
      { key: question.id, label: `${question.id}. ${question.prompt}` },
      ...(question.other ? [{ key: `${question.id}_other`, label: `${question.id} other (specify)` }] : [])
    ]);
    rows = [
      ['participant_id', 'group', 'submitted_at', ...columns.map((column) => column.label)],
      ...store.participants.map((participant) => [
        participant.id, participant.grp,
        participant.questionnaireSubmitted?.[phase] || '',
        ...columns.map(({ key }) => participant.responses?.[phase]?.[key] ?? '')
      ])
    ];
  } else if (kind === 'participants') {
    rows = [
      ['id', 'grp', 'phase', 'pre_survey_submitted', 'post_survey_submitted', 'attempts'],
      ...store.participants.map((participant) => [
        participant.id, participant.grp, participant.phase,
        Boolean(participant.responses?.pre), Boolean(participant.responses?.post),
        Object.values(participant.attempts || {}).reduce((sum, attempt) => sum + attempt.n, 0)
      ])
    ];
  } else if (kind === 'events') {
    rows = [['participant', 'kind', 'task', 'timestamp'], ...store.events.map((event) => [
      event.participant, event.kind, event.task, event.ts
    ])];
  } else {
    rows = [['info'], ['Static preview does not run quizzes, store server attempts, or judge submitted code.']];
  }
  const csv = `\uFEFF${rows.map((row) => row.map(csvValue).join(',')).join('\r\n')}\r\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = node('a', { href: url, download: `${kind}.csv`, hidden: true });
  document.body.append(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

async function start() {
  if (location.pathname === '/admin') {
    await renderAdmin();
    return;
  }
  try {
    await loadWorkspace();
  } catch (error) {
    if (error.message.includes('Sign in with your participant ID')) renderHome();
    else {
      renderHome();
      addStatus(error.message);
    }
  }
}

start().catch((error) => {
  console.error('Could not start the experiment frontend:', error);
  renderHome('Could not load the experiment. Check that the server is running, then reload this page.');
});
