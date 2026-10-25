import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DB = new DatabaseSync(process.env.DATABASE_PATH || path.join(ROOT, 'experiment.sqlite3'));
const PORT = Number.parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET_KEY = process.env.SECRET_KEY || randomBytes(32).toString('hex');
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const PHASES = ['pre', 'experiment', 'post', 'finished'];
const DURATIONS = { pre: 600, experiment: 1500, post: 300 };
const COOKIE_NAME = 'codelab_session';

if (!process.env.SECRET_KEY) {
  console.warn('SECRET_KEY is not set; participant sessions will expire when the server restarts.');
}
if (!ADMIN_PASSWORD) {
  console.warn('ADMIN_PASSWORD is not set; researcher dashboard login is disabled.');
}

DB.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    grp TEXT NOT NULL,
    created TEXT NOT NULL,
    phase TEXT DEFAULT 'pre',
    phase_started REAL,
    finished INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant TEXT,
    task INTEGER,
    submitted REAL,
    elapsed REAL,
    passed INTEGER,
    passed_tests INTEGER,
    total_tests INTEGER,
    code_hash TEXT,
    code_length INTEGER,
    verdict TEXT
  );
  CREATE TABLE IF NOT EXISTS quizzes (
    participant TEXT,
    phase TEXT,
    score INTEGER,
    answers TEXT,
    submitted REAL,
    PRIMARY KEY (participant, phase)
  );
  CREATE TABLE IF NOT EXISTS surveys (
    participant TEXT PRIMARY KEY,
    motivation INTEGER,
    engagement INTEGER,
    difficulty INTEGER,
    feedback TEXT,
    submitted REAL
  );
  CREATE TABLE IF NOT EXISTS questionnaire_responses (
    participant TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('pre', 'post')),
    answers TEXT NOT NULL,
    submitted REAL NOT NULL,
    PRIMARY KEY (participant, phase)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant TEXT,
    kind TEXT,
    task INTEGER,
    ts REAL
  );
