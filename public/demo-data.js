export const TASKS = [
  {
    id: 1, title: 'The Server Log Sorter', topic: 'Sorting', level: 'Easy',
    description: 'You are given N server connection logs, each containing a Unix timestamp and user ID. Sort by timestamp descending; break ties by user ID ascending.',
    input: 'First line: N. Next N lines: Timestamp UserID.',
    output: 'Print N sorted lines, each with Timestamp UserID.',
    constraints: '1 ≤ N ≤ 100000; 1 ≤ Timestamp, UserID ≤ 10^9',
    example_in: '4\n1630000000 102\n1630000050 101\n1630000000 100\n1630000050 99',
    example_out: '1630000050 99\n1630000050 101\n1630000000 100\n1630000000 102',
    game: 'Mission 1 · Restore the event timeline! Your command center must process the latest signals first.'
  },
  {
    id: 2, title: 'The Contiguous Subarray Target', topic: 'Algorithmic Efficiency', level: 'Medium',
    description: 'Count contiguous subarrays whose sum equals K. An O(N²) solution is too slow; target O(N).',
    input: 'First line: N K. Second line: N integers.',
    output: 'Print the number of valid subarrays.',
    constraints: '1 ≤ N ≤ 200000; −10^9 ≤ K ≤ 10^9; −10^4 ≤ A[i] ≤ 10^4',
    example_in: '4 3\n1 2 3 -3', example_out: '2',
    game: 'Mission 2 · Decode the energy stream! Count target-sum segments before the clock runs out.'
  },
  {
    id: 3, title: 'Campus Food Routing', topic: 'Graphs', level: 'Medium–Hard',
    description: 'Find the minimum travel time from node 1 to node N in an undirected graph with positive weighted edges. Print -1 if unreachable.',
    input: 'First line: N M. Next M lines: U V W.',
    output: 'Print the minimum delivery time, or -1.',
    constraints: '2 ≤ N ≤ 10000; 1 ≤ M ≤ 100000; 1 ≤ W ≤ 1000',
    example_in: '4 4\n1 2 5\n2 4 10\n1 3 2\n3 4 6', example_out: '8',
    game: 'Mission 3 · Deliver supplies! Find the fastest route through the campus network.'
  },
  {
    id: 4, title: "The Proctor's Schedule", topic: 'Dynamic Programming', level: 'Hard',
    description: 'Select non-overlapping exams to maximize the sum of their priority weights. An exam ending at time t may be followed by one starting at t.',
    input: 'First line: N. Next N lines: S E W.',
    output: 'Print the maximum total weight.',
    constraints: '1 ≤ N ≤ 100000; 1 ≤ S < E ≤ 10^9; 1 ≤ W ≤ 10000',
    example_in: '4\n1 3 50\n2 5 20\n4 6 70\n6 9 60', example_out: '180',
    game: 'Mission 4 · Schedule the guardians! Maximize coverage without overlapping shifts.'
  },
  {
    id: 5, title: 'The Isolated Network', topic: 'Problem Solving', level: 'Expert',
    description: 'Each server has exactly P[i] available ports. Can cables connect all servers into one connected network while using every port? Parallel cables are allowed; self-loops are not.',
    input: 'First line: N. Second line: N integers P[i].',
    output: 'Print YES or NO.',
    constraints: '1 ≤ N ≤ 100000; 0 ≤ P[i] ≤ 10^9',
    example_in: '4\n2 2 1 1', example_out: 'YES',
    game: 'Mission 5 · Reconnect the fleet! Use every port to rebuild one connected network.'
  }
];

const AGREEMENT_SCALE = [
  '1 Strongly disagree', '2 Disagree', '3 Neither', '4 Agree', '5 Strongly agree'
];
const GENDER_OPTIONS = ['Female', 'Male', 'Other', 'Prefer not to say'];
const PRACTICE_HOURS_OPTIONS = ['0–1', '2–3', '4–5', '6–7', '8 or more'];
const OTHER = 'Other (specify)';

