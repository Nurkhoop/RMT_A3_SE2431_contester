import os, sqlite3, secrets, json, time, subprocess, tempfile, pathlib, csv, io, hashlib
from datetime import datetime, timezone
from functools import wraps
from flask import Flask, request, session, redirect, url_for, render_template, jsonify, Response, abort

ROOT=pathlib.Path(__file__).parent
app=Flask(__name__)
app.secret_key=os.environ.get('SECRET_KEY',secrets.token_hex(32))
app.config.update(SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Lax')
DB=ROOT/'experiment.sqlite3'
ADMIN_PASSWORD=os.environ.get('ADMIN_PASSWORD','')
DURATION={'pre':600,'experiment':1500,'post':600,'survey':300}
TASKS=[
{'id':1,'title':'The Server Log Sorter','topic':'Sorting','level':'Easy','description':'You are given N server connection logs, each containing a Unix timestamp and user ID. Sort by timestamp descending; break ties by user ID ascending.','input':'First line: N. Next N lines: Timestamp UserID.','output':'Print N sorted lines, each with Timestamp UserID.','constraints':'1 ≤ N ≤ 100000; 1 ≤ Timestamp, UserID ≤ 10^9','example_in':'4\n1630000000 102\n1630000050 101\n1630000000 100\n1630000050 99','example_out':'1630000050 99\n1630000050 101\n1630000000 100\n1630000000 102','game':'Mission 1 · Restore the event timeline! Your command center must process the latest signals first.'},
{'id':2,'title':'The Contiguous Subarray Target','topic':'Algorithmic Efficiency','level':'Medium','description':'Count contiguous subarrays whose sum equals K. An O(N²) solution is too slow; target O(N).','input':'First line: N K. Second line: N integers.','output':'Print the number of valid subarrays.','constraints':'1 ≤ N ≤ 200000; −10^9 ≤ K ≤ 10^9; −10^4 ≤ A[i] ≤ 10^4','example_in':'4 3\n1 2 3 -3','example_out':'2','game':'Mission 2 · Decode the energy stream! Count target-sum segments before the clock runs out.'},
{'id':3,'title':'Campus Food Routing','topic':'Graphs','level':'Medium–Hard','description':'Find the minimum travel time from node 1 to node N in an undirected graph with positive weighted edges. Print -1 if unreachable.','input':'First line: N M. Next M lines: U V W.','output':'Print the minimum delivery time, or -1.','constraints':'2 ≤ N ≤ 10000; 1 ≤ M ≤ 100000; 1 ≤ W ≤ 1000','example_in':'4 4\n1 2 5\n2 4 10\n1 3 2\n3 4 6','example_out':'8','game':'Mission 3 · Deliver supplies! Find the fastest route through the campus network.'},
{'id':4,'title':"The Proctor's Schedule",'topic':'Dynamic Programming','level':'Hard','description':'Select non-overlapping exams to maximize the sum of their priority weights. An exam ending at time t may be followed by one starting at t.','input':'First line: N. Next N lines: S E W.','output':'Print the maximum total weight.','constraints':'1 ≤ N ≤ 100000; 1 ≤ S < E ≤ 10^9; 1 ≤ W ≤ 10000','example_in':'4\n1 3 50\n2 5 20\n4 6 70\n6 9 60','example_out':'180','game':'Mission 4 · Schedule the guardians! Maximize coverage without overlapping shifts.'},
{'id':5,'title':'The Isolated Network','topic':'Problem Solving','level':'Expert','description':'Each server has exactly P[i] available ports. Can cables connect all servers into one connected network while using every port? Parallel cables are allowed; self-loops are not.','input':'First line: N. Second line: N integers P[i].','output':'Print YES or NO.','constraints':'1 ≤ N ≤ 100000; 0 ≤ P[i] ≤ 10^9','example_in':'4\n2 2 1 1','example_out':'YES','game':'Mission 5 · Reconnect the fleet! Use every port to rebuild one connected network.'}
]
QUIZZES={'pre':[
('What is the worst-case time complexity of sorting N items with Python sorted()?',['O(1)','O(N)','O(N log N)','O(N²)'],2),
('Which data structure typically supports average O(1) key lookup?',['List','Dictionary','Queue','Stack'],1),
('Which algorithm finds shortest paths with nonnegative edge weights?',['DFS','Dijkstra','Merge sort','Binary search'],1),
('What does dynamic programming primarily reuse?',['Random numbers','Previously computed subproblem results','Only recursion depth','Network requests'],1),
('Which statement about a contiguous subarray is true?',['Its elements need not be adjacent','Its elements occupy consecutive positions','It must be sorted','It must contain all elements'],1)],
'post':[
('For sorting by two keys, which Python feature is useful?',['Custom key tuple','Global variable','Infinite loop','Random shuffle'],0),
('Which approach counts target-sum subarrays in O(N)?',['Prefix sums with frequency map','Bubble sort','Nested enumeration','Repeated slicing'],0),
('Which structure efficiently selects the next closest node in Dijkstra?',['Min-heap','Stack only','Set of strings','Plain recursion'],0),
('Weighted interval scheduling commonly combines DP with what?',['Binary search','Bubble sort','DFS traversal','Random sampling'],0),
('For a graph with no self-loops, the sum of degrees must be:',['Odd','Even','Prime','Equal to N'],1)]}

def conn():
 c=sqlite3.connect(DB,timeout=15);c.row_factory=sqlite3.Row;c.execute('PRAGMA journal_mode=WAL');return c

def init():
 with conn() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY, grp TEXT NOT NULL, created TEXT NOT NULL, phase TEXT DEFAULT 'pre', phase_started REAL, finished INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,participant TEXT,task INTEGER,submitted REAL,elapsed REAL,passed INTEGER,passed_tests INTEGER,total_tests INTEGER,code_hash TEXT,code_length INTEGER,verdict TEXT);CREATE TABLE IF NOT EXISTS quizzes(participant TEXT,phase TEXT,score INTEGER,answers TEXT,submitted REAL,PRIMARY KEY(participant,phase));CREATE TABLE IF NOT EXISTS surveys(participant TEXT PRIMARY KEY,motivation INTEGER,engagement INTEGER,difficulty INTEGER,feedback TEXT,submitted REAL);CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,participant TEXT,kind TEXT,task INTEGER,ts REAL);''')
init()

def participant():
 pid=session.get('pid')
 if not pid:return None
 with conn() as c:return c.execute('SELECT * FROM participants WHERE id=?',(pid,)).fetchone()

def log(pid,kind,task=None):
 with conn() as c:c.execute('INSERT INTO events(participant,kind,task,ts) VALUES(?,?,?,?)',(pid,kind,task,time.time()))

def admin_required(f):
 @wraps(f)
 def inner(*a,**kw):
  if not session.get('admin'):abort(403)
  return f(*a,**kw)
 return inner

@app.route('/',methods=['GET','POST'])
def home():
 if request.method=='POST':
  pid=request.form.get('id','').strip().upper()
  if not (3<=len(pid)<=24 and all(x.isalnum() or x in '-_' for x in pid)):return render_template('home.html',error='Use 3–24 letters, digits, - or _.')
  with conn() as c:
   row=c.execute('SELECT * FROM participants WHERE id=?',(pid,)).fetchone()
   if not row:
    n=c.execute('SELECT COUNT(*) FROM participants WHERE grp="A"').fetchone()[0];m=c.execute('SELECT COUNT(*) FROM participants WHERE grp="B"').fetchone()[0]
    grp='A' if n<m else 'B' if m<n else secrets.choice(['A','B'])
    c.execute('INSERT INTO participants(id,grp,created,phase,phase_started) VALUES(?,?,?,?,?)',(pid,grp,datetime.now(timezone.utc).isoformat(),'pre',time.time()))
  session['pid']=pid;log(pid,'login');return redirect(url_for('workspace'))
 return render_template('home.html')

@app.route('/workspace')
def workspace():
 p=participant()
 if not p:return redirect(url_for('home'))
 phase=p['phase'];remaining=max(0,int(DURATION.get(phase,0)-(time.time()-(p['phase_started'] or time.time()))))
 with conn() as c:
  attempts=c.execute('SELECT task,COUNT(*) n,MAX(passed) solved FROM attempts WHERE participant=? GROUP BY task',(p['id'],)).fetchall()
  quiz=c.execute('SELECT score FROM quizzes WHERE participant=? AND phase=?',(p['id'],phase)).fetchone()
  survey=c.execute('SELECT 1 FROM surveys WHERE participant=?',(p['id'],)).fetchone()
 return render_template('workspace.html',p=p,phase=phase,tasks=TASKS,quiz=QUIZZES.get(phase),remaining=remaining,attempts={x['task']:dict(x) for x in attempts},done=bool(quiz) if phase in ('pre','post') else bool(survey) if phase=='survey' else False)

@app.post('/quiz')
def quiz_submit():
 p=participant()
 if not p or p['phase'] not in QUIZZES:abort(403)
 phase=p['phase'];answers=[request.form.get(f'q{i}','') for i in range(5)];score=sum(a==str(q[2]) for a,q in zip(answers,QUIZZES[phase]))
 with conn() as c:c.execute('INSERT OR IGNORE INTO quizzes VALUES(?,?,?,?,?)',(p['id'],phase,score,json.dumps(answers),time.time()))
 log(p['id'],'quiz_'+phase);return redirect(url_for('workspace'))

@app.post('/advance')
def advance():
 p=participant()
 if not p:abort(403)
 order=['pre','experiment','post','survey','finished'];idx=order.index(p['phase'])
 with conn() as c:
  if p['phase'] in QUIZZES and not c.execute('SELECT 1 FROM quizzes WHERE participant=? AND phase=?',(p['id'],p['phase'])).fetchone():abort(400,'Complete the quiz first')
  if p['phase']=='survey' and not c.execute('SELECT 1 FROM surveys WHERE participant=?',(p['id'],)).fetchone():abort(400,'Complete the survey first')
  if idx>=4:abort(400)
  c.execute('UPDATE participants SET phase=?,phase_started=?,finished=? WHERE id=?',(order[idx+1],time.time(),int(idx==3),p['id']))
 log(p['id'],'advance');return redirect(url_for('workspace'))

@app.post('/survey')
def survey_submit():
 p=participant()
 if not p or p['phase']!='survey':abort(403)
 vals=[]
 for k in ['motivation','engagement','difficulty']:
  try:v=int(request.form[k]);assert 1<=v<=5
  except (ValueError,KeyError,AssertionError):abort(400)
  vals.append(v)
 with conn() as c:c.execute('INSERT OR REPLACE INTO surveys VALUES(?,?,?,?,?,?)',(p['id'],*vals,request.form.get('feedback','')[:500],time.time()))
 log(p['id'],'survey');return redirect(url_for('workspace'))

# Public and private tests. Hidden cases are not transmitted to browsers.
TESTS={
1:[('4\n1630000000 102\n1630000050 101\n1630000000 100\n1630000050 99','1630000050 99\n1630000050 101\n1630000000 100\n1630000000 102'),('1\n1 9','1 9'),('3\n8 3\n8 1\n9 5','9 5\n8 1\n8 3'),('5\n2 5\n2 4\n2 3\n2 2\n2 1','2 1\n2 2\n2 3\n2 4\n2 5')],
2:[('4 3\n1 2 3 -3','2'),('3 0\n0 0 0','6'),('5 3\n1 1 1 1 1','3'),('4 -1\n-1 2 -2 0','3')],
3:[('4 4\n1 2 5\n2 4 10\n1 3 2\n3 4 6','8'),('3 1\n1 2 7','-1'),('2 1\n1 2 9','9'),('4 5\n1 2 9\n2 4 9\n1 3 1\n3 4 2\n2 3 1','3')],
4:[('4\n1 3 50\n2 5 20\n4 6 70\n6 9 60','180'),('1\n1 2 5','5'),('3\n1 2 10\n2 3 20\n1 3 25','30'),('3\n1 10 50\n2 3 40\n3 4 30','70')],
5:[('4\n2 2 1 1','YES'),('1\n0','YES'),('1\n2','NO'),('3\n1 1 1','NO'),('3\n2 2 2','YES'),('3\n4 1 1','NO'),('2\n3 3','YES'),('4\n0 2 2 2','NO')]
}

def run_code(code,input_text):
 # Requires Docker; never execute participant code in the Flask host process.
 if not os.environ.get('ENABLE_DOCKER_JUDGE'):return None,'Judge disabled: configure Docker runner (README).'
 with tempfile.TemporaryDirectory(prefix='codelab_') as tmp:
  path=pathlib.Path(tmp);(path/'main.py').write_text(code,encoding='utf-8');(path/'input.txt').write_text(input_text,encoding='utf-8')
  cmd=['docker','run','--rm','--network','none','--cpus','0.5','--memory','128m','--memory-swap','128m','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=8m','--mount',f'type=bind,src={path},dst=/work,readonly','--workdir','/work','python:3.12-alpine','python','-I','-B','main.py']
  try:
   r=subprocess.run(cmd,input=input_text,text=True,capture_output=True,timeout=4)
   if r.returncode!=0:return None,'Runtime error or resource limit exceeded'
   if len(r.stdout)>100000:return None,'Output limit exceeded'
   return r.stdout.strip(),None
  except subprocess.TimeoutExpired:return None,'Time limit exceeded'
  except (OSError,subprocess.SubprocessError):return None,'Docker runner unavailable'

@app.post('/submit/<int:task_id>')
def submit(task_id):
 p=participant()
 if not p or p['phase']!='experiment' or task_id not in TESTS:abort(403)
 elapsed=time.time()-p['phase_started']
 if elapsed>DURATION['experiment']+10:return jsonify(error='Experiment time is over'),403
 code=request.get_json(silent=True) or {};code=code.get('code','')
 if not isinstance(code,str) or len(code)>20000:return jsonify(error='Code must be at most 20,000 characters'),400
 if not os.environ.get('ENABLE_DOCKER_JUDGE'):return jsonify(error='Code judge is not enabled. Ask the administrator to configure Docker.'),503
 passed=0;verdict='Wrong Answer'
 for inp,expected in TESTS[task_id]:
  output,error=run_code(code,inp)
  if error:verdict=error;break
  if output!=expected.strip():break
  passed+=1
 else:verdict='Accepted'
 with conn() as c:c.execute('INSERT INTO attempts(participant,task,submitted,elapsed,passed,passed_tests,total_tests,code_hash,code_length,verdict) VALUES(?,?,?,?,?,?,?,?,?,?)',(p['id'],task_id,time.time(),elapsed,int(passed==len(TESTS[task_id])),passed,len(TESTS[task_id]),hashlib.sha256(code.encode()).hexdigest(),len(code),verdict))
 log(p['id'],'submit',task_id)
 return jsonify(verdict=verdict,passed=passed,total=len(TESTS[task_id]),accepted=passed==len(TESTS[task_id]))

@app.post('/event')
def event():
 p=participant()
 if not p:abort(403)
 data=request.get_json(silent=True) or {};kind=data.get('kind','')
 if kind not in ('task_open','editor_focus','run_click'):abort(400)
 task=data.get('task');task=task if isinstance(task,int) and 1<=task<=5 else None
 log(p['id'],kind,task);return jsonify(ok=True)

@app.route('/admin',methods=['GET','POST'])
def admin():
 if request.method=='POST':
  if ADMIN_PASSWORD and secrets.compare_digest(request.form.get('password',''),ADMIN_PASSWORD):session['admin']=True
  else:return render_template('admin.html',locked=True,error='Incorrect password or ADMIN_PASSWORD not configured')
 if not session.get('admin'):return render_template('admin.html',locked=True)
 with conn() as c:
  rows=c.execute('''SELECT p.*, (SELECT score FROM quizzes WHERE participant=p.id AND phase='pre') pre,(SELECT score FROM quizzes WHERE participant=p.id AND phase='post') post,(SELECT COUNT(*) FROM attempts WHERE participant=p.id) attempts,(SELECT COUNT(DISTINCT task) FROM attempts WHERE participant=p.id AND passed=1) solved,(SELECT ROUND(AVG(elapsed),1) FROM attempts WHERE participant=p.id AND passed=1) avg_solve_time,s.motivation,s.engagement,s.difficulty FROM participants p LEFT JOIN surveys s ON s.participant=p.id ORDER BY p.created''').fetchall()
 return render_template('admin.html',locked=False,rows=rows)

@app.get('/admin/export/<kind>')
@admin_required
def export(kind):
 tables={'participants':'SELECT * FROM participants','attempts':'SELECT * FROM attempts','quizzes':'SELECT * FROM quizzes','surveys':'SELECT * FROM surveys','events':'SELECT * FROM events'}
 if kind not in tables:abort(404)
 with conn() as c:
  cur=c.execute(tables[kind]);headers=[x[0] for x in cur.description];rows=cur.fetchall()
 buf=io.StringIO();w=csv.writer(buf);w.writerow(headers);w.writerows([list(x) for x in rows]);return Response('\ufeff'+buf.getvalue(),mimetype='text/csv',headers={'Content-Disposition':f'attachment; filename={kind}.csv'})

@app.post('/logout')
def logout():session.pop('pid',None);return redirect(url_for('home'))

if __name__=='__main__':
 app.run(host=os.environ.get('HOST','127.0.0.1'),port=int(os.environ.get('PORT','5000')),debug=False)