`);
DB.prepare("UPDATE participants SET phase = 'post' WHERE phase = 'survey'").run();

const TASKS = [
  {
    id: 1,
    title: 'The Server Log Sorter',
    topic: 'Sorting',
    level: 'Easy',
    description: 'You are given N server connection logs, each containing a Unix timestamp and user ID. Sort by timestamp descending; break ties by user ID ascending.',
    input: 'First line: N. Next N lines: Timestamp UserID.',
    output: 'Print N sorted lines, each with Timestamp UserID.',
    constraints: '1 ≤ N ≤ 100000; 1 ≤ Timestamp, UserID ≤ 10^9',
    example_in: '4\n1630000000 102\n1630000050 101\n1630000000 100\n1630000050 99',
    example_out: '1630000050 99\n1630000050 101\n1630000000 100\n1630000000 102',
    game: 'Mission 1 · Restore the event timeline! Your command center must process the latest signals first.'
  },
  {
    id: 2,
    title: 'The Contiguous Subarray Target',
    topic: 'Algorithmic Efficiency',
    level: 'Medium',
    description: 'Count contiguous subarrays whose sum equals K. An O(N²) solution is too slow; target O(N).',
    input: 'First line: N K. Second line: N integers.',
    output: 'Print the number of valid subarrays.',
    constraints: '1 ≤ N ≤ 200000; −10^9 ≤ K ≤ 10^9; −10^4 ≤ A[i] ≤ 10^4',
    example_in: '4 3\n1 2 3 -3',
    example_out: '2',
    game: 'Mission 2 · Decode the energy stream! Count target-sum segments before the clock runs out.'
  },
  {
    id: 3,
    title: 'Campus Food Routing',
    topic: 'Graphs',
    level: 'Medium–Hard',
    description: 'Find the minimum travel time from node 1 to node N in an undirected graph with positive weighted edges. Print -1 if unreachable.',
    input: 'First line: N M. Next M lines: U V W.',
    output: 'Print the minimum delivery time, or -1.',
    constraints: '2 ≤ N ≤ 10000; 1 ≤ M ≤ 100000; 1 ≤ W ≤ 1000',
    example_in: '4 4\n1 2 5\n2 4 10\n1 3 2\n3 4 6',
    example_out: '8',
    game: 'Mission 3 · Deliver supplies! Find the fastest route through the campus network.'
  },
  {
    id: 4,
    title: "The Proctor's Schedule",
    topic: 'Dynamic Programming',
    level: 'Hard',
    description: 'Select non-overlapping exams to maximize the sum of their priority weights. An exam ending at time t may be followed by one starting at t.',
    input: 'First line: N. Next N lines: S E W.',
    output: 'Print the maximum total weight.',
    constraints: '1 ≤ N ≤ 100000; 1 ≤ S < E ≤ 10^9; 1 ≤ W ≤ 10000',
    example_in: '4\n1 3 50\n2 5 20\n4 6 70\n6 9 60',
    example_out: '180',
    game: 'Mission 4 · Schedule the guardians! Maximize coverage without overlapping shifts.'
  },
  {
    id: 5,
    title: 'The Isolated Network',
    topic: 'Problem Solving',
    level: 'Expert',
    description: 'Each server has exactly P[i] available ports. Can cables connect all servers into one connected network while using every port? Parallel cables are allowed; self-loops are not.',
    input: 'First line: N. Second line: N integers P[i].',
    output: 'Print YES or NO.',
    constraints: '1 ≤ N ≤ 100000; 0 ≤ P[i] ≤ 10^9',
    example_in: '4\n2 2 1 1',
    example_out: 'YES',
    game: 'Mission 5 · Reconnect the fleet! Use every port to rebuild one connected network.'
  }
];

const AGREEMENT_SCALE = [
  '1 Strongly disagree',
  '2 Disagree',
  '3 Neither',
  '4 Agree',
  '5 Strongly agree'
];
const GENDER_OPTIONS = ['Female', 'Male', 'Other', 'Prefer not to say'];
const PRACTICE_HOURS_OPTIONS = ['0–1', '2–3', '4–5', '6–7', '8 or more'];
const OTHER_PRACTICE_OPTION = 'Other (specify)';
const PRE_SURVEY = {
  title: 'PRE-SURVEY',
  introduction: 'Thank you for taking part. Your answers are anonymous, are used only for this research and do not affect your course grade. Tick one box per question unless stated otherwise.',
  sections: [
    {
      title: 'Section 1. Participant code',
      questions: [
        { id: 'P1', prompt: 'Your participant code (given by the researcher):', type: 'participant' }
      ]
    },
    {
      title: 'Section 2. Prior experience',
      questions: [
        { id: 'P2', prompt: 'Before this study, how often did you practise algorithm problems outside class?', type: 'radio', required: true, options: ['Never', 'Less than once a month', '1–3 times a month', 'About once a week', 'Several times a week'] },
        { id: 'P3', prompt: 'Have you used CodinGame before?', type: 'radio', required: true, options: ['Never', 'Tried it once or twice', 'Use it occasionally', 'Use it regularly'] },
        { id: 'P4', prompt: 'Have you taken part in programming contests (ICPC, Codeforces, olympiads, etc.)?', type: 'radio', required: true, options: ['No', 'Once', 'Several times'] }
      ]
    },
    {
      title: 'Section 3. Baseline confidence',
      instruction: 'How much do you agree? "I feel confident solving … problems." (1 = Strongly disagree, 2 = Disagree, 3 = Neither agree nor disagree, 4 = Agree, 5 = Strongly agree)',
      questions: [
        { id: 'P5', prompt: '… sorting', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P6', prompt: '… graph (shortest path, traversal)', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P7', prompt: '… dynamic programming', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P8', prompt: '… time-complexity analysis', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P9', prompt: 'I feel confident solving an unfamiliar algorithm problem within 60 minutes.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ]
    },
    {
      title: 'Section 4. Baseline motivation',
      instruction: 'How much do you agree with each statement?',
      questions: [
        { id: 'P10', prompt: 'I enjoy solving algorithm problems.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P11', prompt: 'I look forward to practising algorithms.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P12', prompt: 'Practising algorithms feels like a chore.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ]
    },
    {
      title: 'Section 5. Planned practice',
      questions: [
        { id: 'P13', prompt: 'In the next 4 weeks I will mainly practise algorithms with:', type: 'radio', required: true, options: ['CodinGame', 'Textbook exercises', 'Both equally', OTHER_PRACTICE_OPTION], other: true },
        { id: 'P14', prompt: 'How many hours per week do you plan to practise algorithms?', type: 'radio', required: true, options: PRACTICE_HOURS_OPTIONS }
      ]
    },
    {
      title: 'Section 6. About you (optional)',
      questions: [
        { id: 'P15', prompt: 'Group/stream:', type: 'text' },
        { id: 'P16', prompt: 'Gender (optional):', type: 'radio', options: GENDER_OPTIONS },
        { id: 'P17', prompt: 'Age (optional):', type: 'text' }
      ]
    }
  ]
};
const POST_SURVEY = {
  title: 'POST-SURVEY (after the 4 weeks, about 5 minutes, 19 items)',
  introduction: 'Thank you for taking part. Your answers are anonymous, are used only for this research and do not affect your course grade. Tick one box per question unless stated otherwise. "The practice method I used" means CodinGame practice or textbook exercises, whichever you used during the 4 weeks.',
  sections: [
    {
      title: 'Section 1. Participant code',
      questions: [
        { id: 'S1', prompt: 'Your participant code (the same as in the pre-survey):', type: 'participant' }
      ]
    },
    {
      title: 'Section 2. Perceived usefulness',
      instruction: 'How much do you agree with each statement? (1 = Strongly disagree, 2 = Disagree, 3 = Neither agree nor disagree, 4 = Agree, 5 = Strongly agree)',
      questions: [
        { id: 'S2', prompt: 'The practice method I used helped me solve algorithm problems.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S3', prompt: 'The practice method I used helped me understand algorithms better.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S4', prompt: 'After these 4 weeks I can solve algorithm tasks faster than before.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ]
    },
    {
      title: 'Section 3. Motivation',
      questions: [
        { id: 'S5', prompt: 'I enjoyed practising with the method I used.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S6', prompt: 'The practice method I used made me want to keep practising algorithms.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S7', prompt: 'Practising algorithms felt like a chore.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ]
    },
    {
      title: 'Section 4. Task difficulty',
      questions: [
        { id: 'S8', prompt: 'I often did not understand what a task was asking.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S9', prompt: 'The tasks were too hard for my current level.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S10', prompt: 'I usually knew how to start solving a task.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ]
    },
    {
      title: 'Section 5. Practice time',
      questions: [
        { id: 'S11', prompt: 'On average, how many hours per week did you practise algorithms during the 4 weeks?', type: 'radio', required: true, options: PRACTICE_HOURS_OPTIONS },
        { id: 'S12', prompt: 'On average, on how many days per week did you practise?', type: 'radio', required: true, options: ['0', '1', '2', '3', '4', '5', '6–7'] }
      ]
    },
    {
      title: 'Section 6. Outside practice',
      questions: [
        { id: 'S13', prompt: 'During the 4 weeks I mainly practised with:', type: 'radio', required: true, options: ['CodinGame', 'Textbook exercises', 'Both', OTHER_PRACTICE_OPTION], other: true },
        { id: 'S14', prompt: 'During the 4 weeks I also used another platform or method for algorithm practice.', type: 'radio', required: true, options: ['Yes', 'No'] },
        { id: 'S15', prompt: 'If yes, which one? (tick all that apply)', type: 'checkbox', options: ['CodinGame', 'LeetCode', 'Codeforces', 'HackerRank', 'Textbook', OTHER_PRACTICE_OPTION], other: true },
        { id: 'S16', prompt: 'If yes, about how many hours per week did you spend on it?', type: 'radio', required: true, options: ['Less than 1', '1–2', '3–4', '5 or more'] }
      ]
    },
    {
      title: 'Section 7. Comment and about you (optional)',
      questions: [
        { id: 'S17', prompt: 'Was anything about the practice method hard to use? (optional)', type: 'textarea' },
        { id: 'S18', prompt: 'Gender (optional):', type: 'radio', options: GENDER_OPTIONS },
        { id: 'S19', prompt: 'Age (optional):', type: 'text' }
      ]
    }
  ]
};
const QUESTIONNAIRES = { pre: PRE_SURVEY, post: POST_SURVEY };

function allQuestions(phase) {
  return QUESTIONNAIRES[phase].sections.flatMap((section) => section.questions);
}

const TESTS = {
  1: [
    ['4\n1630000000 102\n1630000050 101\n1630000000 100\n1630000050 99', '1630000050 99\n1630000050 101\n1630000000 100\n1630000000 102'],
    ['1\n1 9', '1 9'],
    ['3\n8 3\n8 1\n9 5', '9 5\n8 1\n8 3'],
    ['5\n2 5\n2 4\n2 3\n2 2\n2 1', '2 1\n2 2\n2 3\n2 4\n2 5']
  ],
  2: [
    ['4 3\n1 2 3 -3', '2'],
    ['3 0\n0 0 0', '6'],
    ['5 3\n1 1 1 1 1', '3'],
    ['4 -1\n-1 2 -2 0', '3']
  ],
  3: [
    ['4 4\n1 2 5\n2 4 10\n1 3 2\n3 4 6', '8'],
    ['3 1\n1 2 7', '-1'],
    ['2 1\n1 2 9', '9'],
    ['4 5\n1 2 9\n2 4 9\n1 3 1\n3 4 2\n2 3 1', '3']
  ],
  4: [
    ['4\n1 3 50\n2 5 20\n4 6 70\n6 9 60', '180'],
    ['1\n1 2 5', '5'],
    ['3\n1 2 10\n2 3 20\n1 3 25', '30'],
    ['3\n1 10 50\n2 3 40\n3 4 30', '70']
  ],
  5: [
    ['4\n2 2 1 1', 'YES'],
    ['1\n0', 'YES'],
    ['1\n2', 'NO'],
    ['3\n1 1 1', 'NO'],
    ['3\n2 2 2', 'YES'],
    ['3\n4 1 1', 'NO'],
    ['2\n3 3', 'YES'],
    ['4\n0 2 2 2', 'NO']
  ]
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const statements = {
  participant: DB.prepare('SELECT * FROM participants WHERE id = ?'),
  log: DB.prepare('INSERT INTO events(participant, kind, task, ts) VALUES(?, ?, ?, ?)'),
  questionnaire: DB.prepare('SELECT answers, submitted FROM questionnaire_responses WHERE participant = ? AND phase = ?'),
  attempts: DB.prepare('SELECT task, COUNT(*) AS n, MAX(passed) AS solved FROM attempts WHERE participant = ? GROUP BY task')
};

function sendJson(res, status, data, headers = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(payload);
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  if (status === 500) console.error(error);
  sendJson(res, status, { error: status === 500 ? 'Internal server error' : error.message });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, 'Request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value;
  } catch {
    throw new HttpError(400, 'Invalid JSON request body');
  }
}

function signedSession(data) {
  const value = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + SESSION_SECONDS * 1000 })).toString('base64url');
  const signature = createHmac('sha256', SECRET_KEY).update(value).digest('base64url');
  return `${value}.${signature}`;
}

function getSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  const token = cookie.slice(COOKIE_NAME.length + 1);
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;
  const value = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac('sha256', SECRET_KEY).update(value).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function sessionCookie(data) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${COOKIE_NAME}=${signedSession(data)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function requireParticipant(req) {
  const session = getSession(req);
  if (!session?.pid) throw new HttpError(401, 'Sign in with your participant ID first.');
  const row = statements.participant.get(session.pid);
  if (!row) throw new HttpError(401, 'Participant session is no longer valid. Sign in again.');
  return row;
}

function requireAdmin(req) {
  if (!getSession(req)?.admin) throw new HttpError(403, 'Researcher sign-in is required.');
}

function logEvent(participant, kind, task = null) {
  statements.log.run(participant, kind, task, Date.now() / 1000);
}

function participantState(participant) {
  const phase = participant.phase;
  const elapsed = Date.now() / 1000 - (participant.phase_started || Date.now() / 1000);
  const attempts = Object.fromEntries(statements.attempts.all(participant.id).map((row) => [
    row.task,
    { n: row.n, solved: Boolean(row.solved) }
  ]));
  const questionnaire = QUESTIONNAIRES[phase] ? statements.questionnaire.get(participant.id, phase) : null;
  return {
    participant: { id: participant.id, grp: participant.grp, phase },
    remaining: Math.max(0, Math.floor((DURATIONS[phase] || 0) - elapsed)),
    attempts,
    done: Boolean(questionnaire),
    score: null,
    questionnaireSubmitted: Boolean(questionnaire),
    duration: DURATIONS[phase] || 0
  };
}

async function dockerRun(code, input) {
  let dir;
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), 'codelab-'));
    await chmod(dir, 0o755);
    await writeFile(path.join(dir, 'main.py'), code, { encoding: 'utf8', mode: 0o444 });
    const name = `codelab-${randomBytes(10).toString('hex')}`;
    const args = [
      'run', '--interactive', '--rm', '--name', name, '--network', 'none',
      '--cpus', '0.5', '--memory', '128m', '--memory-swap', '128m',
      '--pids-limit', '32', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--user', '65534:65534',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m',
      '--mount', `type=bind,src=${dir},dst=/work,readonly`,
      '--workdir', '/work', 'python:3.12-alpine', 'python', '-I', '-B', 'main.py'
    ];
    return await new Promise((resolve) => {
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'ignore'] });
      let output = '';
      let forcedError = null;
      let timer;
      let completed = false;
      const finish = (result) => {
        if (completed) return;
        completed = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      const stopContainer = (message) => {
        if (forcedError) return;
        forcedError = message;
        child.kill('SIGKILL');
        const killer = spawn('docker', ['kill', name], { stdio: 'ignore' });
        killer.on('error', (error) => {
          if (error.code !== 'ENOENT') console.error('Could not stop Docker container:', error);
        });
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (Buffer.byteLength(output, 'utf8') > 100_000) stopContainer('Output limit exceeded');
      });
      child.on('error', (error) => {
        finish({ error: error.code === 'ENOENT' ? 'Docker is unavailable. Install and start Docker Desktop.' : 'Docker runner unavailable.' });
      });
      child.on('close', (code) => {
        if (forcedError) finish({ error: forcedError });
        else if (code === 0) finish({ output: output.trim() });
        else finish({ error: 'Runtime error or resource limit exceeded' });
      });
      timer = setTimeout(() => stopContainer('Time limit exceeded'), 4000);
      child.stdin.on('error', (error) => {
        if (error.code !== 'EPIPE') console.error('Docker stdin error:', error);
      });
      child.stdin.end(input);
    });
  } catch (error) {
    console.error('Could not prepare Docker run:', error);
    return { error: 'Could not prepare code for the Docker runner.' };
  } finally {
    if (dir) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        console.error('Could not clean up Docker work directory:', error);
      }
    }
  }
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const EXPORTS = {
  participants: 'SELECT * FROM participants',
  attempts: 'SELECT * FROM attempts',
  quizzes: 'SELECT * FROM quizzes',
  surveys: 'SELECT * FROM surveys',
  events: 'SELECT * FROM events'
};

function questionnaireExport(phase) {
  const columns = allQuestions(phase).flatMap((question) => [
    { key: question.id, label: `${question.id}. ${question.prompt}` },
    ...(question.other ? [{ key: `${question.id}_other`, label: `${question.id} other (specify)` }] : [])
  ]);
  const participants = DB.prepare(`
    SELECT p.id, p.grp, r.answers, r.submitted
    FROM participants p
    LEFT JOIN questionnaire_responses r ON r.participant = p.id AND r.phase = ?
    ORDER BY p.created
  `).all(phase);
  const rows = [
    ['participant_id', 'group', 'submitted_at', ...columns.map((column) => column.label)],
    ...participants.map((participant) => {
      const answers = participant.answers ? JSON.parse(participant.answers) : {};
      return [
        participant.id,
        participant.grp,
        participant.submitted == null ? '' : new Date(participant.submitted * 1000).toISOString(),
        ...columns.map(({ key }) => {
          const value = answers[key];
          return Array.isArray(value) ? value.join('; ') : value ?? '';
        })
      ];
    })
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function adminRows() {
  return DB.prepare(`
    SELECT p.*,
      COALESCE(pre.submitted, pre_legacy.submitted) AS pre_survey_submitted,
      COALESCE(post.submitted, post_legacy.submitted) AS post_survey_submitted,
      (SELECT COUNT(*) FROM attempts WHERE participant = p.id) AS attempts,
      (SELECT COUNT(DISTINCT task) FROM attempts WHERE participant = p.id AND passed = 1) AS solved,
      (SELECT ROUND(AVG(elapsed), 1) FROM attempts WHERE participant = p.id AND passed = 1) AS avg_solve_time
    FROM participants p
    LEFT JOIN questionnaire_responses pre ON pre.participant = p.id AND pre.phase = 'pre'
    LEFT JOIN questionnaire_responses post ON post.participant = p.id AND post.phase = 'post'
    LEFT JOIN quizzes pre_legacy ON pre_legacy.participant = p.id AND pre_legacy.phase = 'pre'
    LEFT JOIN quizzes post_legacy ON post_legacy.participant = p.id AND post_legacy.phase = 'post'
    ORDER BY p.created
  `).all();
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const session = getSession(req);
    const participant = session?.pid ? statements.participant.get(session.pid) : null;
    return sendJson(res, 200, participant ? participantState(participant) : { participant: null });
  }

  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    const participant = requireParticipant(req);
    return sendJson(res, 200, {
      tasks: TASKS,
      questionnaire: QUESTIONNAIRES[participant.phase] ? {
        ...QUESTIONNAIRES[participant.phase],
        participantId: participant.id
      } : null
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readJson(req);
    const id = typeof body.id === 'string' ? body.id.trim().toUpperCase() : '';
    if (!/^[A-Z0-9_-]{3,24}$/.test(id)) {
      throw new HttpError(400, 'Use 3–24 letters, digits, - or _.');
    }
    let participant = statements.participant.get(id);
    if (!participant) {
      const groups = DB.prepare('SELECT grp, COUNT(*) AS total FROM participants GROUP BY grp').all();
      const counts = Object.fromEntries(groups.map((row) => [row.grp, row.total]));
      const a = counts.A || 0;
      const b = counts.B || 0;
      const group = a < b ? 'A' : b < a ? 'B' : randomBytes(1)[0] % 2 === 0 ? 'A' : 'B';
      DB.prepare('INSERT INTO participants(id, grp, created, phase, phase_started) VALUES(?, ?, ?, ?, ?)').run(
        id, group, new Date().toISOString(), 'pre', Date.now() / 1000
      );
      participant = statements.participant.get(id);
    }
    logEvent(id, 'login');
    return sendJson(res, 200, participantState(participant), { 'Set-Cookie': sessionCookie({ pid: id }) });
  }

  if (req.method === 'POST' && url.pathname === '/api/questionnaire') {
    const participant = requireParticipant(req);
    const questionnaire = QUESTIONNAIRES[participant.phase];
    if (!questionnaire) throw new HttpError(403, 'A questionnaire is not available in this phase.');
    const body = await readJson(req);
    if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
      throw new HttpError(400, 'Questionnaire answers must be submitted as an object.');
    }
    const questions = allQuestions(participant.phase);
    const allowedKeys = new Set(questions.flatMap((question) => question.other
      ? [question.id, `${question.id}_other`]
      : [question.id]));
    if (Object.keys(body.answers).some((key) => !allowedKeys.has(key))) {
      throw new HttpError(400, 'Questionnaire contains an unknown answer field.');
    }
    for (const question of questions) {
      const answer = body.answers[question.id];
      if (question.type === 'participant') {
        if (answer !== participant.id) throw new HttpError(400, 'Participant code does not match your sign-in ID.');
      } else if (question.type === 'radio') {
        const conditionallyRequired = participant.phase === 'post' &&
          question.id === 'S16' && body.answers.S14 === 'Yes';
        const required = question.required && (question.id !== 'S16' || conditionallyRequired);
        if (required && (typeof answer !== 'string' || !question.options.includes(answer))) {
          throw new HttpError(400, `${question.id} requires an answer.`);
        }
        if (answer !== undefined && answer !== '' && !question.options.includes(answer)) {
          throw new HttpError(400, `${question.id} has an invalid option.`);
        }
      } else if (question.type === 'checkbox') {
        if (answer !== undefined && (!Array.isArray(answer) ||
            answer.some((option) => !question.options.includes(option)) ||
            new Set(answer).size !== answer.length)) {
          throw new HttpError(400, `${question.id} contains an invalid selection.`);
        }
      } else if (question.type === 'text' || question.type === 'textarea') {
        if (answer !== undefined && (typeof answer !== 'string' || answer.length > 500)) {
          throw new HttpError(400, `${question.id} must be text of at most 500 characters.`);
        }
      }
      if (participant.phase === 'post' && body.answers.S14 === 'Yes' &&
          (!Array.isArray(body.answers.S15) || body.answers.S15.length === 0)) {
        throw new HttpError(400, 'S15 requires at least one selection when S14 is Yes.');
      }
      if (participant.phase === 'post' && body.answers.S14 !== 'Yes' &&
          ((Array.isArray(body.answers.S15) && body.answers.S15.length > 0) || body.answers.S16)) {
        throw new HttpError(400, 'S15 and S16 should only be answered when S14 is Yes.');
      }
      const other = body.answers[`${question.id}_other`];
      const selectedOther = question.type === 'checkbox'
        ? Array.isArray(answer) && answer.includes(OTHER_PRACTICE_OPTION)
        : answer === OTHER_PRACTICE_OPTION;
      if (question.other && selectedOther && (typeof other !== 'string' || !other.trim() || other.length > 500)) {
        throw new HttpError(400, `${question.id}: please specify your other answer.`);
      }
      if (question.other && other !== undefined && (typeof other !== 'string' || other.length > 500)) {
        throw new HttpError(400, `${question.id} other answer must be at most 500 characters.`);
      }
    }
    if (statements.questionnaire.get(participant.id, participant.phase)) {
      throw new HttpError(409, 'This questionnaire has already been submitted.');
    }
    const answers = Object.fromEntries(questions.flatMap((question) => {
      const answer = body.answers[question.id];
      const value = question.type === 'participant' ? participant.id
        : question.type === 'checkbox' ? (answer || [])
          : answer || '';
      return question.other
        ? [[question.id, value], [`${question.id}_other`, body.answers[`${question.id}_other`] || '']]
        : [[question.id, value]];
    }));
    DB.prepare('INSERT INTO questionnaire_responses(participant, phase, answers, submitted) VALUES(?, ?, ?, ?)').run(
      participant.id, participant.phase, JSON.stringify(answers), Date.now() / 1000
    );
    logEvent(participant.id, `${participant.phase}_questionnaire`);
    return sendJson(res, 200, participantState(statements.participant.get(participant.id)));
  }

  if (req.method === 'POST' && url.pathname === '/api/advance') {
    const participant = requireParticipant(req);
    const index = PHASES.indexOf(participant.phase);
    if (index < 0 || index >= PHASES.length - 1) throw new HttpError(400, 'There is no next phase.');
    if (QUESTIONNAIRES[participant.phase] && !statements.questionnaire.get(participant.id, participant.phase)) {
      throw new HttpError(400, 'Complete the questionnaire first.');
    }
    const nextPhase = PHASES[index + 1];
    DB.prepare('UPDATE participants SET phase = ?, phase_started = ?, finished = ? WHERE id = ?').run(
      nextPhase, Date.now() / 1000, Number(nextPhase === 'finished'), participant.id
    );
    logEvent(participant.id, 'advance');
    return sendJson(res, 200, participantState(statements.participant.get(participant.id)));
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/submit/')) {
    const participant = requireParticipant(req);
    if (participant.phase !== 'experiment') throw new HttpError(403, 'Code submissions are only available during the contest.');
    const taskId = Number(url.pathname.slice('/api/submit/'.length));
    if (!Number.isInteger(taskId) || !TESTS[taskId]) throw new HttpError(404, 'Task not found.');
    const elapsed = Date.now() / 1000 - (participant.phase_started || Date.now() / 1000);
    if (elapsed > DURATIONS.experiment + 10) throw new HttpError(403, 'Experiment time is over.');
    const body = await readJson(req);
    if (typeof body.code !== 'string' || body.code.length > 20_000) {
      throw new HttpError(400, 'Code must be text and at most 20,000 characters.');
    }
    if (process.env.ENABLE_DOCKER_JUDGE !== '1') {
      throw new HttpError(503, 'Code judge is disabled. Ask the administrator to enable Docker judging.');
    }

    let passed = 0;
    let verdict = 'Wrong Answer';
    for (const [input, expected] of TESTS[taskId]) {
      const result = await dockerRun(body.code, input);
      if (result.error) {
        verdict = result.error;
        break;
      }
      if (result.output !== expected.trim()) break;
      passed += 1;
    }
    if (passed === TESTS[taskId].length) verdict = 'Accepted';
    DB.prepare(`
      INSERT INTO attempts(participant, task, submitted, elapsed, passed, passed_tests, total_tests, code_hash, code_length, verdict)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      participant.id, taskId, Date.now() / 1000, elapsed, Number(passed === TESTS[taskId].length),
      passed, TESTS[taskId].length, createHash('sha256').update(body.code).digest('hex'), body.code.length, verdict
    );
    logEvent(participant.id, 'submit', taskId);
    return sendJson(res, 200, {
      verdict,
      passed,
      total: TESTS[taskId].length,
      accepted: passed === TESTS[taskId].length
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/event') {
    const participant = requireParticipant(req);
    const body = await readJson(req);
    if (!['task_open', 'editor_focus', 'run_click'].includes(body.kind)) {
      throw new HttpError(400, 'Unknown event kind.');
    }
    const task = Number.isInteger(body.task) && body.task >= 1 && body.task <= 5 ? body.task : null;
    logEvent(participant.id, body.kind, task);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    if (!ADMIN_PASSWORD) throw new HttpError(503, 'Researcher access is disabled until ADMIN_PASSWORD is configured.');
    const body = await readJson(req);
    const submitted = typeof body.password === 'string' ? Buffer.from(body.password) : Buffer.alloc(0);
    const expected = Buffer.from(ADMIN_PASSWORD);
    if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
      throw new HttpError(401, 'Incorrect password.');
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie({ admin: true }) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/data') {
    requireAdmin(req);
    return sendJson(res, 200, { rows: adminRows() });
  }

  const exportMatch = url.pathname.match(/^\/api\/admin\/export\/([a-z_]+)$/);
  if (req.method === 'GET' && exportMatch) {
    requireAdmin(req);
    if (exportMatch[1] === 'pre_survey' || exportMatch[1] === 'post_survey') {
      const phase = exportMatch[1] === 'pre_survey' ? 'pre' : 'post';
      const csv = questionnaireExport(phase);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportMatch[1]}.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(`\uFEFF${csv}\r\n`);
    }
    const query = EXPORTS[exportMatch[1]];
    if (!query) throw new HttpError(404, 'Export not found.');
    const result = DB.prepare(query).all();
    const headers = result.length ? Object.keys(result[0]) : DB.prepare(query).columns().map((column) => column.name);
    const csv = [headers, ...result.map((row) => headers.map((header) => row[header]))]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportMatch[1]}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(`\uFEFF${csv}\r\n`);
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  throw new HttpError(404, 'API endpoint not found.');
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      return await handleApi(req, res, url);
    } catch (error) {
      return sendError(res, error);
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }

  const file = url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/index.html'
    ? 'index.html'
    : url.pathname === '/app.js' || url.pathname === '/style.css' || url.pathname === '/demo-data.js'
      ? url.pathname.slice(1)
      : null;
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  try {
    const content = await readFile(path.join(PUBLIC, file));
    const contentType = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error('Could not serve frontend file:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Could not load the application frontend.');
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('Unexpected request handler error:', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
    else res.destroy(error);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`CodeLab Experiment is running at http://${HOST}:${PORT}`);
});

function close() {
  server.close(() => {
    DB.close();
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
