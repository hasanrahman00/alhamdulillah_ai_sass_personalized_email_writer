import React from 'react';
import { Card } from './ui/Card';
import { TrendingUp, TrendingDown } from 'lucide-react';
interface MetricsCardProps {
  title: string;
  value: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  icon: React.ElementType;
  color: 'blue' | 'orange' | 'green';
  encouragement: string;
}
export function MetricsCard({
  title,
  value,
  trend,
  icon: Icon,
  color,
  encouragement
}: MetricsCardProps) {
  const colorStyles = {
    blue: 'bg-soft-blue/10 text-soft-blue',
    orange: 'bg-gentle-orange/10 text-gentle-orange',
    green: 'bg-success-green/10 text-success-green'
  };
  return <Card className="relative overflow-hidden group hover:-translate-y-1 transition-transform duration-300">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-warm-gray-light mb-1">
            {title}
          </p>
          <h3 className="text-3xl font-bold text-warm-gray mb-2">{value}</h3>

          {trend && <div className="flex items-center gap-1.5 text-sm">
              <span className={`flex items-center font-medium ${trend.isPositive ? 'text-success-green' : 'text-gentle-orange'}`}>
                {trend.isPositive ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                {trend.value}
              </span>
              <span className="text-warm-gray-light">vs last week</span>
            </div>}
        </div>

        <div className={`p-3 rounded-xl ${colorStyles[color]} transition-transform group-hover:scale-110 duration-300`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-warm-gray/5">
        <p className="text-sm text-warm-gray italic">"{encouragement}"</p>
      </div>
    </Card>;
}