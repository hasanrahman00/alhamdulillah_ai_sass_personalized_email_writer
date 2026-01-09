import React from 'react';
import { MetricsCard } from '../components/MetricsCard';
import { RecentActivity } from '../components/RecentActivity';
import { PenTool, CheckCircle2, Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
export function Dashboard() {
  const navigate = useNavigate();
  return <div className="space-y-8 animate-in fade-in duration-500">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 border border-warm-gray/10 shadow-sm">
            <span className="text-xs font-semibold text-warm-gray">Dashboard</span>
            <span className="text-xs text-warm-gray-light">✨</span>
          </div>
          <h2 className="text-3xl font-bold text-warm-gray mt-3">
            Hello, Sarah! 👋
          </h2>
          <p className="text-warm-gray-light mt-1 text-lg">
            Ready to write your next email? ✉️
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-full shadow-sm border border-warm-gray/5">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-green opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-success-green"></span>
          </span>
          <span className="text-sm font-medium text-warm-gray">
            System Operational ✅
          </span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricsCard title="Words Written" value="12,450" trend={{
        value: '12%',
        isPositive: true
      }} icon={PenTool} color="blue" encouragement="That's a novel in progress!" />
        <MetricsCard title="Projects Completed" value="24" trend={{
        value: '4',
        isPositive: true
      }} icon={CheckCircle2} color="green" encouragement="You're crushing your goals!" />
        <MetricsCard title="Day Streak" value="7 Days" trend={{
        value: 'Best streak!',
        isPositive: true
      }} icon={Flame} color="orange" encouragement="Consistency is your superpower." />
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <RecentActivity />
        </div>
        <div className="space-y-6">
          {/* Quick Tip Card */}
          <div className="bg-gradient-to-br from-soft-blue to-soft-blue-dark rounded-xl p-6 text-white shadow-lg relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150 duration-700"></div>
            <h3 className="text-xl font-bold mb-2 relative z-10">
              Tip of the Day ✨
            </h3>
            <p className="text-white/90 mb-4 relative z-10">
              "The first draft is just you telling yourself the story."
            </p>
            <p className="text-sm text-white/70 italic relative z-10">
              - Terry Pratchett
            </p>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-warm-gray/5">
            <h3 className="font-semibold text-warm-gray mb-4">
              Quick Actions ⚡
            </h3>
            <div className="space-y-3">
              <button onClick={() => navigate('/single')} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-warm-cream transition-colors group">
                <span className="text-sm font-medium text-warm-gray group-hover:text-soft-blue">
                  Single Copy ✍️
                </span>
                <span className="text-xs text-warm-gray-light bg-white px-2 py-1 rounded border border-warm-gray/10">
                  Draft
                </span>
              </button>
              <button onClick={() => navigate('/bulk')} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-warm-cream transition-colors group">
                <span className="text-sm font-medium text-warm-gray group-hover:text-soft-blue">
                  Bulk Creator 📦
                </span>
                <span className="text-xs text-warm-gray-light bg-white px-2 py-1 rounded border border-warm-gray/10">
                  Batch
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>;
}