export const QUESTIONNAIRES = {
  pre: {
    title: 'PRE-SURVEY',
    introduction: 'Thank you for taking part. Your answers are anonymous, are used only for this research and do not affect your course grade. Tick one box per question unless stated otherwise.',
    sections: [
      { title: 'Section 1. Participant code', questions: [
        { id: 'P1', prompt: 'Your participant code (given by the researcher):', type: 'participant' }
      ] },
      { title: 'Section 2. Prior experience', questions: [
        { id: 'P2', prompt: 'Before this study, how often did you practise algorithm problems outside class?', type: 'radio', required: true, options: ['Never', 'Less than once a month', '1–3 times a month', 'About once a week', 'Several times a week'] },
        { id: 'P3', prompt: 'Have you used CodinGame before?', type: 'radio', required: true, options: ['Never', 'Tried it once or twice', 'Use it occasionally', 'Use it regularly'] },
        { id: 'P4', prompt: 'Have you taken part in programming contests (ICPC, Codeforces, olympiads, etc.)?', type: 'radio', required: true, options: ['No', 'Once', 'Several times'] }
      ] },
      { title: 'Section 3. Baseline confidence', instruction: 'How much do you agree? "I feel confident solving … problems." (1 = Strongly disagree, 2 = Disagree, 3 = Neither agree nor disagree, 4 = Agree, 5 = Strongly agree)', questions: [
        { id: 'P5', prompt: '… sorting', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P6', prompt: '… graph (shortest path, traversal)', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P7', prompt: '… dynamic programming', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P8', prompt: '… time-complexity analysis', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P9', prompt: 'I feel confident solving an unfamiliar algorithm problem within 60 minutes.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ] },
      { title: 'Section 4. Baseline motivation', instruction: 'How much do you agree with each statement?', questions: [
        { id: 'P10', prompt: 'I enjoy solving algorithm problems.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P11', prompt: 'I look forward to practising algorithms.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'P12', prompt: 'Practising algorithms feels like a chore.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ] },
      { title: 'Section 5. Planned practice', questions: [
        { id: 'P13', prompt: 'In the next 4 weeks I will mainly practise algorithms with:', type: 'radio', required: true, options: ['CodinGame', 'Textbook exercises', 'Both equally', OTHER], other: true },
        { id: 'P14', prompt: 'How many hours per week do you plan to practise algorithms?', type: 'radio', required: true, options: PRACTICE_HOURS_OPTIONS }
      ] },
      { title: 'Section 6. About you (optional)', questions: [
        { id: 'P15', prompt: 'Group/stream:', type: 'text' },
        { id: 'P16', prompt: 'Gender (optional):', type: 'radio', options: GENDER_OPTIONS },
        { id: 'P17', prompt: 'Age (optional):', type: 'text' }
      ] }
    ]
  },
  post: {
    title: 'POST-SURVEY (after the 4 weeks, about 5 minutes, 19 items)',
    introduction: 'Thank you for taking part. Your answers are anonymous, are used only for this research and do not affect your course grade. Tick one box per question unless stated otherwise. "The practice method I used" means CodinGame practice or textbook exercises, whichever you used during the 4 weeks.',
    sections: [
      { title: 'Section 1. Participant code', questions: [
        { id: 'S1', prompt: 'Your participant code (the same as in the pre-survey):', type: 'participant' }
      ] },
      { title: 'Section 2. Perceived usefulness', instruction: 'How much do you agree with each statement? (1 = Strongly disagree, 2 = Disagree, 3 = Neither agree nor disagree, 4 = Agree, 5 = Strongly agree)', questions: [
        { id: 'S2', prompt: 'The practice method I used helped me solve algorithm problems.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S3', prompt: 'The practice method I used helped me understand algorithms better.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S4', prompt: 'After these 4 weeks I can solve algorithm tasks faster than before.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ] },
      { title: 'Section 3. Motivation', questions: [
        { id: 'S5', prompt: 'I enjoyed practising with the method I used.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S6', prompt: 'The practice method I used made me want to keep practising algorithms.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S7', prompt: 'Practising algorithms felt like a chore.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ] },
      { title: 'Section 4. Task difficulty', questions: [
        { id: 'S8', prompt: 'I often did not understand what a task was asking.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S9', prompt: 'The tasks were too hard for my current level.', type: 'radio', required: true, options: AGREEMENT_SCALE },
        { id: 'S10', prompt: 'I usually knew how to start solving a task.', type: 'radio', required: true, options: AGREEMENT_SCALE }
      ] },
      { title: 'Section 5. Practice time', questions: [
        { id: 'S11', prompt: 'On average, how many hours per week did you practise algorithms during the 4 weeks?', type: 'radio', required: true, options: PRACTICE_HOURS_OPTIONS },
        { id: 'S12', prompt: 'On average, on how many days per week did you practise?', type: 'radio', required: true, options: ['0', '1', '2', '3', '4', '5', '6–7'] }
      ] },
      { title: 'Section 6. Outside practice', questions: [
        { id: 'S13', prompt: 'During the 4 weeks I mainly practised with:', type: 'radio', required: true, options: ['CodinGame', 'Textbook exercises', 'Both', OTHER], other: true },
        { id: 'S14', prompt: 'During the 4 weeks I also used another platform or method for algorithm practice.', type: 'radio', required: true, options: ['Yes', 'No'] },
        { id: 'S15', prompt: 'If yes, which one? (tick all that apply)', type: 'checkbox', options: ['CodinGame', 'LeetCode', 'Codeforces', 'HackerRank', 'Textbook', OTHER], other: true },
        { id: 'S16', prompt: 'If yes, about how many hours per week did you spend on it?', type: 'radio', required: true, options: ['Less than 1', '1–2', '3–4', '5 or more'] }
      ] },
      { title: 'Section 7. Comment and about you (optional)', questions: [
        { id: 'S17', prompt: 'Was anything about the practice method hard to use? (optional)', type: 'textarea' },
        { id: 'S18', prompt: 'Gender (optional):', type: 'radio', options: GENDER_OPTIONS },
        { id: 'S19', prompt: 'Age (optional):', type: 'text' }
      ] }
    ]
  }
};
