import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  DashboardIcon, 
  StudyIcon, 
  RevisionIcon, 
  TestIcon, 
  DayIcon, 
  WeekIcon, 
  MonthIcon, 
  AddIcon, 
  DeleteIcon,
  AIIcon,
  UploadIcon,
  PlayIcon,
  PauseIcon,
  FlameIcon,
  CloseIcon,
  LinkIcon,
  SearchIcon,
  RescheduleIcon,
  SettingsIcon,
  FilterIcon,
  DownloadIcon,
  MoonIcon,
  SunIcon,
  BookIcon,
  ClockIcon,
  BellRingIcon
} from './components/Icons';
import { CheckCircle2, Sparkles, FileText, AlertCircle, Trash2, Play, Pause, Bell } from 'lucide-react';
import { DashboardCharts } from './components/Charts';
import { Task, PlannerCategory, ViewMode, PriorityLevel, ThemeMode } from './types';
import { generateStudyPlan } from './services/geminiService';
import { read, utils, writeFile } from 'xlsx';

// --- Helper Functions ---
const getStartOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const isSameDay = (d1: Date, d2: Date) => {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
};

const getWeekRange = (date: Date) => {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay()); // Sunday
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23,59,59,999);
  return { start, end };
};

const getMonthRange = (date: Date) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setHours(23,59,59,999);
  return { start, end };
};

const calculateStreak = (tasks: Task[]): number => {
  const completedDates = new Set(
    tasks
      .filter(t => t.completed)
      .map(t => new Date(t.date).toDateString())
  );

  let streak = 0;
  
  // Check today first
  const today = new Date();
  if (completedDates.has(today.toDateString())) {
    streak++;
  }

  // Check previous days
  for (let i = 1; i < 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (completedDates.has(d.toDateString())) {
      streak++;
    } else {
      if (i === 1 && streak === 0) continue; 
      break;
    }
  }
  return streak;
};

// --- Mock Data Initialization ---
const INITIAL_TASKS: Task[] = [
  { id: '1', title: 'Calculus Chapter 1', category: 'STUDY', date: new Date(), time: '09:00', durationMinutes: 60, completed: true, subject: 'Math', notes: 'Review limits and derivatives', priority: 'HIGH' },
  { id: '2', title: 'Physics Mechanics', category: 'STUDY', date: new Date(), time: '14:00', durationMinutes: 45, completed: false, subject: 'Physics', priority: 'MEDIUM', link: 'https://youtube.com', reminderMinutes: 15 },
  { id: '3', title: 'History Flashcards', category: 'REVISION', date: new Date(), time: '16:30', durationMinutes: 30, completed: false, subject: 'History', notes: 'Focus on dates from 1900-1950', priority: 'LOW' },
  { id: '4', title: 'Mock Exam 1', category: 'TEST', date: new Date(new Date().setDate(new Date().getDate() + 1)), time: '10:00', durationMinutes: 120, completed: false, subject: 'Math', priority: 'HIGH', reminderMinutes: 60 },
];

// --- Components ---

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error', onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-6 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-fade-in-down
      ${type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'}`}>
      {type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span className="font-medium text-sm">{message}</span>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | PlannerCategory>('DASHBOARD');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('ace_planner_theme') as ThemeMode) || 'LIGHT';
  });

  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem('ace_planner_tasks');
      if (saved) {
        return JSON.parse(saved, (key, value) => {
          if (key === 'date') return new Date(value);
          return value;
        });
      }
      return INITIAL_TASKS;
    } catch (e) {
      return INITIAL_TASKS;
    }
  });

  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [focusTask, setFocusTask] = useState<Task | null>(null);

  // Theme Application
  useEffect(() => {
    localStorage.setItem('ace_planner_theme', theme);
    document.documentElement.className = ''; // Clear previous
    if (theme === 'DARK') document.documentElement.classList.add('theme-dark');
    if (theme === 'READING') document.documentElement.classList.add('theme-reading');
    // LIGHT is default (no class)
  }, [theme]);

  // Tasks Persistence
  useEffect(() => {
    localStorage.setItem('ace_planner_tasks', JSON.stringify(tasks));
  }, [tasks]);

  // Reminder Logic
  useEffect(() => {
    // Request permission on load
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
      Notification.requestPermission();
    }

    const checkReminders = () => {
      const now = new Date();
      setTasks(currentTasks => {
        let hasChanges = false;
        const updatedTasks = currentTasks.map(task => {
          if (task.completed || !task.reminderMinutes || task.reminderSent || !task.time) return task;

          const taskDateTime = new Date(task.date);
          const [hours, mins] = task.time.split(':').map(Number);
          taskDateTime.setHours(hours, mins, 0, 0);

          const reminderTime = new Date(taskDateTime.getTime() - task.reminderMinutes * 60000);

          if (now >= reminderTime && now < taskDateTime) {
            // Trigger Notification
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`Upcoming Task: ${task.title}`, {
                body: `Starts in ${task.reminderMinutes} minutes.`,
                icon: '/icon.png' // Placeholder
              });
            } else {
              // Fallback toast if notifications not allowed/supported
              setToast({ message: `Reminder: ${task.title} is starting soon!`, type: 'success' });
            }
            hasChanges = true;
            return { ...task, reminderSent: true };
          }
          return task;
        });
        return hasChanges ? updatedTasks : currentTasks;
      });
    };

    const interval = setInterval(checkReminders, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);
  
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  };

  const streak = useMemo(() => calculateStreak(tasks), [tasks]);

  const dashboardData = useMemo(() => {
    const completedCount = tasks.filter(t => t.completed).length;
    const pendingCount = tasks.length - completedCount;
    
    const statusData = [
      { name: 'Completed', value: completedCount, fill: '#10B981' }, 
      { name: 'Pending', value: pendingCount, fill: '#EF4444' }, 
    ];

    const studyCount = tasks.filter(t => t.category === 'STUDY').length;
    const revCount = tasks.filter(t => t.category === 'REVISION').length;
    const testCount = tasks.filter(t => t.category === 'TEST').length;

    const categoryData = [
      { name: 'Study', value: studyCount, fill: '#6366F1' }, 
      { name: 'Revision', value: revCount, fill: '#F59E0B' }, 
      { name: 'Test', value: testCount, fill: '#14B8A6' }, 
    ];

    return { statusData, categoryData };
  }, [tasks]);

  const overdueCount = useMemo(() => {
    const today = getStartOfDay(new Date());
    return tasks.filter(t => !t.completed && new Date(t.date) < today).length;
  }, [tasks]);

  const addTask = (task: Task) => {
    setTasks(prev => [...prev, task]);
    showToast('Task added successfully', 'success');
  };

  const addTasksBatch = (newTasks: Task[]) => {
    setTasks(prev => [...prev, ...newTasks]);
    showToast(`${newTasks.length} tasks imported`, 'success');
  };

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const handleRescheduleOverdue = () => {
      const today = new Date();
      const startOfToday = getStartOfDay(today);
      
      setTasks(prev => prev.map(t => {
          if (!t.completed && new Date(t.date) < startOfToday) {
              return { ...t, date: today };
          }
          return t;
      }));
      showToast(`${overdueCount} overdue tasks moved to today`, 'success');
  };

  const handleClearData = () => {
    if(window.confirm('Are you sure you want to delete all tasks? This cannot be undone.')) {
      setTasks([]);
      showToast('All tasks deleted', 'success');
      setIsSettingsOpen(false);
    }
  };

  const handleExportData = () => {
    try {
      const ws = utils.json_to_sheet(tasks.map(t => ({
        ...t,
        date: new Date(t.date).toISOString().split('T')[0]
      })));
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Tasks");
      writeFile(wb, "AcePlanner_Backup.xlsx");
      showToast('Data exported successfully', 'success');
    } catch (e) {
      showToast('Failed to export data', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-skin-base flex justify-center items-start pt-0 sm:pt-4 font-sans transition-colors duration-300">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="w-full max-w-md h-[100vh] sm:h-[90vh] bg-skin-card sm:rounded-3xl shadow-2xl flex flex-col relative overflow-hidden ring-1 ring-black/5 transition-colors duration-300">
        
        {/* Header */}
        <header className={`px-6 pt-12 pb-6 flex justify-between items-center z-10 
          ${activeTab === 'DASHBOARD' ? 'bg-indigo-600 text-white' : 
            activeTab === 'STUDY' ? 'bg-blue-600 text-white' :
            activeTab === 'REVISION' ? 'bg-amber-500 text-white' :
            'bg-emerald-600 text-white'
          } transition-colors duration-300`}>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {activeTab === 'DASHBOARD' && 'Dashboard'}
              {activeTab === 'STUDY' && 'Study Planner'}
              {activeTab === 'REVISION' && 'Revision'}
              {activeTab === 'TEST' && 'Test Planner'}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-white/90">
              <p className="text-sm opacity-90">
                {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
              {streak > 0 && (
                <div className="flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-xs font-semibold backdrop-blur-sm">
                  <FlameIcon />
                  <span>{streak} day streak</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-all active:scale-95"
            >
              <SettingsIcon />
            </button>
            <button 
              onClick={() => setIsAIModalOpen(true)}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-all active:scale-95"
            >
              <AIIcon />
            </button>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <main className="flex-1 overflow-y-auto no-scrollbar bg-skin-base/50">
          {activeTab === 'DASHBOARD' ? (
            <div className="p-6">
               {/* Overdue Action Card */}
               {overdueCount > 0 && (
                   <div className="mb-6 bg-red-50 p-4 rounded-2xl border border-red-100 flex items-center justify-between dark:bg-red-900/20 dark:border-red-800">
                       <div className="flex items-center gap-3">
                           <div className="p-2 bg-red-100 text-red-600 rounded-lg dark:bg-red-800 dark:text-red-200">
                               <AlertCircle size={20}/>
                           </div>
                           <div>
                               <h3 className="font-bold text-skin-text text-sm">Action Needed</h3>
                               <p className="text-xs text-skin-muted">{overdueCount} overdue tasks</p>
                           </div>
                       </div>
                       <button 
                        onClick={handleRescheduleOverdue}
                        className="px-3 py-1.5 bg-skin-card text-red-600 text-xs font-bold rounded-lg shadow-sm border border-red-100 flex items-center gap-1 hover:bg-red-50 dark:bg-slate-700 dark:border-slate-600 dark:text-red-300"
                       >
                           <RescheduleIcon />
                           Reschedule
                       </button>
                   </div>
               )}

               {/* Quick Stats Cards */}
               <div className="grid grid-cols-2 gap-4 mb-6">
                 <div className="bg-skin-card p-4 rounded-2xl shadow-sm border border-skin-border flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{tasks.filter(t => t.completed).length}</span>
                    <span className="text-xs text-skin-muted uppercase font-semibold mt-1">Done</span>
                 </div>
                 <div className="bg-skin-card p-4 rounded-2xl shadow-sm border border-skin-border flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-skin-text">{tasks.length}</span>
                    <span className="text-xs text-skin-muted uppercase font-semibold mt-1">Total</span>
                 </div>
               </div>

               <DashboardCharts statusData={dashboardData.statusData} categoryData={dashboardData.categoryData} />
            </div>
          ) : (
            <PlannerView 
              category={activeTab} 
              tasks={tasks} 
              onToggle={toggleTask} 
              onDelete={deleteTask}
              onAdd={addTask}
              onBatchAdd={addTasksBatch}
              onFocus={(task) => setFocusTask(task)}
              onError={(msg) => showToast(msg, 'error')}
            />
          )}
        </main>

        <nav className="bg-skin-card border-t border-skin-border px-6 py-4 flex justify-between items-center z-20 pb-8 sm:pb-4 transition-colors">
          <NavButton 
            active={activeTab === 'DASHBOARD'} 
            onClick={() => setActiveTab('DASHBOARD')} 
            icon={<DashboardIcon />} 
            label="Dash" 
          />
          <NavButton 
            active={activeTab === 'STUDY'} 
            onClick={() => setActiveTab('STUDY')} 
            icon={<StudyIcon />} 
            label="Study" 
          />
          <NavButton 
            active={activeTab === 'REVISION'} 
            onClick={() => setActiveTab('REVISION')} 
            icon={<RevisionIcon />} 
            label="Revise" 
          />
          <NavButton 
            active={activeTab === 'TEST'} 
            onClick={() => setActiveTab('TEST')} 
            icon={<TestIcon />} 
            label="Test" 
          />
        </nav>

        {isAIModalOpen && (
          <AIModal 
            isOpen={isAIModalOpen} 
            onClose={() => setIsAIModalOpen(false)} 
            currentCategory={activeTab === 'DASHBOARD' ? 'STUDY' : activeTab}
            onPlanGenerated={(newTasks) => {
              addTasksBatch(newTasks);
              setIsAIModalOpen(false);
            }}
          />
        )}

        {isSettingsOpen && (
          <SettingsModal 
            isOpen={isSettingsOpen} 
            onClose={() => setIsSettingsOpen(false)}
            onExport={handleExportData}
            onClear={handleClearData}
            currentTheme={theme}
            setTheme={setTheme}
          />
        )}

        {focusTask && (
          <FocusModal 
            task={focusTask} 
            onClose={() => setFocusTask(null)}
            onComplete={() => {
              if (!focusTask.completed) toggleTask(focusTask.id);
              setFocusTask(null);
              showToast("Good job! Task completed.", "success");
            }} 
          />
        )}

      </div>
    </div>
  );
}

const NavButton = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center space-y-1 transition-all duration-300 ${active ? 'text-indigo-600 dark:text-indigo-400 -translate-y-1' : 'text-skin-muted hover:text-skin-text'}`}
  >
    <div className={`${active ? 'bg-indigo-50 dark:bg-indigo-900/50 p-2 rounded-xl' : 'p-2'}`}>
      {icon}
    </div>
    <span className="text-[10px] font-medium">{label}</span>
  </button>
);

interface PlannerViewProps {
  category: PlannerCategory;
  tasks: Task[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (task: Task) => void;
  onBatchAdd: (tasks: Task[]) => void;
  onFocus: (task: Task) => void;
  onError: (msg: string) => void;
}

const PlannerView: React.FC<PlannerViewProps> = ({ category, tasks, onToggle, onDelete, onAdd, onBatchAdd, onFocus, onError }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('DAILY');
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'COMPLETED' | 'PENDING'>('ALL');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categoryTasks = tasks.filter(t => t.category === category);
  
  const filteredTasks = useMemo(() => {
    const today = new Date();
    
    // First filtered by category and search
    let filtered = categoryTasks.filter(t => 
        (t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        t.subject.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Filter by Status
    if (filterStatus === 'COMPLETED') {
        filtered = filtered.filter(t => t.completed);
    } else if (filterStatus === 'PENDING') {
        filtered = filtered.filter(t => !t.completed);
    }

    // Then filtered by View Mode (Date Range)
    filtered = filtered.filter(task => {
      const taskDate = new Date(task.date);
      if (viewMode === 'DAILY') {
        return isSameDay(taskDate, today);
      } else if (viewMode === 'WEEKLY') {
        const { start, end } = getWeekRange(today);
        return taskDate >= start && taskDate <= end;
      } else {
        const { start, end } = getMonthRange(today);
        return taskDate >= start && taskDate <= end;
      }
    });

    return filtered.sort((a, b) => {
       const priorityScore = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1, undefined: 0 };
       const pA = priorityScore[a.priority || 'LOW'];
       const pB = priorityScore[b.priority || 'LOW'];
       
       if (pA !== pB) return pB - pA;
       return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }, [categoryTasks, viewMode, searchQuery, filterStatus]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = read(arrayBuffer);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = utils.sheet_to_json(sheet);

      const newTasks: Task[] = jsonData.map((row: any, index) => ({
        id: `imported-${Date.now()}-${index}`,
        title: row.Title || row.title || 'Untitled Task',
        subject: row.Subject || row.subject || 'General',
        durationMinutes: parseInt(row.Duration || row.duration || '30'),
        date: row.Date ? new Date(row.Date) : new Date(),
        time: row.Time || undefined,
        completed: false,
        category: category,
        notes: row.Notes || row.notes || '',
        priority: (row.Priority || row.priority || 'MEDIUM').toUpperCase() as PriorityLevel,
        link: row.Link || row.link || ''
      }));

      onBatchAdd(newTasks);
    } catch (error) {
      console.error("Error importing file:", error);
      onError("Failed to import file. Please check the Excel format.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const getPriorityColor = (p?: PriorityLevel) => {
    switch(p) {
      case 'HIGH': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800';
      case 'LOW': return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800';
      default: return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
    }
  };

  return (
    <div className="relative h-full flex flex-col">
      {/* Sub-Navigation (Tabs) & Import */}
      <div className="flex flex-col gap-3 p-4 sticky top-0 bg-skin-base/95 backdrop-blur-sm z-10 border-b border-skin-border transition-colors">
        <div className="flex items-center gap-2">
            <div className="flex-1 flex gap-2">
                <TabButton active={viewMode === 'DAILY'} onClick={() => setViewMode('DAILY')} label="Daily" icon={<DayIcon />} />
                <TabButton active={viewMode === 'WEEKLY'} onClick={() => setViewMode('WEEKLY')} label="Weekly" icon={<WeekIcon />} />
                <TabButton active={viewMode === 'MONTHLY'} onClick={() => setViewMode('MONTHLY')} label="Monthly" icon={<MonthIcon />} />
            </div>
            <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 bg-skin-card text-skin-muted rounded-xl hover:bg-skin-button-hover border border-skin-border shadow-sm transition-colors"
                title="Import Excel"
            >
                <UploadIcon />
            </button>
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept=".xlsx, .xls, .csv" 
            />
        </div>
        
        {/* Search Bar & Filters */}
        <div className="flex items-center gap-2">
            <div className="relative flex-1">
                 <div className="absolute left-3 top-1/2 -translate-y-1/2 text-skin-muted">
                     <SearchIcon />
                 </div>
                 <input 
                     type="text"
                     placeholder="Search..."
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     className="w-full pl-10 pr-4 py-2 bg-skin-card rounded-xl border-none shadow-sm text-sm text-skin-text focus:ring-2 focus:ring-indigo-100 placeholder:text-skin-muted"
                 />
            </div>
            {/* Filter Toggle */}
            <div className="flex bg-skin-card rounded-xl p-1 shadow-sm border border-skin-border">
               {(['ALL', 'PENDING', 'COMPLETED'] as const).map(status => (
                 <button
                   key={status}
                   onClick={() => setFilterStatus(status)}
                   className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                     ${filterStatus === status ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' : 'text-skin-muted hover:text-skin-text'}`}
                 >
                   {status === 'ALL' ? 'All' : status === 'PENDING' ? 'Todo' : 'Done'}
                 </button>
               ))}
            </div>
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 p-4 pb-24 space-y-3">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-skin-muted">
            <FilterIcon />
            <p className="mt-2 text-sm">No tasks found.</p>
            <p className="text-xs">Try changing filters or search.</p>
          </div>
        ) : (
          filteredTasks.map(task => (
            <div key={task.id} className="bg-skin-card p-4 rounded-xl shadow-sm border border-skin-border group transition-all hover:shadow-md relative overflow-hidden">
               {task.priority === 'HIGH' && !task.completed && (
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-400" />
               )}

              <div className="flex items-start justify-between pl-2">
                <div className="flex items-start gap-4 flex-1">
                  <button 
                    onClick={() => onToggle(task.id)}
                    className={`mt-1 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 
                      ${task.completed 
                        ? 'bg-green-500 border-green-500 text-white' 
                        : 'border-gray-300 dark:border-gray-600 text-transparent hover:border-indigo-400'}`}
                  >
                    <CheckCircle2 size={14} strokeWidth={3} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className={`font-medium text-skin-text truncate ${task.completed ? 'line-through text-skin-muted' : ''}`}>
                        {task.title}
                      </h4>
                      {task.priority && !task.completed && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold tracking-wide ${getPriorityColor(task.priority)}`}>
                          {task.priority}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center flex-wrap gap-2 text-xs text-skin-muted">
                      <span className="bg-skin-base px-2 py-0.5 rounded text-skin-text font-medium border border-skin-border">{task.subject}</span>
                      {task.time && (
                         <span className="flex items-center gap-0.5 text-indigo-500 font-medium">
                           <ClockIcon /> {task.time}
                         </span>
                      )}
                      <span>• {task.durationMinutes}m</span>
                      {viewMode !== 'DAILY' && <span>• {new Date(task.date).toLocaleDateString(undefined, {month:'short', day:'numeric'})}</span>}
                      {task.reminderMinutes && !task.completed && (
                        <span className="flex items-center gap-0.5 text-amber-500">
                          <BellRingIcon />
                        </span>
                      )}
                      {task.link && (
                          <a 
                            href={task.link} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                             <LinkIcon />
                             Link
                          </a>
                      )}
                    </div>
                    {task.notes && (
                      <div className="mt-2 text-xs text-skin-muted bg-skin-base p-2 rounded-lg border border-skin-border flex gap-2">
                        <FileText size={12} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{task.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-1">
                  {!task.completed && (
                    <button 
                      onClick={() => onFocus(task)}
                      className="p-2 text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                      title="Start Focus Timer"
                    >
                      <PlayIcon />
                    </button>
                  )}
                  <button onClick={() => onDelete(task.id)} className="text-skin-muted hover:text-red-500 transition-colors p-2">
                    <DeleteIcon />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <button 
        onClick={() => setShowAddForm(true)}
        className={`absolute bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95
          ${category === 'STUDY' ? 'bg-blue-600' : category === 'REVISION' ? 'bg-amber-500' : 'bg-emerald-600'}`}
      >
        <AddIcon />
      </button>

      {showAddForm && (
        <div className="absolute inset-0 bg-skin-card z-20 p-6 flex flex-col animate-fade-in-up overflow-y-auto">
          <h2 className="text-xl font-bold mb-6 text-skin-text">New {category.toLowerCase()} task</h2>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const reminderVal = formData.get('reminderMinutes');
              const newTask: Task = {
                id: Date.now().toString(),
                title: formData.get('title') as string,
                subject: formData.get('subject') as string,
                durationMinutes: parseInt(formData.get('duration') as string),
                date: new Date(formData.get('date') as string || new Date()),
                time: formData.get('time') as string,
                category: category,
                completed: false,
                notes: formData.get('notes') as string,
                priority: formData.get('priority') as PriorityLevel,
                link: formData.get('link') as string,
                reminderMinutes: reminderVal ? parseInt(reminderVal as string) : undefined
              };
              onAdd(newTask);
              setShowAddForm(false);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-skin-muted mb-1">Title</label>
              <input name="title" required className="w-full p-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Chapter 4 Reading" />
            </div>
            
            <div className="flex gap-4">
               <div className="flex-1">
                  <label className="block text-sm font-medium text-skin-muted mb-1">Subject</label>
                  <input name="subject" required className="w-full p-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500" placeholder="Math" />
               </div>
               <div className="w-1/3">
                  <label className="block text-sm font-medium text-skin-muted mb-1">Mins</label>
                  <input name="duration" type="number" defaultValue={30} className="w-full p-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
               </div>
            </div>

            <div>
               <label className="block text-sm font-medium text-skin-muted mb-2">Priority</label>
               <div className="flex gap-2">
                 {['HIGH', 'MEDIUM', 'LOW'].map((p) => (
                   <label key={p} className="flex-1 cursor-pointer">
                     <input type="radio" name="priority" value={p} className="peer hidden" defaultChecked={p === 'MEDIUM'} />
                     <div className="py-2 text-center rounded-lg border border-skin-border text-sm font-medium text-skin-muted peer-checked:bg-indigo-50 dark:peer-checked:bg-indigo-900/40 peer-checked:text-indigo-600 dark:peer-checked:text-indigo-300 peer-checked:border-indigo-200 transition-all">
                       {p}
                     </div>
                   </label>
                 ))}
               </div>
            </div>

            <div className="flex gap-4">
               <div className="flex-1">
                 <label className="block text-sm font-medium text-skin-muted mb-1">Date</label>
                 <input name="date" type="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full p-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
               </div>
               <div className="flex-1">
                 <label className="block text-sm font-medium text-skin-muted mb-1">Time (Optional)</label>
                 <input name="time" type="time" className="w-full p-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
               </div>
            </div>

            <div>
               <label className="block text-sm font-medium text-skin-muted mb-1">Reminder</label>
               <select name="reminderMinutes" className="w-full p-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">No Reminder</option>
                  <option value="5">5 minutes before</option>
                  <option value="15">15 minutes before</option>
                  <option value="30">30 minutes before</option>
                  <option value="60">1 hour before</option>
                  <option value="1440">1 day before</option>
               </select>
            </div>

            <div>
               <label className="block text-sm font-medium text-skin-muted mb-1">Link (Optional)</label>
               <div className="relative">
                 <div className="absolute left-3 top-1/2 -translate-y-1/2 text-skin-muted"><LinkIcon /></div>
                 <input name="link" type="url" placeholder="https://..." className="w-full pl-10 pr-3 py-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
               </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-skin-muted mb-1">Notes</label>
              <textarea name="notes" rows={3} className="w-full p-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500" placeholder="Add details..."></textarea>
            </div>

            <div className="flex gap-3 mt-4">
              <button type="button" onClick={() => setShowAddForm(false)} className="flex-1 py-3 text-skin-muted font-medium hover:bg-skin-base rounded-xl transition-colors">Cancel</button>
              <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all">Save Task</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const TabButton = ({ active, onClick, label, icon }: { active: boolean, onClick: () => void, label: string, icon: React.ReactNode }) => (
  <button 
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all
      ${active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-skin-card text-skin-muted hover:bg-skin-button-hover'}`}
  >
    {icon} {label}
  </button>
);

const SettingsModal = ({ isOpen, onClose, onExport, onClear, currentTheme, setTheme }: { 
    isOpen: boolean, 
    onClose: () => void, 
    onExport: () => void, 
    onClear: () => void,
    currentTheme: ThemeMode,
    setTheme: (t: ThemeMode) => void
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-skin-card rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden border border-skin-border">
        <div className="p-4 border-b border-skin-border flex justify-between items-center">
          <h3 className="font-bold text-skin-text flex items-center gap-2">
            <SettingsIcon /> Settings
          </h3>
          <button onClick={onClose} className="text-skin-muted hover:text-skin-text"><CloseIcon /></button>
        </div>
        <div className="p-4 space-y-3">
          
          {/* Theme Selector */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-skin-muted uppercase mb-2">Appearance</label>
            <div className="flex bg-skin-base p-1 rounded-xl">
              {(['LIGHT', 'DARK', 'READING'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={`flex-1 flex items-center justify-center p-2 rounded-lg transition-all ${currentTheme === mode ? 'bg-skin-card shadow text-indigo-600' : 'text-skin-muted hover:text-skin-text'}`}
                  title={mode}
                >
                  {mode === 'LIGHT' ? <SunIcon /> : mode === 'DARK' ? <MoonIcon /> : <BookIcon />}
                </button>
              ))}
            </div>
          </div>

          <button onClick={onExport} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-left text-skin-text transition-colors group">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 rounded-lg group-hover:bg-indigo-200"><DownloadIcon /></div>
            <div>
               <div className="font-semibold text-sm">Export Data</div>
               <div className="text-xs text-skin-muted">Download as Excel</div>
            </div>
          </button>
          
          <div className="h-px bg-skin-border my-2"></div>

          <button onClick={onClear} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-left text-red-600 transition-colors group">
            <div className="p-2 bg-red-100 dark:bg-red-900/50 text-red-500 dark:text-red-300 rounded-lg group-hover:bg-red-200"><Trash2 size={18} /></div>
            <div>
               <div className="font-semibold text-sm">Clear All Data</div>
               <div className="text-xs text-red-400">Delete all tasks</div>
            </div>
          </button>
          
          <div className="text-center text-xs text-skin-muted mt-4">
            v1.1.0 • Study Planner
          </div>
        </div>
      </div>
    </div>
  );
}

const AIModal = ({ isOpen, onClose, currentCategory, onPlanGenerated }: { isOpen: boolean, onClose: () => void, currentCategory: PlannerCategory, onPlanGenerated: (tasks: Task[]) => void }) => {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!topic) return;
    setLoading(true);
    // Call service
    try {
        const rawTasks = await generateStudyPlan(topic, currentCategory, 3); // Default 3 days
        const newTasks: Task[] = rawTasks.map((t, i) => ({
            id: Date.now() + '-' + i,
            title: t.title || 'Study Task',
            category: currentCategory,
            date: new Date(new Date().setDate(new Date().getDate() + (i % 3))), // Spread over 3 days
            durationMinutes: t.durationMinutes || 30,
            completed: false,
            subject: t.subject || topic,
            priority: 'MEDIUM'
        }));
        onPlanGenerated(newTasks);
    } catch(e) {
        console.error(e);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
       <div className="bg-skin-card w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-skin-text flex items-center gap-2">
              <Sparkles className="text-indigo-500" /> AI Assistant
            </h3>
            <button onClick={onClose} className="text-skin-text"><CloseIcon /></button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-skin-muted mb-1">What do you want to learn?</label>
              <input 
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Thermodynamics, WW2 History, Linear Algebra"
                className="w-full p-3 bg-skin-base text-skin-text rounded-xl border-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
            </div>
            
            <button 
              onClick={handleGenerate}
              disabled={loading || !topic}
              className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
            >
              {loading ? (
                 <>
                   <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                   Generating Plan...
                 </>
              ) : (
                 <>
                   <Sparkles size={20} /> Generate {currentCategory === 'STUDY' ? 'Study' : currentCategory === 'REVISION' ? 'Revision' : 'Test'} Plan
                 </>
              )}
            </button>
            <p className="text-center text-xs text-skin-muted">Powered by Gemini 2.5 Flash</p>
          </div>
       </div>
    </div>
  );
};

const FocusModal = ({ task, onClose, onComplete }: { task: Task, onClose: () => void, onComplete: () => void }) => {
  const [timeLeft, setTimeLeft] = useState(task.durationMinutes * 60);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let interval: any;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft(t => t - 1), 1000);
    } else if (timeLeft === 0) {
      setIsActive(false);
      onComplete();
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft, onComplete]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = ((task.durationMinutes * 60 - timeLeft) / (task.durationMinutes * 60));
  const radius = 110;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="fixed inset-0 bg-indigo-900/95 backdrop-blur-md z-50 flex flex-col items-center justify-center text-white p-6 animate-fade-in">
       <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/10 rounded-full hover:bg-white/20"><CloseIcon /></button>
       
       <div className="mb-8 text-center">
         <div className="text-indigo-200 text-sm font-medium mb-2 tracking-wider uppercase">Focus Mode</div>
         <h2 className="text-2xl font-bold">{task.title}</h2>
         <p className="text-white/60 mt-1">{task.subject}</p>
       </div>

       <div className="relative w-64 h-64 flex items-center justify-center mb-8">
          <svg className="w-full h-full -rotate-90 transform">
             <circle 
               cx="128" cy="128" r={radius} 
               stroke="currentColor" strokeWidth="12" fill="transparent" 
               className="text-indigo-800" 
             />
             <circle 
               cx="128" cy="128" r={radius} 
               stroke="currentColor" strokeWidth="12" fill="transparent" 
               strokeDasharray={circumference} 
               strokeDashoffset={offset} 
               className="text-indigo-400 transition-all duration-1000 ease-linear" 
               strokeLinecap="round" 
             />
          </svg>
          <div className="absolute text-5xl font-mono font-bold tracking-widest text-white">
             {formatTime(timeLeft)}
          </div>
       </div>

       <button 
         onClick={() => setIsActive(!isActive)} 
         className="w-20 h-20 rounded-full bg-white text-indigo-900 flex items-center justify-center mb-6 hover:scale-105 transition-transform shadow-xl shadow-indigo-900/50"
       >
         {isActive ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
       </button>

       <button onClick={onClose} className="text-white/50 hover:text-white text-sm font-medium transition-colors">
         Stop Session
       </button>
    </div>
  );
};